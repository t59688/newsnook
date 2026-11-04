#!/usr/bin/env python3
"""Produce a validated, backward-compatible NewsNook RSS v1 catalog from an audit.

The published v1 snapshot excludes adult-flagged feeds because older apps do not
understand nsfw metadata. These feeds are staged separately for a future opt-in
catalog protocol. Audited network failures and stale entries are not published;
source input is never destroyed.
"""
import argparse
import collections
import csv
import json
import re
from pathlib import Path
from urllib.parse import urlsplit


def load(path):
    with open(path, 'r', encoding='utf-8-sig') as fp:
        return json.load(fp)


def norm_url(url):
    p = urlsplit(url)
    if p.scheme not in ('http', 'https') or not p.hostname or p.username or p.password or p.fragment:
        raise ValueError(f'Invalid feed URL: {url!r}')
    host = p.hostname.lower().removeprefix('www.')
    port = f':{p.port}' if p.port and p.port not in (80, 443) else ''
    path = re.sub(r'/+', '/', p.path).rstrip('/')
    return (host, port, path, p.query)


def valid_url(url):
    try:
        norm_url(url)
        return True
    except (ValueError, AttributeError, TypeError):
        return False


def select_winner(rows):
    """Choose one existing identity per resolved feed, favoring canonical links."""
    def score(rec):
        src = rec['source']
        audit = rec['audit']
        final = audit['final_url'] or src['url']
        title = str(src.get('title') or '').strip()
        is_canonical = norm_url(src['url']) == norm_url(final)
        is_generic_title = title.lower() in ('rss', 'rss feed', 'feed', 'untitled', '')
        # Prefer a publisher's already-canonical URL, then an informative title,
        # then an older stable ID from the preexisting catalog.
        return (not is_canonical, is_generic_title, src['id'])
    return min(rows, key=score)


def curate(source, audit_rows, report):
    feeds = source['feeds']
    if source['metadata']['total_feeds'] != len(feeds):
        raise ValueError('Source metadata count mismatch')
    ids = [f['id'] for f in feeds]
    if len(set(ids)) != len(ids):
        raise ValueError('Duplicate source IDs')
    if len(audit_rows) != len(feeds) or report['checked'] != len(feeds) or report['total_input'] != len(feeds):
        raise ValueError('Audit does not cover all input records')
    by_id = {}
    stats = collections.Counter()
    for row in audit_rows:
        ident = row['id']
        if ident in by_id:
            raise ValueError(f'Duplicate audit ID: {ident}')
        by_id[ident] = row
        stats[row['status']] += 1
    if dict(stats) != report['status_counts']:
        raise ValueError('Audit status totals disagree with report.json')
    rows = []
    for feed in feeds:
        row = by_id.get(feed['id'])
        if row is None or row['url'] != feed['url'] or row['title'] != feed['title']:
            raise ValueError(f'Mismatched source/audit row: {feed["id"]}')
        if not valid_url(feed['url']):
            raise ValueError(f'Invalid source feed URL: {feed["id"]}')
        if (str(feed.get('nsfw') or '').lower() in ('true', '1')) != (row['nsfw'].lower() == 'true'):
            raise ValueError(f'Mismatched NSFW flag: {feed["id"]}')
        if row['status'] != 'ok_active':
            continue
        if not (row.get('age_days', '').isdigit() and 0 <= int(row['age_days']) <= 90):
            raise ValueError(f'Active row has invalid age: {feed["id"]}')
        final = row['final_url'] or feed['url']
        if not valid_url(final):
            raise ValueError(f'Invalid redirect URL: {feed["id"]}')
        rows.append({'source': feed, 'audit': row})
    groups = collections.defaultdict(list)
    for rec in rows:
        groups[norm_url(rec['audit']['final_url'] or rec['source']['url'])].append(rec)
    chosen = [select_winner(g) for g in groups.values()]
    chosen.sort(key=lambda rec: rec['source']['id'])
    safe, sensitive = [], []
    updated_links = 0
    audited_at = report['checked_at']
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z', audited_at):
        raise ValueError('Audit completion timestamp is invalid')
    for rec in chosen:
        src = dict(rec['source'])
        row = rec['audit']
        final = row['final_url'] or src['url']
        # Change only when the publisher sends us to HTTPS. Retain stable ID.
        if final.startswith('https://') and final != src['url']:
            src['url'] = final
            updated_links += 1
        src['validation'] = {
            'status': 'live_verified', 'method': 'rss_verify_v2',
            'checked_at': row['checked_at'],
            'note': f'HTTP {row["http_status"]}, parsed {row["format"]}, {row["items"]} items; latest {row["latest_item_at"]}; activity <= 90 days.',
        }
        src['upstream_latest_item_at'] = row['latest_item_at']
        src['posts_30d'] = int(row['posts_30d'])
        src['has_image_in_feed'] = int(row['images']) > 0
        src['has_video_in_feed'] = int(row['videos']) > 0
        if row['nsfw'].lower() == 'true':
            src['nsfw'] = True
            sensitive.append(src)
        else:
            src.pop('nsfw', None)
            safe.append(src)
    # Re-check raw and normalized addresses after winner selection.
    for subset in [safe, sensitive, safe + sensitive]:
        if len({f['id'] for f in subset}) != len(subset):
            raise ValueError('Duplicate selected ID')
        if len({norm_url(f['url']) for f in subset}) != len(subset):
            raise ValueError('Duplicate selected canonical URL')
    def summary_meta(items, label):
        meta = dict(source['metadata'])
        meta.update({
            'generated_at': audited_at[:10], 'total_feeds': len(items),
            'notes': [
                'Audited on ' + audited_at[:10] + '; later network availability and publication frequency may change.',
                'Image/video hints refer to feed metadata only; media payloads were not downloaded.',
                'NSFW candidates are staged separately and excluded from the v1 public catalog.',
            ],
            'verification_scope': f'Full audit of {len(feeds)} candidates; only parsed RSS/Atom/JSON Feed with latest dated item <= 90d. {label}. Network errors are not asserted permanently dead.',
            'validation_counts': dict(collections.Counter(f['validation']['status'] for f in items)),
            'category_counts': dict(collections.Counter(f['category'] for f in items)),
            'source_counts': dict(collections.Counter(p for f in items for p in f.get('source_repositories', []))),
            'input_records': len(feeds),
        })
        return meta
    details = {
        'audit_source': report['input'],
        'audit_completed_at': report['checked_at'],
        'candidate_count': len(feeds),
        'audit_status_counts': dict(stats),
        'active_raw_count': len(rows),
        'redirect_duplicates_removed': len(rows) - len(chosen),
        'safe_published_count': len(safe),
        'nsfw_staged_count': len(sensitive),
        'active_total_after_dedup': len(chosen),
        'canonical_https_updates': updated_links,
        'published_by_language': dict(collections.Counter(f['language'] for f in safe)),
        'published_by_category': dict(collections.Counter(f['category'] for f in safe)),
        'notes': [
            'The 30-day 2-post threshold is intentionally not applied to preserve high-quality low-frequency blogs.',
            'Catalog v1 omits NSFW-flagged entries because older Android apps cannot honor an opt-in visibility flag.',
            'NSFW flag is inherited from source classification; requires editorial content review before separate opt-in publishing.',
            '429, 403, network errors and stale feeds are excluded from this snapshot, but can be reconsidered in future audits.',
        ],
    }
    return {'metadata': summary_meta(safe, 'NSFW flagged feeds excluded for v1 safety'), 'feeds': safe}, {'metadata': summary_meta(sensitive, 'Staged only; not shipped to existing clients'), 'feeds': sensitive}, details


def dump(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, 'w', encoding='utf-8', newline='\n') as fp:
        json.dump(value, fp, ensure_ascii=False, indent=2)
        fp.write('\n')


def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--input',required=True)
    ap.add_argument('--results',required=True)
    ap.add_argument('--report',required=True)
    ap.add_argument('--output',required=True)
    ap.add_argument('--nsfw-out',required=True)
    ap.add_argument('--summary-out',required=True)
    args=ap.parse_args()
    with open(args.results, newline='', encoding='utf-8-sig') as fp:
        audit=list(csv.DictReader(fp))
    safe, nsfw, summary = curate(load(args.input), audit, load(args.report))
    dump(args.output, safe)
    dump(args.nsfw_out, nsfw)
    dump(args.summary_out, summary)
    print(json.dumps(summary,ensure_ascii=False,indent=2))

if __name__=='__main__':
    main()
