export type BrowserSearchCategory = '常用' | '搜索' | 'AI' | '学术'
export type BrowserSearchProvider = {
  id: string
  name: string
  category: Exclude<BrowserSearchCategory, '常用'>
  home: string
  queryPrefix: string
  popular?: boolean
}

/** Actual, navigable query endpoints. Keep this registry independent of the UI. */
export const BROWSER_SEARCH_PROVIDERS: readonly BrowserSearchProvider[] = [
  { id: 'bing', name: 'Bing', category: '搜索', home: 'https://www.bing.com/', queryPrefix: 'https://www.bing.com/search?q=', popular: true },
  { id: 'google', name: 'Google', category: '搜索', home: 'https://www.google.com/', queryPrefix: 'https://www.google.com/search?q=', popular: true },
  { id: 'baidu', name: '百度', category: '搜索', home: 'https://www.baidu.com/', queryPrefix: 'https://www.baidu.com/s?wd=', popular: true },
  { id: 'duckduckgo', name: 'DuckDuckGo', category: '搜索', home: 'https://duckduckgo.com/', queryPrefix: 'https://duckduckgo.com/?q=', popular: true },
  { id: 'sogou', name: '搜狗', category: '搜索', home: 'https://www.sogou.com/', queryPrefix: 'https://www.sogou.com/web?query=' },
  { id: 'so360', name: '360 搜索', category: '搜索', home: 'https://www.so.com/', queryPrefix: 'https://www.so.com/s?q=' },
  { id: 'perplexity', name: 'Perplexity', category: 'AI', home: 'https://www.perplexity.ai/', queryPrefix: 'https://www.perplexity.ai/search?q=' },
  { id: 'phind', name: 'Phind', category: 'AI', home: 'https://www.phind.com/', queryPrefix: 'https://www.phind.com/search?q=' },
  { id: 'scholar', name: 'Google 学术', category: '学术', home: 'https://scholar.google.com/', queryPrefix: 'https://scholar.google.com/scholar?q=' },
  { id: 'baiduScholar', name: '百度学术', category: '学术', home: 'https://xueshu.baidu.com/', queryPrefix: 'https://xueshu.baidu.com/s?wd=' },
  { id: 'wikipedia', name: '维基百科', category: '学术', home: 'https://zh.wikipedia.org/', queryPrefix: 'https://zh.wikipedia.org/w/index.php?search=' },
]

export function browserSearchProviders(category: BrowserSearchCategory): BrowserSearchProvider[] {
  return BROWSER_SEARCH_PROVIDERS.filter(provider => category === '常用' ? provider.popular : provider.category === category)
}

export function browserSearchDestination(provider: BrowserSearchProvider, rawQuery: string): string {
  const query = rawQuery.trim()
  if (!query) return provider.home
  return `${provider.queryPrefix}${encodeURIComponent(query)}`
}
