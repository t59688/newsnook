import unittest
from pathlib import Path
import subprocess
import sys
import io
import argparse
import contextlib
import json
import tempfile
from http.client import IncompleteRead
from datetime import datetime, timezone
from unittest.mock import patch
import catalog


class CatalogTests(unittest.TestCase):
    def test_formats_preserve_identity_not_guessed_names(self):
        rows = catalog.discover('https://a.test/feed # Real Name\nhttps://b.test/rss', 'text')
        self.assertEqual(rows[0]['title'], 'Real Name')
        self.assertEqual(rows[1]['title'], '')
        rows = catalog.discover('<opml><body><outline text=中文博客 xmlUrl=https://a.test/rss htmlUrl=https://a.test/></body></opml>', 'opml')
        self.assertEqual(rows[0]['title'], '中文博客')
        self.assertEqual(rows[0]['site_url'], 'https://a.test/')
        rows = catalog.discover('Introduction, Address, RSS feed, tags\n博客, https://a.test, https://a.test/rss, 科学; 历史\n', 'csv')
        self.assertEqual(rows[0]['tags'], ['科学', '历史'])

    def test_creator_conversion_requires_explicit_id_and_radar_rule(self):
        radar = {'bilibili.com': {'space': [{'source': ['/:uid'], 'target': '/bilibili/user/video/:uid'}]}}
        row = catalog.discover('[Named Creator](https://space.bilibili.com/12345)', 'markdown')[0]
        converted = catalog.convert(row, radar)
        self.assertEqual(converted['rsshub_route'], '/bilibili/user/video/12345')
        self.assertEqual(converted['creator_id'], '12345')
        self.assertIsNone(catalog.convert(row, {}))
        self.assertEqual(catalog.discover('[Video](https://www.bilibili.com/video/BV123)', 'markdown'), [])
        imported = catalog.discover('platform,creator_id,title\nbilibili,12345,Named Creator\n', 'csv')[0]
        self.assertEqual(catalog.convert(imported, radar)['rsshub_route'], '/bilibili/user/video/12345')
        youtube = catalog.convert({'title': 'Channel', 'platform': 'youtube', 'creator_id': 'UC1234567890123456789012'}, {})
        self.assertEqual(youtube['url'], 'https://www.youtube.com/feeds/videos.xml?channel_id=UC1234567890123456789012')

    def test_feed_parser_accepts_old_and_empty_feeds_but_not_html(self):
        self.assertEqual(catalog.feed_metadata(b'<rss version="2.0"><channel><title>Old</title><item><pubDate>2001-01-01</pubDate></item></channel></rss>')['title'], 'Old')
        self.assertEqual(catalog.feed_metadata(b'<feed xmlns="http://www.w3.org/2005/Atom"><title>Empty</title></feed>')['title'], 'Empty')
        self.assertEqual(catalog.feed_metadata(b'{"version":"https://jsonfeed.org/version/1.1","title":"JSON","items":[]}')['title'], 'JSON')
        for body in [b'<html><title>Blocked</title></html>', b'<rss/>', b'{"title":"Fake"}', b'<rss><channel>']:
            self.assertIsNone(catalog.feed_metadata(body))
        self.assertIsNone(catalog.feed_metadata(b'<?xml version="1.0" encoding="unknown-encoding"?><rss><channel/></rss>'))

    def test_markdown_avatar_is_not_a_creator_name(self):
        markdown = '''[<img src="https://image.test/avatar.jpg" alt="Avatar"/>](https://space.bilibili.com/12345)
[**真实作者**](https://space.bilibili.com/12345)
[![Avatar](https://image.test/avatar.jpg)](https://space.bilibili.com/67890)
[__Another Creator__](https://space.bilibili.com/67890)
[<img src="https://image.test/unknown.jpg"/>](https://space.bilibili.com/11111)'''
        rows = catalog.discover(markdown, 'markdown')
        self.assertEqual([(row['title'], row['site_url']) for row in rows], [
            ('真实作者', 'https://space.bilibili.com/12345'),
            ('Another Creator', 'https://space.bilibili.com/67890'),
        ])

    def test_permanent_failure_needs_consecutive_independent_runs_and_seven_days(self):
        history = [{'run_id': str(n), 'checked_at': date, 'status': status} for n, date, status in [
            (1, '2026-10-01T00:00:00Z', 404), (2, '2026-10-04T00:00:00Z', 410), (3, '2026-10-08T00:00:00Z', 404)]]
        self.assertTrue(catalog.permanently_unavailable(history, False))
        self.assertFalse(catalog.permanently_unavailable(history, True))
        for status in [200, 403, 429, 500, 0]:
            self.assertFalse(catalog.permanently_unavailable(history + [{'run_id': '4', 'checked_at': '2026-10-10T00:00:00Z', 'status': status}], False))
        self.assertFalse(catalog.permanently_unavailable([dict(h, run_id='same') for h in history], False))
        self.assertFalse(catalog.permanently_unavailable(history[1:], False))

    def test_reused_run_cannot_erase_a_success_barrier(self):
        history = [
            {'run_id': 'A', 'checked_at': '2026-10-01T00:00:00Z', 'status': 404},
            {'run_id': 'B', 'checked_at': '2026-10-04T00:00:00Z', 'status': 200},
            {'run_id': 'C', 'checked_at': '2026-10-08T00:00:00Z', 'status': 404},
        ]
        row = {'url': 'https://a.test/rss', 'title': 'A', 'site_url': 'https://a.test/'}
        result = catalog.check(row, history, 'B', '2026-10-09T00:00:00Z', lambda _: {'status': 404, 'body': b''}, [])
        self.assertEqual(result['decision'], 'defer')
        self.assertEqual(len(result['history']), 4, 'success evidence is never replaced by reused run IDs')

    def test_partial_tail_preserves_complete_events_but_corrupt_middle_fails(self):
        warnings = []
        self.assertEqual(list(catalog.read_events(io.BytesIO(b'{"key":"ok"}\n{"key":"part'), warnings.append)), [{'key': 'ok'}])
        self.assertEqual(len(warnings), 1)
        with self.assertRaises(ValueError):
            list(catalog.read_events(io.BytesIO(b'{"key":"ok"}\nbroken\n'), warnings.append))

    def test_instances_are_one_observation_and_temporary_failures_keep_creators(self):
        row = {'url': 'https://rsshub.app/bilibili/user/video/123', 'title': 'Author', 'platform': 'bilibili', 'creator_id': '123', 'rsshub_route': '/bilibili/user/video/123', 'site_url': 'https://space.bilibili.com/123', 'provenance': {'url': 'https://directory.test/list', 'sha256': 'a' * 64}}
        calls = []
        def request(url):
            calls.append(url)
            return {'status': 404 if 'one.test' in url else 429, 'body': b''}
        result = catalog.check(row, [], 'run', '2026-11-04T00:00:00Z', request, ['https://one.test', 'https://two.test'])
        self.assertEqual(result['decision'], 'defer')
        self.assertEqual(result['observation']['status'], 429)
        self.assertEqual(len(result['history']), 1)
        self.assertEqual(len(calls), 3)  # two route instances, then original identity

    def test_transport_exception_preserves_prior_attempt_and_actual_identity_check(self):
        calls = []
        def get(url):
            calls.append(url)
            if 'two.test' in url:
                raise IncompleteRead(b'broken')
            return {'status': 404, 'body': b''}
        row = {'url': 'https://one.test/bilibili/user/video/123', 'rsshub_route': '/bilibili/user/video/123', 'platform': 'bilibili', 'creator_id': '123', 'title': 'Creator', 'site_url': 'https://space.bilibili.com/123'}
        start = datetime.now(timezone.utc)
        result = catalog.check(row, [], 'run', None, get, ['https://one.test', 'https://two.test'])
        self.assertEqual([attempt['status'] for attempt in result['observation']['attempts']], [404, 0])
        self.assertEqual(result['observation']['attempts'][1]['error'], 'IncompleteRead')
        self.assertEqual(result['observation']['identity_status'], 404)
        self.assertEqual(calls[-1], 'https://space.bilibili.com/123')
        checked = datetime.fromisoformat(result['observation']['checked_at'].replace('Z', '+00:00'))
        self.assertGreaterEqual(checked, start, 'timestamp is assigned when check starts, not when queued')

    def test_new_native_feed_requires_feed_confirmation_and_real_title(self):
        row = {'url': 'https://a.test/rss', 'title': '', 'provenance': {'url': 'https://directory.test/list', 'sha256': 'a' * 64}}
        result = catalog.check(row, [], 'run', '2026-11-04T00:00:00Z', lambda _: {'status': 200, 'body': b'<rss><channel><title>Real author</title></channel></rss>'}, [])
        self.assertEqual(result['decision'], 'accept')
        self.assertEqual(result['feed']['title'], 'Real author')
        result = catalog.check(row, [], 'run', '2026-11-04T00:00:00Z', lambda _: {'status': 403, 'body': b''}, [])
        self.assertEqual(result['decision'], 'defer')

    def test_help_works_in_isolated_python_without_project_modules(self):
        result = subprocess.run([sys.executable, '-I', '-B', str(Path(catalog.__file__).resolve()), '--help'], cwd=Path(catalog.__file__).parent, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('discover', result.stdout)

    def test_urls_reject_credentials_and_private_literals(self):
        for url in ['file:///a', 'http://localhost/feed', 'http://127.0.0.1/feed', 'http://[::1]/rss', 'https://user:secret@a.test/feed', 'https://a.test/feed?token=secret']:
            with self.assertRaises(ValueError, msg=url):
                catalog.public_url(url)

    def test_scan_isolates_one_bad_candidate_and_resumes_append_only(self):
        artifacts = Path.cwd() / 'artifacts'
        artifacts.mkdir(exist_ok=True)
        work = Path(tempfile.mkdtemp(prefix='feed-catalog-test-', dir=artifacts))
        feeds = [{'url': 'https://' + host + '.test/rss', 'title': ''} for host in ['bad', 'good']]
        (work / 'candidates.json').write_text(json.dumps({'feeds': feeds}), encoding='utf8')
        args = argparse.Namespace(work=work, run_id='same-run', offset=0, limit=0, recheck=False, workers=2, transport='urllib', timeout=1, instance=[])
        def get(url, _):
            if 'bad.test' in url:
                raise RuntimeError('one broken transport')
            return {'status': 200, 'body': b'<rss><channel><title>Good</title></channel></rss>'}
        with patch.object(catalog, 'request', get), contextlib.redirect_stdout(io.StringIO()):
            catalog.scan(args)
        report = json.loads((work / 'report.json').read_text(encoding='utf8'))
        self.assertEqual(report['counts'], {'accept': 1, 'defer': 1, 'permanent': 0})
        segment = next(work.glob('checks-*.jsonl'))
        original = segment.read_bytes()
        events = [json.loads(line) for line in original.splitlines()]
        self.assertTrue(all('history' not in event for event in events), 'audit segments only append new observations')
        with patch.object(catalog, 'request', side_effect=AssertionError('resume must not repeat recent requests')), contextlib.redirect_stdout(io.StringIO()):
            catalog.scan(args)
        self.assertEqual(segment.read_bytes(), original, 'resume never overwrites previous audit evidence')
        self.assertEqual(len(catalog.load_results(work.glob('checks*.jsonl'))), 2)
        with patch.object(catalog, 'request', side_effect=AssertionError('report must be offline')), contextlib.redirect_stdout(io.StringIO()):
            catalog.report(args)
        self.assertEqual(json.loads((work / 'report.json').read_text(encoding='utf8'))['counts']['accept'], 1)
        args.recheck = True
        with patch.object(catalog, 'request', side_effect=KeyboardInterrupt()), contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(catalog.scan(args), 130)
        self.assertTrue(json.loads((work / 'report.json').read_text(encoding='utf8'))['interrupted'])


if __name__ == '__main__':
    unittest.main()
