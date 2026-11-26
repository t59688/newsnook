import type { NewsSource } from '../../sources/registry'

/**
 * Native background jobs are deliberately restricted to direct HTTPS XML feeds.
 * Special website parsers, POST APIs, and RSSHub proxy routes still use the
 * existing in-app source transport, and are never advertised as background-ready.
 */
export function supportsNativeSourceWatch(source: NewsSource): boolean {
  return (source.kind === 'feed' || source.kind === 'google-news')
    && source.url.startsWith('https://')
    && source.requestMethod !== 'POST'
    && source.discovery?.generator !== 'rsshub'
    && !source.paused
}
