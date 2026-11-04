"""Regression tests for the offline RSS audit curation tool."""
import importlib.util
import unittest
from pathlib import Path

module_path = Path(__file__).with_name('rss-catalog-curate.py')
spec = importlib.util.spec_from_file_location('rss_catalog_curate', module_path)
curator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(curator)


def feed(i, url, nsfw=False):
    return {
        'id': f'rss-{i:05d}', 'url': url, 'title': f'Feed {i}',
        'category': 'News', 'language': 'en', 'source_repositories': ['tests'],
        **({'nsfw': True} if nsfw else {}),
    }


def result(f, final, nsfw=False):
    return {
        'id': f['id'], 'url': f['url'], 'title': f['title'],
        'status': 'ok_active', 'final_url': final,
        'age_days': '2', 'http_status': '200', 'format': 'rss2', 'items': '12',
        'checked_at': '2026-11-04T00:00:00Z', 'latest_item_at': '2026-11-02T00:00:00Z',
        'posts_30d': '3', 'images': '2', 'videos': '0',
        'nsfw': str(nsfw),
    }


class CurateTests(unittest.TestCase):
    def test_excludes_nsfw_and_collapses_redirects(self):
        a = feed(1, 'https://old.example.org/feed')
        b = feed(2, 'https://new.example.org/feed')
        c = feed(3, 'https://adult.example.org/rss', True)
        src = {'metadata': {'total_feeds': 3, 'schema_version': 1, 'generated_at': '2026-11-04'}, 'feeds': [a, b, c]}
        results = [
            result(a, 'https://new.example.org/feed'),
            result(b, 'https://new.example.org/feed'),
            result(c, c['url'], nsfw=True),
        ]
        report = {'checked': 3, 'total_input': 3, 'status_counts': {'ok_active': 3}, 'input': 'test.json', 'checked_at': '2026-11-04T00:00:00Z'}
        safe, adult, audit = curator.curate(src, results, report)
        self.assertEqual([x['id'] for x in safe['feeds']], [b['id']])
        self.assertEqual([x['id'] for x in adult['feeds']], [c['id']])
        self.assertEqual(audit['redirect_duplicates_removed'], 1)
        self.assertEqual(safe['metadata']['total_feeds'], 1)
        self.assertEqual(adult['metadata']['total_feeds'], 1)
        self.assertFalse(any(x.get('nsfw') for x in safe['feeds']))

    def test_fails_closed_on_missing_or_corrupt_audit(self):
        x = feed(1, 'https://news.example.org/rss')
        src = {'metadata': {'total_feeds': 1}, 'feeds': [x]}
        row = result(x, x['url'])
        report = {'checked': 1, 'total_input': 1, 'status_counts': {'ok_active': 1}, 'input': 'test.json', 'checked_at': '2026-11-04T00:00:00Z'}
        with self.assertRaisesRegex(ValueError, 'Audit does not cover'):
            curator.curate(src, [], report)
        with self.assertRaisesRegex(ValueError, 'Mismatched NSFW'):
            curator.curate(src, [{**row, 'nsfw': 'True'}], report)
        with self.assertRaisesRegex(ValueError, 'status totals'):
            curator.curate(src, [row], {**report, 'status_counts': {'stale': 1}})


if __name__ == '__main__':
    unittest.main()
