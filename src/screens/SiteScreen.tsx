import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Loader2, Search, X } from 'lucide-react'

import { fetchAbsoluteText } from '../lib/http'
import { catalogHtmlToArticles } from '../features/catalogEngine/toArticles'
import {
  frameworkPageUrl,
  frameworkCategoryPageUrl,
  frameworkSearchUrl,
} from '../features/frameworkDetect/buildPageUrl'
import type { FrameworkHint, FrameworkSortKey } from '../features/frameworkDetect/types'
import type { NewsSource } from '../sources/registry'
import type { Article } from '../lib/types'

const PAGINATION_NOISE_RE = /\/vodtype\/\d+-\d+\/|\/vod\/type\/id\/\d+\/page\/|\/type\/\d+-\d+\.html|vod-show-id-\d+-p-\d+|[?&]page=\d/i

function filterFrameworkNoise(articles: Article[], hint: FrameworkHint): Article[] {
  const catUrls = new Set(hint.categories?.map((c) => c.url) ?? [])
  return articles.filter((a) => {
    if (catUrls.has(a.originUrl)) return false
    if (PAGINATION_NOISE_RE.test(a.originUrl)) return false
    if (/^go to page\s*\d*$/i.test(a.title)) return false
    return true
  })
}

interface SiteSource {
  source: NewsSource
  hint: FrameworkHint
}

interface Props {
  sites: SiteSource[]
  readIds: Set<string>
  onOpen: (article: Article) => void
  onBack?: () => void
}

export const SiteScreen = memo(function SiteScreen({
  sites,
  readIds,
  onOpen,
  onBack,
}: Props) {
  const [activeSiteIdx, setActiveSiteIdx] = useState(0)
  const [activeCatIdx, setActiveCatIdx] = useState<number | null>(
    sites[0]?.hint.categories?.length ? 0 : null,
  )
  const [articles, setArticles] = useState<Article[]>([])
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [searchQuery, setSearchQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [searchResults, setSearchResults] = useState<Article[] | null>(null)
  const [activeSortKey, setActiveSortKey] = useState<FrameworkSortKey>('default')
  const abortRef = useRef<AbortController | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const activeSite = sites[activeSiteIdx]

  const fetchPage = useCallback(async (
    site: SiteSource,
    catIdx: number | null,
    pageNum: number,
    sortKey: FrameworkSortKey,
  ) => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setLoading(true)
    setSearchResults(null)
    try {
      let url: string
      if (catIdx !== null && site.hint.categories?.[catIdx]) {
        url = frameworkCategoryPageUrl(
          site.hint.categories[catIdx].url,
          pageNum,
          site.hint,
          sortKey,
        )
      } else {
        url = frameworkPageUrl(site.source.url, pageNum, site.hint.paginationPattern)
      }

      const html = await fetchAbsoluteText(url)
      if (controller.signal.aborted) return

      const raw = catalogHtmlToArticles(site.source, html, Date.now())
      const results = filterFrameworkNoise(raw, site.hint)
      setArticles(results)
      setPage(pageNum)

      if (results.length === 0 && pageNum > 0) {
        setTotalPages(pageNum)
      } else {
        setTotalPages(Math.max(totalPages, pageNum + 2))
      }
    } catch {
      if (!controller.signal.aborted) setArticles([])
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }, [totalPages])

  useEffect(() => {
    if (!activeSite) return
    setPage(0)
    setTotalPages(5)
    fetchPage(activeSite, activeCatIdx, 0, activeSortKey)
    listRef.current?.scrollTo({ top: 0 })
  }, [activeSiteIdx, activeCatIdx, activeSortKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const goPage = useCallback((p: number) => {
    if (!activeSite || loading) return
    fetchPage(activeSite, activeCatIdx, p, activeSortKey)
    listRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }, [activeSite, activeCatIdx, activeSortKey, loading, fetchPage])

  const handleSearch = useCallback(async () => {
    if (!activeSite?.hint.searchTemplate || !searchQuery.trim()) return
    const url = frameworkSearchUrl(
      activeSite.hint,
      activeSite.hint.searchTemplate,
      searchQuery.trim(),
      activeSortKey,
    )
    setSearching(true)
    try {
      const html = await fetchAbsoluteText(url)
      const raw = catalogHtmlToArticles(activeSite.source, html, Date.now())
      setSearchResults(filterFrameworkNoise(raw, activeSite.hint))
    } catch {
      setSearchResults([])
    } finally {
      setSearching(false)
    }
  }, [activeSite, activeSortKey, searchQuery])

  const clearSearch = useCallback(() => {
    setSearchQuery('')
    setSearchResults(null)
  }, [])

  const displayedArticles = searchResults ?? articles
  const categories = activeSite?.hint.categories
  const sortOptions = activeSite?.hint.sortOptions

  if (!sites.length) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-paper-muted">
        <p className="text-[14px]">暂无已适配的站点</p>
        <p className="mt-1 text-[12px] text-paper-faint">
          在「自定义订阅」中添加支持的网站，探测后会自动出现在这里
        </p>
      </div>
    )
  }

  return (
    <div ref={listRef} className="h-full overflow-y-auto overscroll-contain">
      {/* 固定头部：站点切换 + 搜索 + 分类 */}
      <div className="sticky top-0 z-10 border-b border-haze/50 bg-ink/95 backdrop-blur-xl">
        <div className="page-x flex items-center gap-2 overflow-x-auto py-2.5 scrollbar-none">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="shrink-0 flex items-center gap-0.5 rounded-full bg-paper/8 px-2.5 py-1.5 text-[13px] font-medium text-paper-muted hover:bg-paper/15 transition-colors"
            >
              <ChevronLeft size={14} />
              返回
            </button>
          )}
          {sites.map((s, idx) => (
            <button
              key={s.source.id}
              type="button"
              onClick={() => {
                setActiveSiteIdx(idx)
                setActiveCatIdx(sites[idx]?.hint.categories?.length ? 0 : null)
                setActiveSortKey('default')
                setSearchQuery('')
                setSearchResults(null)
              }}
              className={`shrink-0 rounded-full px-4 py-1.5 text-[13px] font-medium transition-colors ${
                idx === activeSiteIdx
                  ? 'bg-cinnabar text-white'
                  : 'bg-paper/8 text-paper-muted hover:bg-paper/15'
              }`}
            >
              {s.source.label || s.source.name}
            </button>
          ))}
        </div>

        {activeSite?.hint.searchTemplate && (
          <div className="page-x flex items-center gap-2 pb-2">
            <div className="relative flex-1">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-paper-muted/60" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                placeholder="搜索信源 / 浏览信源"
                className="w-full rounded-xl border border-haze bg-paper/5 py-2.5 pl-9 pr-9 text-[13px] text-paper placeholder:text-paper-muted/40 focus:border-cinnabar/40 focus:outline-none"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={clearSearch}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-paper-muted hover:text-paper"
                >
                  <X size={14} />
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={handleSearch}
              disabled={searching || !searchQuery.trim()}
              className="shrink-0 rounded-xl bg-cinnabar/90 px-4 py-2.5 text-[13px] font-medium text-white transition-colors hover:bg-cinnabar disabled:opacity-40"
            >
              {searching ? <Loader2 size={14} className="animate-spin" /> : '搜索'}
            </button>
          </div>
        )}

        {sortOptions && sortOptions.length > 1 && (
          <div className="page-x flex gap-2 overflow-x-auto pb-2 scrollbar-none">
            {sortOptions.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => {
                  setActiveSortKey(option.key)
                  setSearchResults(null)
                }}
                className={`shrink-0 rounded-full px-3.5 py-1 text-[12px] font-medium transition-colors ${
                  activeSortKey === option.key
                    ? 'bg-cinnabar text-white'
                    : 'bg-paper/8 text-paper-muted hover:bg-paper/15'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        )}

        {categories && categories.length > 0 && (
          <div className="page-x flex gap-2 overflow-x-auto pb-2.5 scrollbar-none">
            <button
              type="button"
              onClick={() => setActiveCatIdx(null)}
              className={`shrink-0 rounded-full px-3.5 py-1 text-[12px] font-medium transition-colors ${
                activeCatIdx === null
                  ? 'bg-cinnabar text-white'
                  : 'bg-paper/8 text-paper-muted hover:bg-paper/15'
              }`}
            >
              全部
            </button>
            {categories.map((cat, idx) => (
              <button
                key={cat.url}
                type="button"
                onClick={() => setActiveCatIdx(idx)}
                className={`shrink-0 rounded-full px-3.5 py-1 text-[12px] font-medium transition-colors ${
                  activeCatIdx === idx
                    ? 'bg-cinnabar text-white'
                    : 'bg-paper/8 text-paper-muted hover:bg-paper/15'
                }`}
              >
                {cat.title}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="page-x space-y-3 pt-3 pb-6">

        {/* 搜索结果提示 */}
        {searchResults !== null && (
          <div className="flex items-center justify-between">
            <span className="font-mono text-[11px] text-paper-muted">
              搜索结果：{searchResults.length} 条
            </span>
            <button
              type="button"
              onClick={clearSearch}
              className="font-mono text-[11px] text-cinnabar-soft hover:text-cinnabar"
            >
              返回列表
            </button>
          </div>
        )}

        {/* 加载中 */}
        {loading && (
          <div className="flex justify-center py-12">
            <Loader2 size={24} className="animate-spin text-paper-muted" />
          </div>
        )}

        {/* 双列大图卡片 */}
        {!loading && displayedArticles.length > 0 && (
          <div className="grid grid-cols-2 gap-3">
            {displayedArticles.map((article) => (
              <button
                key={article.id}
                type="button"
                onClick={() => onOpen(article)}
                className="group overflow-hidden rounded-xl border border-haze/50 bg-paper/5 text-left transition-colors hover:border-cinnabar/30 hover:bg-paper/10"
              >
                {article.image && (
                  <div className="aspect-16/10 w-full overflow-hidden bg-ink">
                    <img
                      src={article.image}
                      alt=""
                      loading="lazy"
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                  </div>
                )}
                <div className="p-2.5">
                  <h3
                    className={`line-clamp-2 text-[13px] font-medium leading-snug ${
                      readIds.has(article.id) ? 'text-paper-faint' : 'text-paper'
                    }`}
                  >
                    {article.title}
                  </h3>
                  <p className="mt-1 font-mono text-[10px] text-paper-muted/60">
                    {article.sourceLabel}
                    {article.hasRealDate ? ` · ${new Date(article.publishedAt).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })} 日` : ''}
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}

        {!loading && displayedArticles.length === 0 && !searching && (
          <div className="py-12 text-center text-[13px] text-paper-faint">暂无内容</div>
        )}

        {/* 分页导航 */}
        {searchResults === null && !loading && displayedArticles.length > 0 && (
          <div className="flex items-center justify-center gap-1 pt-4 pb-2">
            <button
              type="button"
              disabled={page === 0}
              onClick={() => goPage(page - 1)}
              className="flex items-center gap-0.5 rounded-lg px-2.5 py-1.5 text-[12px] text-paper-muted transition-colors hover:bg-paper/10 disabled:opacity-30"
            >
              <ChevronLeft size={14} /> 上一页
            </button>

            {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
              let p: number
              if (totalPages <= 7) {
                p = i
              } else if (page < 3) {
                p = i
              } else if (page > totalPages - 4) {
                p = totalPages - 7 + i
              } else {
                p = page - 3 + i
              }
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => goPage(p)}
                  className={`min-w-8 rounded-lg px-2 py-1.5 text-[12px] font-medium transition-colors ${
                    p === page
                      ? 'bg-cinnabar text-white'
                      : 'text-paper-muted hover:bg-paper/10'
                  }`}
                >
                  {p + 1}
                </button>
              )
            })}

            {totalPages > 7 && (
              <span className="px-1 text-[12px] text-paper-faint">…</span>
            )}

            <button
              type="button"
              onClick={() => goPage(page + 1)}
              className="flex items-center gap-0.5 rounded-lg px-2.5 py-1.5 text-[12px] text-paper-muted transition-colors hover:bg-paper/10"
            >
              下一页 <ChevronRight size={14} />
            </button>
          </div>
        )}
      </div>
    </div>
  )
})
