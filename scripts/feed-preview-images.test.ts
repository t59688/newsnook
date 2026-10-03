import assert from 'node:assert/strict'
import { parseSourcePayload } from '../src/lib/parseFeed'
import type { NewsSource } from '../src/sources/registry'

const source: NewsSource = { id: 'test', name: 'Test', label: 'Test', group: 'custom', kind: 'feed', url: 'https://example.org/rss', enabled: true }
const parse = (media: string, body = '') => parseSourcePayload(source, `<rss xmlns:media="http://search.yahoo.com/mrss/"><channel><item><title>News</title><link>https://example.org/news</link>${media}<description><![CDATA[${body}]]></description></item></channel></rss>`)[0]

assert.equal(parse('<media:group><media:content url="https://example.org/video.mp4" type="video/mp4"/><media:thumbnail url="https://example.org/photo.jpg"/></media:group>')?.image, 'https://example.org/photo.jpg', 'nested Media RSS thumbnail must reach the news card')
assert.equal(parse('<media:content url="https://example.org/video.mp4" type="video/mp4"/><media:content url="https://example.org/photo.jpg" type="image/jpeg"/>')?.image, 'https://example.org/photo.jpg', 'video URL must not be selected as a cover')
assert.equal(parse('', '<img src="data:image/gif;base64,R0lG" data-src="https://example.org/photo.jpg">')?.image, 'https://example.org/photo.jpg', 'lazy body image must replace the tracking placeholder')
assert.equal(parse('<enclosure url="https://example.org/document.pdf" type="application/pdf"/>')?.image, undefined, 'non-image attachment must not create an empty preview')
assert.equal(parse('', '<p>Text only</p>')?.image, undefined)
console.log('feed-preview-images: ok')
