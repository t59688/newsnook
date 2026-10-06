import assert from 'node:assert/strict'
import { searchOnlineFeeds } from '../src/features/feedDiscovery/onlineSearch'

const originalFetch = globalThis.fetch
const calls: string[] = []
try {
  globalThis.fetch = async (input) => {
    calls.push(String(input))
    return new Response(JSON.stringify({ results: [
      { id: 'feed/https://example.com/rss', title: 'Example', website: 'https://example.com' },
      { id: 'feed/https://example.com/rss#duplicate', title: 'Duplicate' },
      { id: 'feed/javascript:alert(1)', title: 'Invalid' },
    ] }))
  }
  assert.equal((await searchOnlineFeeds('')).length, 0)
  assert.equal(calls.length, 0, 'empty search does not download anything')
  const results = await searchOnlineFeeds('OpenAI')
  assert.equal(results.length, 1)
  assert.equal(results[0].feedUrl, 'https://example.com/rss')
  const request = new URL(calls[0], 'http://localhost')
  const target = request.searchParams.get('url') ? new URL(request.searchParams.get('url')!) : request
  assert.equal(target.hostname, 'cloud.feedly.com')
  assert.equal(target.searchParams.get('query'), 'OpenAI')
  assert.equal(target.searchParams.get('count'), '40')
  assert.equal(calls.length, 1, 'one query request, no full catalog')
  globalThis.fetch = async () => new Response('{"results":{}}')
  await assert.rejects(searchOnlineFeeds('bad'), /格式/)
  const cancelled = new AbortController()
  cancelled.abort()
  await assert.rejects(searchOnlineFeeds('cancelled', cancelled.signal), { name: 'AbortError' })
  let complete: ((response: Response) => void) | undefined
  globalThis.fetch = async () => new Promise<Response>((resolve) => { complete = resolve })
  const late = new AbortController()
  const pending = searchOnlineFeeds('old query', late.signal)
  late.abort()
  complete!(new Response('{"results":[{"id":"feed/https://example.com/late","title":"Late"}]}'))
  await assert.rejects(pending, { name: 'AbortError' }, 'late response after cancellation is discarded')
  globalThis.fetch = async () => new Response(JSON.stringify({ results: Array.from({ length: 80 }, (_, index) => ({ id: 'feed/https://example.com/' + index })) }))
  assert.equal((await searchOnlineFeeds('bounded')).length, 40)
} finally { globalThis.fetch = originalFetch }
console.log('feed discovery online: ok')
