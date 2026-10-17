/** Browser-local history and start page data. Never synchronize these records to NewsNook reading history. */
export interface BrowserVisit { url: string; title: string; time: number }
export interface BrowserShortcut { name: string; url: string }

export const DEFAULT_BROWSER_SHORTCUTS: BrowserShortcut[] = [
  { name: 'Linux.do', url: 'https://linux.do/' },
  { name: '知乎', url: 'https://www.zhihu.com/' },
  { name: 'ChatGPT', url: 'https://chatgpt.com/' },
  { name: 'Bing', url: 'https://www.bing.com/' },
]

export function normalizeBrowserHost(address: string): string {
  try {
    const url = new URL(address)
    return (url.protocol === 'https:' || url.protocol === 'http:')
      ? url.hostname.toLowerCase().replace(/^www\./, '') : ''
  } catch { return '' }
}

export function saveBrowserVisit(visits: BrowserVisit[], url: string, title: string, time = Date.now()): BrowserVisit[] {
  if (!normalizeBrowserHost(url)) return visits
  return [ { url, title: title || normalizeBrowserHost(url), time },
    ...visits.filter(visit => visit.url !== url),
  ].slice(0, 400)
}

export function compactRecentSites(visits: BrowserVisit[], hiddenHosts: readonly string[], max = 5): BrowserVisit[] {
  const hidden = new Set(hiddenHosts.map(host => host.toLowerCase().replace(/^www\./, '')))
  const seen = new Set<string>()
  return visits.slice().sort((a, b) => b.time - a.time).filter(visit => {
    const host = normalizeBrowserHost(visit.url)
    if (!host || hidden.has(host) || seen.has(host)) return false
    seen.add(host)
    return true
  }).slice(0, max)
}

export function removeSiteHistory(visits: BrowserVisit[], hostname: string): BrowserVisit[] {
  return visits.filter(visit => normalizeBrowserHost(visit.url) !== hostname.toLowerCase())
}

export function addBrowserShortcut(shortcuts: BrowserShortcut[], candidate: BrowserShortcut): BrowserShortcut[] {
  const host = normalizeBrowserHost(candidate.url)
  if (!host || !candidate.name.trim() || shortcuts.some(item => normalizeBrowserHost(item.url) === host)) return shortcuts
  return [...shortcuts, { name: candidate.name.trim().slice(0, 25), url: candidate.url }].slice(0, 8)
}

export function moveBrowserShortcut(shortcuts: BrowserShortcut[], index: number, delta: -1 | 1): BrowserShortcut[] {
  const next = index + delta
  if (index < 0 || next < 0 || index >= shortcuts.length || next >= shortcuts.length) return shortcuts
  const copy = shortcuts.slice()
  ;[copy[index], copy[next]] = [copy[next], copy[index]]
  return copy
}

/** Site favicon with no third-party lookup or tracking proxy. */
export function shortcutFaviconUrl(address: string): string | null {
  try {
    const url = new URL(address)
    if (!normalizeBrowserHost(address)) return null
    return `${url.origin}/favicon.ico`
  } catch { return null }
}
