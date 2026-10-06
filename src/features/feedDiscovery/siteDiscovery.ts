import { FEED_ACCEPT } from '../../lib/feedPayload'
import { fetchAbsoluteText } from '../../lib/http'
import { discoverFeedsFromHtml } from '../../lib/opml'

import { validateFeedUrl } from './routeBuilder'
import type { FeedDiscoveryEntry } from './types'

interface FeedsearchResult {
  url?: unknown
  title?: unknown
  description?: unknown
  site_url?: unknown
}

function directEntry(
  url: string,
  title: string,
  siteUrl: string,
  description?: string,
  providerId = 'direct-discovery',
): FeedDiscoveryEntry {
  return {
    providerId,
    entryId: url,
    type: 'direct',
    title: title.trim() || url,
    description: description?.trim() || undefined,
    categories: [],
    siteUrl,
    feedUrl: url,
    statusNote:
      providerId === 'feedsearch'
        ? '由 Feedsearch 发现，订阅前仍会实际预览'
        : '由目标网站直接发现，订阅前仍会实际预览',
  }
}

export async function discoverSiteFeeds(
  rawUrl: string,
  signal?: AbortSignal,
): Promise<FeedDiscoveryEntry[]> {
  const controller = new AbortController()
  const forwardAbort = () => controller.abort()
  signal?.addEventListener('abort', forwardAbort, { once: true })
  if (signal?.aborted) forwardAbort()
  const timer = globalThis.setTimeout(() => controller.abort(), 30_000)
  try {
    return await discoverSiteFeedsWithSignal(rawUrl, controller.signal)
  } finally {
    globalThis.clearTimeout(timer)
    signal?.removeEventListener('abort', forwardAbort)
  }
}

async function discoverSiteFeedsWithSignal(rawUrl: string, signal: AbortSignal): Promise<FeedDiscoveryEntry[]> {
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
  const siteUrl = validateFeedUrl(rawUrl)
  let html = ''
  try { html = await fetchAbsoluteText(siteUrl, { signal }) } catch (error) {
    if (signal.aborted) throw error
  }
  const local = discoverFeedsFromHtml(html, siteUrl)
  if (local.length) {
    const entries: FeedDiscoveryEntry[] = []
    for (const feed of local) {
      try { entries.push(directEntry(validateFeedUrl(feed.url), feed.title || siteUrl, siteUrl)) } catch { /* skip invalid links */ }
    }
    if (entries.length) return entries
  }

  const endpoint =
    'https://origin.feedsearch.dev/api/v1/search?url=' + encodeURIComponent(siteUrl)
  const payload = await fetchAbsoluteText(endpoint, {
    signal,
    accept: 'application/json',
    headers: { Accept: 'application/json' },
  })
  let parsed: unknown
  try {
    parsed = JSON.parse(payload)
  } catch {
    throw new Error('Feedsearch 返回了无法识别的数据')
  }
  const rows = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { results?: unknown }).results)
      ? ((parsed as { results: unknown[] }).results)
      : []

  const entries: FeedDiscoveryEntry[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const item = row as FeedsearchResult
    if (typeof item.url !== 'string') continue
    let url: string
    try {
      url = validateFeedUrl(item.url)
    } catch {
      continue
    }
    if (seen.has(url)) continue
    seen.add(url)
    entries.push(
      directEntry(
        url,
        typeof item.title === 'string' ? item.title : url,
        typeof item.site_url === 'string' ? item.site_url : siteUrl,
        typeof item.description === 'string' ? item.description : undefined,
        'feedsearch',
      ),
    )
  }
  return entries
}

export async function probeDirectFeed(
  rawUrl: string,
  signal?: AbortSignal,
): Promise<string> {
  const url = validateFeedUrl(rawUrl)
  await fetchAbsoluteText(url, {
    signal,
    accept: FEED_ACCEPT,
    headers: { Accept: FEED_ACCEPT },
  })
  return url
}
