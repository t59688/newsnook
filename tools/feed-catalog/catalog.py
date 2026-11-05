"""Standalone public feed discovery/checker. Python 3.10+, standard library only."""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import csv
from datetime import datetime, timezone, timedelta
import hashlib
from html.parser import HTMLParser
import io
import ipaddress
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import xml.etree.ElementTree as ET

RADAR_URL = 'https://raw.githubusercontent.com/DIYgod/RSSHub/gh-pages/build/radar-rules.json'
MAX_BODY = 4 * 1024 * 1024


def public_url(value):
    url = urllib.parse.urlsplit(value)
    if url.scheme not in ('https', 'http') or not url.hostname or url.username or url.password or url.fragment:
        raise ValueError('Expected public HTTP(S) URL without credentials or fragment')
    if url.port not in (None, 80, 443) or re.search(r'(?:token|secret|password|cookie|api.?key)=', url.query, re.I):
        raise ValueError('Private endpoint or credentials are not allowed')
    if url.hostname == 'localhost' or url.hostname.endswith(('.local', '.localhost')):
        raise ValueError('Local endpoint is not allowed')
    try:
        if not ipaddress.ip_address(url.hostname).is_global:
            raise ValueError('Non-public address')
    except ValueError as error:
        if str(error) == 'Non-public address':
            raise
    return urllib.parse.urlunsplit((url.scheme.lower(), url.netloc.lower(), url.path or '/', url.query, ''))


class PublicRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        public_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def request(url, timeout=8, max_bytes=MAX_BODY):
    started = time.monotonic()
    try:
        public_url(url)
        opener = urllib.request.build_opener(PublicRedirect())
        req = urllib.request.Request(url, headers={'User-Agent': 'PublicFeedCatalogChecker/1.0', 'Accept': 'application/atom+xml, application/rss+xml, application/feed+json, */*;q=0.5'})
        with opener.open(req, timeout=timeout) as response:
            chunks, size = [], 0
            while True:
                # read() waits to fill the buffer; trickling servers could evade a
                # socket timeout indefinitely. read1() lets us enforce elapsed time.
                chunk = response.read1(65536)
                if not chunk:
                    break
                size += len(chunk)
                if size > max_bytes or time.monotonic() - started > timeout:
                    raise ValueError('Response size or time budget exceeded')
                chunks.append(chunk)
            return {'status': response.status, 'body': b''.join(chunks)}
    except urllib.error.HTTPError as error:
        return {'status': error.code, 'body': b''}
    except (OSError, ValueError, urllib.error.URLError) as error:
        return {'status': 0, 'body': b'', 'error': type(error).__name__}


def curl_request(url, timeout=8, max_bytes=MAX_BODY):
    """Optional system curl transport provides a hard DNS/connect/read deadline."""
    executable = shutil.which('curl.exe') or shutil.which('curl')
    if not executable:
        raise ValueError('curl transport requested but curl is not installed')
    deadline = time.monotonic() + timeout
    try:
        for _ in range(5):
            url = public_url(url)
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                break
            result = subprocess.run([executable, '-q', '--silent', '--proto', '=http,https', '--max-time', str(remaining), '--connect-timeout', str(remaining), '--max-filesize', str(max_bytes), '--user-agent', 'PublicFeedCatalogChecker/1.0', '--write-out', '\n%{response_code}\n%{redirect_url}', '--url', url], capture_output=True, timeout=remaining + 0.5)
            if result.returncode:
                return {'status': 0, 'body': b'', 'error': 'curl-' + str(result.returncode)}
            body, status, redirect = result.stdout.rsplit(b'\n', 2)
            status = int(status)
            if status in (301, 302, 303, 307, 308) and redirect:
                url = redirect.decode('utf8')
                continue
            return {'status': status, 'body': body if status == 200 else b''}
    except (OSError, ValueError, subprocess.TimeoutExpired) as error:
        return {'status': 0, 'body': b'', 'error': type(error).__name__}
    return {'status': 0, 'body': b'', 'error': 'deadline-or-redirect-limit'}


class Outlines(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.rows = []

    def handle_starttag(self, tag, attrs):
        row = dict(attrs)
        if tag.lower() == 'outline' and row.get('xmlurl'):
            self.rows.append({'url': row['xmlurl'], 'title': row.get('title') or row.get('text') or '', 'site_url': row.get('htmlurl', '')})


def discover(text, kind):
    rows = []
    if kind == 'opml':
        parser = Outlines()
        parser.feed(text)
        rows = parser.rows
    elif kind == 'csv':
        for raw in csv.DictReader(io.StringIO(text), skipinitialspace=True):
            row = {k.strip(): (v or '').strip() for k, v in raw.items() if k}
            rows.append({'title': row.get('Introduction', row.get('title', '')), 'url': row.get('RSS feed', row.get('url', '')), 'site_url': row.get('Address', row.get('site_url', '')), 'tags': [t.strip() for t in row.get('tags', '').split(';') if t.strip()], **{k: row[k] for k in ('platform', 'creator_id', 'language') if row.get(k)}})
    elif kind == 'markdown':
        for title, url in re.findall(r'\[([^\]\n]+)\]\((https?://[^\s)]+)\)', text):
            if re.fullmatch(r'https://space\.bilibili\.com/\d+/?', url):
                # Avatar links precede the named link in creator directories.
                # Never let image markup win identity deduplication.
                title = re.sub(r'<[^>]*>', '', title).strip().strip('*_').strip()
                if title:
                    rows.append({'title': title, 'site_url': url, 'url': ''})
    elif kind == 'json':
        raw = json.loads(text)
        rows = raw if isinstance(raw, list) else raw['feeds']
    elif kind == 'text':
        for line in text.splitlines():
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            url, _, title = line.partition(' # ')
            title = re.sub(r'\s+https?://\S+\s*$', '', title).strip()
            rows.append({'url': url.strip(), 'title': title})
    else:
        raise ValueError('Unsupported discovery format: ' + kind)
    result = []
    for raw in rows:
        row = dict(raw)
        try:
            if row.get('url'):
                row['url'] = public_url(row['url'])
            if row.get('site_url'):
                row['site_url'] = public_url(row['site_url'])
            if row.get('url') or row.get('site_url') or (row.get('platform') and row.get('creator_id') and row.get('title')):
                result.append(row)
        except (ValueError, TypeError):
            continue
    return result


def radar_route(site_url, radar, target_prefix):
    """Only literal paths and whole-segment parameters; never evaluate rule code."""
    url = urllib.parse.urlsplit(site_url)
    for domain, groups in radar.items():
        for subdomain, rules in groups.items():
            host = domain if subdomain == '.' else subdomain + '.' + domain
            if host != url.hostname or not isinstance(rules, list):
                continue
            for rule in rules:
                target = rule.get('target')
                if not isinstance(target, str) or not target.startswith(target_prefix):
                    continue
                sources = rule.get('source', [])
                if isinstance(sources, str):
                    sources = [sources]
                for source in sources:
                    if not isinstance(source, str) or not re.fullmatch(r'/[A-Za-z0-9_:/-]*', source):
                        continue
                    names = re.findall(r':([A-Za-z_][A-Za-z0-9_]*)', source)
                    pattern = '/'.join('([A-Za-z0-9_-]+)' if part.startswith(':') else re.escape(part) for part in source.split('/'))
                    match = re.fullmatch(pattern + '/?', url.path)
                    if match:
                        route = target
                        for key, value in zip(names, match.groups()):
                            route = route.replace(':' + key, value)
                        if re.fullmatch(r'/[A-Za-z0-9_/-]+', route):
                            return route
    return None


def convert(raw, radar):
    row = dict(raw)
    # Dataset identities must be explicit; no enumeration or inference from names.
    creator = row.get('creator_id', '')
    if not row.get('url') and row.get('platform') == 'youtube' and re.fullmatch(r'UC[A-Za-z0-9_-]{22}', creator):
        row['url'] = 'https://www.youtube.com/feeds/videos.xml?channel_id=' + creator
    if not row.get('site_url') and row.get('platform') == 'bilibili' and re.fullmatch(r'\d{1,20}', creator):
        row['site_url'] = 'https://space.bilibili.com/' + creator
    url = urllib.parse.urlsplit(row.get('url', ''))
    channel = urllib.parse.parse_qs(url.query).get('channel_id', [''])[0]
    if url.hostname in ('youtube.com', 'www.youtube.com') and url.path == '/feeds/videos.xml' and re.fullmatch(r'UC[A-Za-z0-9_-]{22}', channel):
        row.update(platform='youtube', creator_id=channel, site_url='https://www.youtube.com/channel/' + channel)
    elif not row.get('url'):
        match = re.fullmatch(r'https://space\.bilibili\.com/(\d+)/?', row.get('site_url', ''))
        if not match:
            return None
        route = radar_route(row['site_url'], radar, '/bilibili/user/video/')
        if not route:
            return None
        row.update(platform='bilibili', creator_id=match[1], rsshub_route=route, url='https://rsshub.app' + route)
    return row


def identity(row):
    if row.get('platform') and row.get('creator_id'):
        route = row.get('rsshub_route', '')
        content = re.sub(r'/[^/]+$', '', route) if route else 'native'
        if row['platform'] == 'youtube':
            content = 'videos'
        return row['platform'] + ':' + row['creator_id'] + ':' + content
    return public_url(row['url'])


def feed_metadata(body):
    try:
        if body.lstrip().startswith(b'{'):
            data = json.loads(body)
            if data.get('version') not in ('https://jsonfeed.org/version/1', 'https://jsonfeed.org/version/1.1') or not isinstance(data.get('items'), list):
                return None
            return {'title': str(data.get('title', '')).strip(), 'language': data.get('language', 'und')}
        if b'<!DOCTYPE' in body.upper() or b'<!ENTITY' in body.upper():
            return None
        root = ET.fromstring(body)
        local = lambda tag: tag.split('}')[-1]
        if local(root.tag) == 'rss':
            channel = next((child for child in root if local(child.tag) == 'channel'), None)
        elif root.tag in ('{http://www.w3.org/2005/Atom}feed', '{http://www.w3.org/1999/02/22-rdf-syntax-ns#}RDF'):
            channel = root if local(root.tag) == 'feed' else next((child for child in root if local(child.tag) == 'channel'), None)
        else:
            return None
        if channel is None:
            return None
        fields = {local(child.tag): ''.join(child.itertext()).strip() for child in channel}
        return {'title': fields.get('title', ''), 'language': fields.get('language', root.attrib.get('{http://www.w3.org/XML/1998/namespace}lang', 'und'))}
    except (ET.ParseError, ValueError, TypeError, AttributeError, LookupError):
        return None


def permanently_unavailable(history, identity_confirmed):
    if identity_confirmed:
        return False
    tail = []
    for row in sorted(history, key=lambda r: r['checked_at'], reverse=True):
        if row['status'] not in (404, 410):
            break
        tail.append(row)
    return len({row['run_id'] for row in tail}) >= 3 and datetime.fromisoformat(tail[0]['checked_at'].replace('Z', '+00:00')) - datetime.fromisoformat(tail[-1]['checked_at'].replace('Z', '+00:00')) >= timedelta(days=7)


def check(row, history, run_id, checked_at, get, instances):
    if checked_at is None:
        checked_at = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
    def fetch(url):
        try:
            return get(url)
        except Exception as error:
            return {'status': 0, 'body': b'', 'error': type(error).__name__}
    route = row.get('rsshub_route')
    urls = [base.rstrip('/') + route for base in instances] if route else [row['url']]
    responses, metadata = [], None
    for url in urls:
        response = fetch(url)
        responses.append({'url': url, 'status': response['status'], **({'error': response['error']} if response.get('error') else {})})
        if response['status'] == 200:
            metadata = feed_metadata(response['body'])
            if metadata and (metadata['title'] or row.get('title')):
                break
    valid = metadata is not None and bool(metadata['title'] or row.get('title'))
    status = responses[-1]['status'] if responses else 0
    if not valid:
        # A failure at one instance is never evidence that the route is gone.
        status = next((r['status'] for r in responses if r['status'] not in (404, 410)), status)
    identity_confirmed = valid
    identity_status = None
    if not valid and row.get('site_url'):
        response = fetch(row['site_url'])
        identity_status = response['status']
        # A 200 challenge page alone does not confirm a creator's identity.
        title = row.get('title', '')
        identity_confirmed = response['status'] == 200 and bool(title) and title.casefold() in response['body'].decode('utf8', 'replace').casefold()
    observation = {'run_id': run_id, 'checked_at': checked_at, 'status': status, 'feed_valid': valid, 'identity_confirmed': identity_confirmed, 'identity_status': identity_status, 'attempts': responses}
    history = history + [observation]
    # Unknown identity due to a timeout/challenge is not a confirmed disappearance.
    gone = identity_status in (404, 410) and permanently_unavailable(history, identity_confirmed)
    decision = 'accept' if valid else 'permanent' if gone else 'defer'
    feed = dict(row)
    if valid:
        feed['title'] = (row.get('title') or metadata['title']).strip()[:300]
        language = row.get('language') or metadata.get('language') or 'und'
        feed['language'] = language if isinstance(language, str) and re.fullmatch(r'[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*', language) and len(language) <= 35 else 'und'
        feed['tags'] = list(dict.fromkeys(t.strip()[:100] for t in row.get('tags', []) if isinstance(t, str) and t.strip()))[:20]
    return {'key': identity(row), 'decision': decision, 'feed': feed, 'observation': observation, 'history': history}


def dump(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf8')


def read_events(stream, warn):
    """Never repair or rewrite audit logs. Only an incomplete final line is skipped."""
    for number, line in enumerate(stream, 1):
        if not line.strip():
            continue
        try:
            yield json.loads(line)
        except (ValueError, UnicodeDecodeError) as error:
            if not line.endswith(b'\n'):
                warn('Incomplete final audit line retained at line ' + str(number))
                return
            raise ValueError('Corrupt audit record at line ' + str(number)) from error


def load_results(paths):
    latest, histories, seen = {}, {}, {}
    for path in sorted(paths, key=lambda p: p.stat().st_mtime_ns):
        with path.open('rb') as stream:
            for record in read_events(stream, lambda warning: print(str(path) + ': ' + warning, file=sys.stderr)):
                key = record['key']
                history = histories.setdefault(key, [])
                signatures = seen.setdefault(key, set())
                # Read earlier nested-history records without rewriting them.
                for observation in record.get('history', []) + [record['observation']]:
                    signature = json.dumps(observation, sort_keys=True)
                    if signature not in signatures:
                        history.append(observation)
                        signatures.add(signature)
                if key not in latest or record['observation']['checked_at'] >= latest[key]['observation']['checked_at']:
                    latest[key] = record
    for key, record in latest.items():
        record['history'] = sorted(histories[key], key=lambda r: r['checked_at'])
    return latest


def collect(args):
    config = json.loads(Path(args.sources).read_text(encoding='utf8'))
    radar_response = request(RADAR_URL, 30, 8 * 1024 * 1024)
    if radar_response['status'] != 200:
        raise ValueError('Unable to download official Radar rules')
    radar = json.loads(radar_response['body'])
    candidates, failures = {}, []
    for source in config['sources']:
        response = request(source['url'], 30, 16 * 1024 * 1024)
        if response['status'] != 200:
            failures.append({'url': source['url'], 'status': response['status']})
            continue
        body = response['body']
        provenance = {'url': source['url'], 'license': source['license'], 'sha256': hashlib.sha256(body).hexdigest()}
        dump(args.work / ('source-' + hashlib.sha256(source['url'].encode()).hexdigest()[:12] + '.json'), {'provenance': provenance, 'text': body.decode('utf-8-sig')})
        for row in discover(body.decode('utf-8-sig'), source['format']):
            row.setdefault('category', source['category'])
            if 'language' in source:
                row.setdefault('language', source['language'])
            row['provenance'] = provenance
            row = convert(row, radar)
            if row:
                key = identity(row)
                if key not in candidates or (not candidates[key].get('title') and row.get('title')):
                    candidates[key] = row
        print(json.dumps({'source': source['url'], 'candidates': len(candidates)}, ensure_ascii=True), flush=True)
    if not candidates:
        raise ValueError('No candidates discovered; existing artifacts retained')
    dump(args.work / 'radar.json', {'url': RADAR_URL, 'sha256': hashlib.sha256(radar_response['body']).hexdigest(), 'rules': radar})
    dump(args.work / 'candidates.json', {'schema_version': 1, 'failures': failures, 'feeds': list(candidates.values())})


def scan(args):
    candidates = json.loads((args.work / 'candidates.json').read_text(encoding='utf8'))
    latest = load_results(args.work.glob('checks*.jsonl'))
    now = datetime.now(timezone.utc)
    checked_at = now.isoformat().replace('+00:00', 'Z')
    run_id = args.run_id or str(uuid.uuid4())
    selected = candidates['feeds'][args.offset:args.offset + args.limit if args.limit else None]
    pending = []
    for row in selected:
        previous = latest.get(identity(row))
        if previous and not args.recheck and now - datetime.fromisoformat(previous['observation']['checked_at'].replace('Z', '+00:00')) < timedelta(hours=24):
            continue
        pending.append(row)
    # Each execution gets a new append-only segment, including when run_id is reused.
    history_path = args.work / ('checks-' + str(uuid.uuid4()) + '.jsonl')
    interrupted = False
    with ThreadPoolExecutor(max_workers=args.workers) as pool, history_path.open('x', encoding='utf8') as output:
        get = curl_request if args.transport == 'curl' else request
        futures = {pool.submit(check, row, latest.get(identity(row), {}).get('history', []), run_id, None, lambda url: get(url, args.timeout), args.instance): row for row in pending}
        try:
            for n, future in enumerate(as_completed(futures), 1):
                try:
                    result = future.result()
                except Exception as error:
                    row = futures[future]
                    key = identity(row)
                    observation = {'run_id': run_id, 'checked_at': datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'), 'status': 0, 'feed_valid': False, 'identity_confirmed': False, 'identity_status': None, 'attempts': [], 'error': type(error).__name__}
                    result = {'key': key, 'decision': 'defer', 'feed': row, 'observation': observation, 'history': latest.get(key, {}).get('history', []) + [observation]}
                latest[result['key']] = result
                output.write(json.dumps({k: v for k, v in result.items() if k != 'history'}, ensure_ascii=False) + '\n')
                output.flush()
                if n % 100 == 0 or n == len(pending):
                    print(json.dumps({'checked': n, 'pending': len(pending), 'accept': sum(r['decision'] == 'accept' for r in latest.values())}), flush=True)
        except KeyboardInterrupt:
            interrupted = True
            for future in futures:
                future.cancel()
            print('Interrupted: cancelling queued checks; completed audit records retained.', file=sys.stderr)
    write_report(args.work, candidates, latest, checked_at, run_id, interrupted)
    return 130 if interrupted else 0


def write_report(work, candidates, latest, checked_at, run_id, interrupted=False):
    # Report only this candidate snapshot, never orphan records from a previous source set.
    records = [latest[identity(row)] for row in candidates['feeds'] if identity(row) in latest]
    counts = {decision: sum(r['decision'] == decision for r in records) for decision in ('accept', 'defer', 'permanent')}
    output = {'schema_version': 1, 'generated_at': checked_at, 'run_id': run_id, 'candidate_count': len(candidates['feeds']), 'source_failures': candidates.get('failures', []), 'interrupted': interrupted, 'counts': counts, 'records': records}
    dump(work / 'report.json', output)
    print(json.dumps({'report': str(work / 'report.json'), 'checked': len(records), 'unchecked': len(candidates['feeds']) - len(records), **counts}), flush=True)


def report(args):
    candidates = json.loads((args.work / 'candidates.json').read_text(encoding='utf8'))
    latest = load_results(args.work.glob('checks*.jsonl'))
    write_report(args.work, candidates, latest, datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'), 'report-' + str(uuid.uuid4()))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['discover', 'check', 'report'])
    parser.add_argument('--work', type=Path, required=True, help='Local artifact directory (never an application directory)')
    parser.add_argument('--sources', default=str(Path(__file__).with_name('sources.json')))
    parser.add_argument('--workers', type=int, default=16, choices=range(1, 129), metavar='1..128')
    parser.add_argument('--timeout', type=float, default=8)
    parser.add_argument('--limit', type=int, default=0, help='0 checks all candidates')
    parser.add_argument('--offset', type=int, default=0)
    parser.add_argument('--run-id')
    parser.add_argument('--transport', choices=['urllib', 'curl'], default='urllib', help='curl uses existing system curl for a hard per-request deadline')
    parser.add_argument('--recheck', action='store_true', help='Ignore the 24-hour resume window')
    parser.add_argument('--instance', action='append', default=None, help='Public RSSHub instance; repeat to check multiple instances')
    args = parser.parse_args()
    if args.timeout <= 0 or args.limit < 0 or args.offset < 0:
        parser.error('timeout must be positive; limit and offset must be non-negative')
    args.instance = [public_url(url) for url in (args.instance or ['https://rsshub.app'])]
    args.work.mkdir(parents=True, exist_ok=True)
    result = {'discover': collect, 'check': scan, 'report': report}[args.command](args)
    if result:
        raise SystemExit(result)


if __name__ == '__main__':
    main()
