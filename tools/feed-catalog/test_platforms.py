import unittest
import platforms
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile


class PlatformTests(unittest.TestCase):
    source = {'url': 'https://directory.test/query', 'license': 'CC0-1.0', 'sha256': 'a' * 64}

    def row(self, account, **values):
        return {key: {'value': value} for key, value in {'item': 'https://www.wikidata.org/entity/Q1', 'id': account, **values}.items()}

    def build(self, platform, rows):
        return platforms.build_records({'results': {'bindings': rows}}, platform, self.source, 'b' * 64)

    def test_named_bilibili_identity_keeps_bilingual_aliases_and_explicit_topic(self):
        report, unresolved = self.build('bilibili', [self.row('12345', zh='真实作者', en='Real Creator', typeEn='singer')])
        self.assertEqual(unresolved, [])
        row = report['records'][0]
        self.assertEqual(row['decision'], 'index')
        self.assertNotIn('observation', row, 'identity is never fabricated into a successful Feed fetch')
        self.assertEqual(row['feed']['rsshub_route'], '/bilibili/user/video/12345')
        self.assertIn('Real Creator', row['feed']['aliases'])
        self.assertEqual(row['feed']['category'], 'Music')
        self.assertEqual(row['feed']['language'], 'und')
        self.assertEqual(row['evidence']['source_sha256'], self.source['sha256'])

    def test_only_route_compatible_ids_become_feed_candidates(self):
        for platform, invalid, valid in [('weibo', 'some_name', 'u/1234567'), ('xiaohongshu', 'oldname', '0123456789abcdef01234567'), ('douyin', '123456789', 'MS4wLjABAAAAexampleUserID'), ('twitter', 'invalid/handle', 'Example_user')]:
            report, unresolved = self.build(platform, [self.row(invalid, en='Unknown Route'), self.row(valid, en='Known Route')])
            self.assertEqual(report['counts']['index'], 1, platform)
            self.assertEqual(len(unresolved), 1, platform)
            self.assertEqual(report['records'][0]['feed']['title'], 'Known Route')

    def test_youtube_requires_explicit_channel_and_uses_native_feed(self):
        report, unresolved = self.build('youtube', [self.row('UC1234567890123456789012', en='Channel'), self.row('@handle', en='Unresolved')])
        self.assertEqual(report['records'][0]['feed']['url'], 'https://www.youtube.com/feeds/videos.xml?channel_id=UC1234567890123456789012')
        self.assertNotIn('rsshub_route', report['records'][0]['feed'])
        self.assertEqual(len(unresolved), 1)

    def test_no_guessed_names_and_same_platform_id_deduplication(self):
        report, unresolved = self.build('bilibili', [self.row('123', en='Named'), self.row('123', en='Named', typeEn='singer'), self.row('456'), self.row('789', en='Q789')])
        self.assertEqual(report['counts']['index'], 1)
        self.assertEqual(len(unresolved), 2)
        self.assertEqual(report['records'][0]['feed']['category'], 'Music')

    def test_cached_collection_checks_both_identity_and_rule_hashes(self):
        with tempfile.TemporaryDirectory() as directory:
            work = Path(directory)
            raw = json.dumps({'results': {'bindings': [self.row('12345', en='Creator')]}}).encode()
            rule = b'official rule fixture'
            (work / 'raw.json').write_bytes(raw)
            (work / 'route.ts').write_bytes(rule)
            (work / 'source.json').write_text(json.dumps({**self.source, 'platform': 'bilibili', 'property': 'P6455', 'route_source_url': 'https://raw.githubusercontent.com/DIYgod/RSSHub/master/lib/routes/bilibili/video.ts', 'sha256': hashlib.sha256(raw).hexdigest(), 'route_sha256': hashlib.sha256(rule).hexdigest()}))
            command = [sys.executable, '-B', str(Path(platforms.__file__).resolve()), '--cached', '--platform', 'bilibili', '--work', directory]
            self.assertEqual(subprocess.run(command, capture_output=True).returncode, 0)
            original = (work / 'report.json').read_bytes()
            mismatched = command.copy()
            mismatched[mismatched.index('bilibili')] = 'weibo'
            self.assertNotEqual(subprocess.run(mismatched, capture_output=True).returncode, 0, 'a Bilibili UID cache must not be relabeled as Weibo accounts')
            self.assertEqual((work / 'report.json').read_bytes(), original)
            (work / 'route.ts').write_bytes(b'changed')
            self.assertNotEqual(subprocess.run(command, capture_output=True).returncode, 0)
            self.assertEqual((work / 'report.json').read_bytes(), original, 'bad cache must not rewrite the report')


if __name__ == '__main__':
    unittest.main()
