"""Repeatable public platform identity collection; Python standard library only.

Identity indexing is not a Feed availability test. Run catalog.py check against
the emitted candidates.json separately when live observations are needed.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
from urllib.parse import urlencode

from catalog import curl_request, dump

PLATFORMS = {
    'bilibili': ('P6455', 'bilibili/video.ts', 'Videos'),
    'youtube': ('P2397', 'youtube/channel.ts', 'Videos'),
    'weibo': ('P3579', 'weibo/user.ts', 'Communities'),
    'zhihu': ('P6451', 'zhihu/answers.ts', 'Communities'),
    'xiaohongshu': ('P12038', 'xiaohongshu/user.ts', 'Videos'),
    'douyin': ('P7120', 'douyin/user.ts', 'Videos'),
    'twitter': ('P2002', 'twitter/user.ts', 'Communities'),
}
TOPICS = {
    'singer': ('Music', '音乐'), 'musician': ('Music', '音乐'), 'composer': ('Music', '音乐'),
    'musical group': ('Music', '音乐'), 'band': ('Music', '音乐'), 'rapper': ('Music', '音乐'),
    'actor': ('Movies', '影视'), 'film actor': ('Movies', '影视'), 'film director': ('Movies', '影视'),
    'athlete': ('Sports', '体育'), 'association football player': ('Football', '足球'),
    'association football club': ('Football', '足球'), 'writer': ('Books', '图书'),
    'journalist': ('News', '新闻'), 'newspaper': ('News', '新闻'), 'news agency': ('News', '新闻'),
    'politician': ('Politics & Geopolitics', '政治'), 'entrepreneur': ('Business & Economy', '商业'),
    'scientist': ('Science', '科学'), 'physicist': ('Science', '科学'), 'mathematician': ('Science', '数学'),
    'university': ('Education & Learning', '教育'), 'research institute': ('Research & Science', '科研'),
    'chef': ('Food', '美食'), 'photographer': ('Photography', '摄影'), 'historian': ('History', '历史'),
    'video game developer': ('Gaming', '游戏'), 'esports team': ('Gaming', '游戏'),
}


def conversion(platform, account):
    """Only exact identifiers supported by the separately cached official rule."""
    if platform == 'weibo':
        account = account.removeprefix('u/')
    if platform == 'bilibili' and re.fullmatch(r'[1-9][0-9]{0,19}', account):
        site, route = 'https://space.bilibili.com/' + account, '/bilibili/user/video/' + account
    elif platform == 'youtube' and re.fullmatch(r'UC[A-Za-z0-9_-]{22}', account):
        return account, 'https://www.youtube.com/channel/' + account, 'https://www.youtube.com/feeds/videos.xml?channel_id=' + account, None
    elif platform == 'weibo' and re.fullmatch(r'[0-9]{5,15}', account):
        site, route = 'https://weibo.com/u/' + account, '/weibo/user/' + account
    elif platform == 'zhihu' and re.fullmatch(r'[A-Za-z0-9_-]{1,100}', account):
        site, route = 'https://www.zhihu.com/people/' + account, '/zhihu/people/answers/' + account
    elif platform == 'xiaohongshu' and re.fullmatch(r'[a-f0-9]{24}', account):
        site, route = 'https://www.xiaohongshu.com/user/profile/' + account, '/xiaohongshu/user/' + account + '/notes'
    elif platform == 'douyin' and re.fullmatch(r'MS4wLjABAAAA[A-Za-z0-9_-]{1,88}', account):
        site, route = 'https://www.douyin.com/user/' + account, '/douyin/user/' + account
    elif platform == 'twitter' and re.fullmatch(r'[A-Za-z0-9_]{1,15}', account):
        account = account.lower()
        site, route = 'https://x.com/' + account, '/twitter/user/' + account
    else:
        return None
    return account, site, 'https://rsshub.app' + route, route


def build_records(data, platform, provenance, rule_sha):
    records, unresolved = {}, []
    rule_file = PLATFORMS[platform][1]
    for binding in data['results']['bindings']:
        values = {key: field['value'] for key, field in binding.items()}
        title = values.get('zh') or values.get('en') or ''
        converted = conversion(platform, values['id'])
        if not converted or not title.strip() or re.fullmatch(r'Q[0-9]+', title):
            unresolved.append({'entity': values.get('item'), 'account': values['id'], 'name': title, 'reason': 'Missing named identity or route-compatible identifier'})
            continue
        account, site, url, route = converted
        if account not in records:
            feed = {'title': title.strip()[:300], 'platform': platform, 'creator_id': account, 'site_url': site, 'url': url,
                    'category': PLATFORMS[platform][2], 'language': 'und', 'aliases': [], 'tags': [], 'provenance': provenance}
            if route:
                feed['rsshub_route'] = route
            records[account] = {'decision': 'index', 'feed': feed, 'evidence': {'source_url': provenance['url'], 'source_sha256': provenance['sha256'],
                'site_url': site, 'route_source_url': 'https://raw.githubusercontent.com/DIYgod/RSSHub/master/lib/routes/' + rule_file, 'route_source_sha256': rule_sha}}
        feed = records[account]['feed']
        for key in ('en', 'zh'):
            alias = values.get(key, '').strip()[:100]
            if alias and alias not in feed['aliases'] and len(feed['aliases']) < 20:
                feed['aliases'].append(alias)
        topic = TOPICS.get(values.get('typeEn', ''))
        if topic:
            feed['category'] = topic[0]
            if topic[1] not in feed['tags']:
                feed['tags'].append(topic[1])
    rows = list(records.values())
    report = {'schema_version': 1, 'candidate_count': len(rows), 'counts': {'index': len(rows), 'accept': 0, 'defer': 0, 'permanent': 0}, 'records': rows}
    return report, unresolved


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--platform', choices=PLATFORMS, required=True)
    parser.add_argument('--work', type=Path, required=True)
    parser.add_argument('--limit', type=int, default=20000)
    parser.add_argument('--cached', action='store_true', help='Rebuild offline from saved raw.json, source.json and route.ts')
    args = parser.parse_args()
    if not 1 <= args.limit <= 100000:
        parser.error('--limit must be 1..100000')
    args.work.mkdir(parents=True, exist_ok=True)
    prop, rule_file, _ = PLATFORMS[args.platform]
    rule_url = 'https://raw.githubusercontent.com/DIYgod/RSSHub/master/lib/routes/' + rule_file
    if not args.cached:
        query = f'''PREFIX wdt:<http://www.wikidata.org/prop/direct/> PREFIX rdfs:<http://www.w3.org/2000/01/rdf-schema#>
SELECT ?item ?id ?en ?zh ?typeEn WHERE {{ ?item wdt:{prop} ?id .
OPTIONAL{{?item rdfs:label ?en FILTER(LANG(?en)="en")}} OPTIONAL{{?item rdfs:label ?zh FILTER(LANG(?zh)="zh")}}
OPTIONAL{{?item (wdt:P31|wdt:P106) ?type . ?type rdfs:label ?typeEn FILTER(LANG(?typeEn)="en")}}
FILTER(BOUND(?en)||BOUND(?zh)) }} LIMIT {args.limit}'''
        source_url = 'https://qlever.dev/api/wikidata?' + urlencode({'query': query, 'action': 'json_export'})
        raw = curl_request(source_url, 55, 24 * 1024 * 1024)
        rule = curl_request(rule_url, 20)
        if raw['status'] != 200 or rule['status'] != 200:
            raise ValueError('Source or rule unavailable; existing evidence retained, retry later')
        json.loads(raw['body'])['results']['bindings']
        (args.work / 'raw.json').write_bytes(raw['body'])
        (args.work / 'route.ts').write_bytes(rule['body'])
        (args.work / 'query.sparql').write_text(query, encoding='utf8')
        dump(args.work / 'source.json', {'url': source_url, 'license': 'CC0-1.0', 'platform': args.platform, 'property': prop, 'route_source_url': rule_url, 'sha256': hashlib.sha256(raw['body']).hexdigest(), 'route_sha256': hashlib.sha256(rule['body']).hexdigest(), 'row_limit': args.limit})
    raw = (args.work / 'raw.json').read_bytes()
    provenance = json.loads((args.work / 'source.json').read_text(encoding='utf8'))
    if provenance.get('platform') != args.platform or provenance.get('property') != prop or provenance.get('route_source_url') != rule_url:
        raise ValueError('Cached platform/property/rule mismatch; select matching --platform or recollect')
    if hashlib.sha256(raw).hexdigest() != provenance['sha256']:
        raise ValueError('Cached identity source hash mismatch')
    rule_sha = hashlib.sha256((args.work / 'route.ts').read_bytes()).hexdigest()
    if rule_sha != provenance.get('route_sha256'):
        raise ValueError('Cached official route hash mismatch')
    report, unresolved = build_records(json.loads(raw), args.platform, provenance, rule_sha)
    dump(args.work / 'report.json', report)
    dump(args.work / 'unresolved.json', unresolved)
    dump(args.work / 'candidates.json', {'schema_version': 1, 'failures': [], 'feeds': [row['feed'] for row in report['records']]})
    print(json.dumps({'indexed': report['counts']['index'], 'unresolved': len(unresolved), 'row_limit': provenance.get('row_limit'), 'feed_verified': False}))


if __name__ == '__main__':
    main()
