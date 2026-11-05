/** Browser-local history and start page data. Never synchronize these records to NewsNook reading history. */
export interface BrowserVisit { url: string; title: string; time: number }
export interface BrowserShortcut { name: string; url: string }

export const DEFAULT_BROWSER_SHORTCUTS: BrowserShortcut[] = [
  { name: 'GitHub 仓库', url: 'https://github.com/t59688/newsnook' },
  { name: '微信公众号', url: 'https://mp.weixin.qq.com/s/d8fJvLQ4o7wjr_4YBXGgqQ' },
  { name: 'Linux.do', url: 'https://linux.do/' },
  { name: '维基百科', url: 'https://zh.wikipedia.org/' },
  { name: 'ChatGPT', url: 'https://chatgpt.com/' },
  { name: 'Google', url: 'https://www.google.com/' },
]

function browserUrl(value: unknown): URL | null {
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    const url = new URL(value.trim())
    return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password ? url : null
  } catch { return null }
}

export function normalizeBrowserHost(address: string): string {
  return browserUrl(address)?.hostname.toLowerCase().replace(/^www\./, '') ?? ''
}

/** Validate persisted data at the boundary; one broken record must not break the browser. */
export function normalizeBrowserVisits(value: unknown): BrowserVisit[] {
  if (!Array.isArray(value)) return []
  const visits: BrowserVisit[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const url = browserUrl(item.url)
    if (!url || typeof item.time !== 'number' || !Number.isFinite(item.time) || item.time < 0) continue
    const title = typeof item.title === 'string' ? item.title.trim() : ''
    visits.push({ url: url.href, title: title || normalizeBrowserHost(url.href), time: item.time })
  }
  const seen = new Set<string>()
  return visits.sort((a, b) => b.time - a.time).filter(visit => {
    if (seen.has(visit.url)) return false
    seen.add(visit.url)
    return true
  }).slice(0, 500)
}

export function normalizeHiddenBrowserHosts(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const hosts = value.flatMap(item => {
    if (typeof item !== 'string' || !item.trim() || /[\s/?#@]/.test(item.trim())) return []
    const host = normalizeBrowserHost(`https://${item.trim()}`)
    return host ? [host] : []
  })
  return [...new Set(hosts)].slice(0, 400)
}

const LEGACY_DEFAULT_HOSTS = new Set(['linux.do', 'zhihu.com', 'chatgpt.com', 'bing.com'])

export function normalizeBrowserShortcuts(value: unknown): BrowserShortcut[] {
  if (!Array.isArray(value)) return DEFAULT_BROWSER_SHORTCUTS.map(item => ({ ...item }))
  let shortcuts: BrowserShortcut[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object' || typeof item.name !== 'string' || typeof item.url !== 'string') continue
    shortcuts = addBrowserShortcut(shortcuts, item)
    if (shortcuts.length === 8) break
  }
  // 未曾自定义过快捷方式的老用户（刚好命中旧版 4 项默认值）：平滑升级至包含官方渠道与 Google 的新默认项
  if (
    shortcuts.length === 4 &&
    shortcuts.every(item => LEGACY_DEFAULT_HOSTS.has(normalizeBrowserHost(item.url)))
  ) {
    return DEFAULT_BROWSER_SHORTCUTS.map(item => ({ ...item }))
  }
  return shortcuts
}

export function saveBrowserVisit(visits: BrowserVisit[], address: string, title: string, time = Date.now()): BrowserVisit[] {
  const url = browserUrl(address)
  if (!url || !Number.isFinite(time) || time < 0) return visits
  return [{ url: url.href, title: title.trim() || normalizeBrowserHost(url.href), time },
    ...visits.filter(visit => browserUrl(visit.url)?.href !== url.href),
  ].slice(0, 400)
}

export function compactRecentSites(visits: BrowserVisit[], hiddenHosts: readonly string[], max = 5): BrowserVisit[] {
  const hidden = new Set(normalizeHiddenBrowserHosts(hiddenHosts))
  const seen = new Set<string>()
  return visits.slice().sort((a, b) => b.time - a.time).filter(visit => {
    const host = normalizeBrowserHost(visit.url)
    if (!host || hidden.has(host) || seen.has(host)) return false
    seen.add(host)
    return true
  }).slice(0, Math.max(0, max))
}

export function removeSiteHistory(visits: BrowserVisit[], hostname: string): BrowserVisit[] {
  const host = normalizeHiddenBrowserHosts([hostname])[0]
  return host ? visits.filter(visit => normalizeBrowserHost(visit.url) !== host) : visits
}

export function addBrowserShortcut(shortcuts: BrowserShortcut[], candidate: BrowserShortcut): BrowserShortcut[] {
  const url = browserUrl(candidate.url)
  const host = url ? normalizeBrowserHost(url.href) : ''
  if (!url || !host || !candidate.name.trim() || shortcuts.length >= 8 || shortcuts.some(item => normalizeBrowserHost(item.url) === host)) return shortcuts
  return [...shortcuts, { name: candidate.name.trim().slice(0, 25), url: url.href }]
}

export function moveBrowserShortcut(shortcuts: BrowserShortcut[], index: number, delta: -1 | 1): BrowserShortcut[] {
  const next = index + delta
  if (!Number.isInteger(index) || index < 0 || next < 0 || index >= shortcuts.length || next >= shortcuts.length) return shortcuts
  const copy = shortcuts.slice()
  ;[copy[index], copy[next]] = [copy[next], copy[index]]
  return copy
}

/** Site favicon with no third-party lookup or tracking proxy. */
export function shortcutFaviconUrl(address: string): string | null {
  const url = browserUrl(address)
  return url ? `${url.origin}/favicon.ico` : null
}
