import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'

import { ArticleRow } from '../../components/ArticleItem'
import { SettingsShell } from '../../components/SettingsShell'
import {
  LOCAL_SEARCH_ORIGIN_LABELS,
  buildLocalSearchCorpus,
  searchLocalArticles,
  type LocalSearchOrigin,
} from '../../lib/localSearch'
import type { Article } from '../../lib/types'

interface Props {
  /** 当前可见的列表内容（含列表缓存与预存元数据） */
  feedArticles: Article[]
  later: Article[]
  history: Article[]
  readIds: Set<string>
  laterIds: Set<string>
  onOpen: (article: Article) => void
  onBack: () => void
}

const ORIGIN_FILTERS: { id: LocalSearchOrigin | 'all'; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'feed', label: LOCAL_SEARCH_ORIGIN_LABELS.feed },
  { id: 'later', label: LOCAL_SEARCH_ORIGIN_LABELS.later },
  { id: 'history', label: LOCAL_SEARCH_ORIGIN_LABELS.history },
]

export function LocalSearchScreen({
  feedArticles,
  later,
  history,
  readIds,
  laterIds,
  onOpen,
  onBack,
}: Props) {
  const [query, setQuery] = useState('')
  const [origin, setOrigin] = useState<LocalSearchOrigin | 'all'>('all')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const corpus = useMemo(
    () => buildLocalSearchCorpus({ feed: feedArticles, later, history }),
    [feedArticles, later, history],
  )

  // 打字时先渲染上一版结果，避免大语料下每个按键都卡住输入框
  const deferredQuery = useDeferredValue(query)
  const results = useMemo(
    () =>
      searchLocalArticles(corpus, deferredQuery, {
        origins: origin === 'all' ? undefined : [origin],
      }),
    [corpus, deferredQuery, origin],
  )

  const trimmed = deferredQuery.trim()
  const originCounts = useMemo(() => {
    const counts: Record<LocalSearchOrigin, number> = { feed: 0, later: 0, history: 0 }
    corpus.forEach((entry) => {
      counts[entry.origin] += 1
    })
    return counts
  }, [corpus])

  return (
    <SettingsShell
      title="本地搜索"
      caption={`在本机 ${corpus.length} 篇已缓存内容里查找 · 不联网`}
      onBack={onBack}
    >
      <div className="page-x pt-4">
        <div className="relative flex items-center">
          <Search size={15} className="pointer-events-none absolute left-3.5 text-paper-faint" />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索标题、摘要或信源名…"
            className="w-full rounded-xl border border-haze bg-ink-raised/60 py-2.5 pl-10 pr-9 text-[14px] text-paper placeholder-paper-faint/50 transition-colors focus:border-cinnabar focus:outline-none"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="清空搜索"
              className="absolute right-2.5 rounded-full p-1 text-paper-faint transition-colors hover:bg-paper/10 hover:text-paper"
            >
              <X size={14} />
            </button>
          )}
        </div>

        <div className="mt-3 flex gap-1.5 overflow-x-auto scrollbar-none">
          {ORIGIN_FILTERS.map((filter) => {
            const count = filter.id === 'all' ? corpus.length : originCounts[filter.id]
            return (
              <button
                key={filter.id}
                type="button"
                onClick={() => setOrigin(filter.id)}
                aria-pressed={origin === filter.id}
                className={`shrink-0 rounded-full border px-3 py-1 font-mono text-[11px] transition-colors ${
                  origin === filter.id
                    ? 'border-cinnabar bg-cinnabar/20 text-cinnabar-soft'
                    : 'border-haze bg-paper/5 text-paper-muted hover:text-paper'
                }`}
              >
                {filter.label} {count}
              </button>
            )
          })}
        </div>
      </div>

      {!trimmed ? (
        <div className="page-x py-14 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-haze bg-paper/5 text-paper-faint">
            <Search size={22} strokeWidth={1.5} />
          </div>
          <p className="mt-4 font-display text-[16px] text-paper">只在本机已有内容里找</p>
          <p className="mt-2 text-[12px] leading-relaxed text-paper-faint">
            覆盖列表缓存、稍后读与最近阅读，不会发起任何网络请求。
            <br />
            想搜某个视频站的全站内容，请到该信源页用站内搜索。
          </p>
        </div>
      ) : results.length === 0 ? (
        <div className="page-x py-14 text-center">
          <p className="text-[13.5px] text-paper">没有匹配「{trimmed}」的本地内容</p>
          <p className="mt-2 text-[12px] leading-relaxed text-paper-faint">
            换个关键词，或先刷新对应分类把内容取到本机。
          </p>
        </div>
      ) : (
        <>
          <p className="page-x pt-4 pb-1 font-mono text-[10.5px] text-paper-faint">
            命中 {results.length} 条
          </p>
          <ul className="divide-y divide-haze border-y border-haze">
            {results.map((result) => (
              <ArticleRow
                key={result.article.id}
                article={result.article}
                read={readIds.has(result.article.id)}
                saved={laterIds.has(result.article.id)}
                onOpen={onOpen}
                revealed
                variant="row"
              />
            ))}
          </ul>
        </>
      )}
    </SettingsShell>
  )
}
