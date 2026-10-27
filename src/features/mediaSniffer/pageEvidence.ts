import { parseHTML } from 'linkedom'
import { isVideoDocumentUrl } from '../../lib/videoDocumentUrl'
import { playerDeclarationsInHtml } from './playerConfig'

/** Decide before Readability can replace a script-driven player with its poster image. */
export function isPrimaryVideoPage(html: string, pageUrl: string): boolean {
  if (isVideoDocumentUrl(pageUrl)) return true
  const { document } = parseHTML(/<html\b/i.test(html) ? html : `<html><body>${html}</body></html>`)
  const type = document.querySelector('meta[property="og:type"]')?.getAttribute('content') || ''
  if (/^video(?:\.|$)/i.test(type)) return true
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const data = JSON.parse(script.textContent || '')
      const roots = Array.isArray(data) ? data : [data, ...(Array.isArray(data?.['@graph']) ? data['@graph'] : [])]
      if (roots.some(item => item?.['@type'] === 'VideoObject' && (!item.url || new URL(item.url,pageUrl).href === pageUrl))) return true
    } catch { /* Nonliteral or unrelated metadata is not sufficient evidence. */ }
  }
  const root = document.querySelector('main, [role="main"], article') || document.body
  if (!root) return false
  for (const node of root.querySelectorAll('nav, aside, footer, .related, .related-posts, .recommendations, .recommended, .playlist')) node.remove()
  const prose = Array.from(root.querySelectorAll('p')).map(node => node.textContent || '').join(' ').trim()
  // Preserve editorial articles that happen to embed a demonstration video.
  if (prose.length >= 400 || /^article$/i.test(type) && prose.length >= 160) return false
  if (root.querySelector('video, .dplayer, .artplayer-app, .video-js, .jwplayer, [data-video-id]')) return true
  if (root.querySelector('#player iframe, .player iframe, .video-player iframe, iframe[data-video-src]')) return true
  return playerDeclarationsInHtml(html,pageUrl).length > 0
}
