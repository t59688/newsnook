import { History } from 'lucide-react'

import { SettingsShell } from '../../components/SettingsShell'
import { articleRelativeTime } from '../../lib/time'
import type { Article } from '../../lib/types'

interface Props {
  history: Article[]
  onOpen: (article: Article) => void
  onBack: () => void
}

export function HistoryScreen({ history, onOpen, onBack }: Props) {
  return (
    <SettingsShell
      title="最近阅读"
      caption={history.length ? `共 ${history.length} 篇` : '打开过的文章会出现在这里'}
      onBack={onBack}
    >
      {history.length === 0 ? (
        <div className="page-x flex flex-col items-center justify-center py-20 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-ink-raised/60 text-paper-muted">
            <History size={22} strokeWidth={1.5} />
          </div>
          <p className="mt-4 font-display text-[16px] text-paper">暂无离线阅读记录</p>
          <p className="mt-2 max-w-xs text-[12px] leading-relaxed text-paper-faint">
            完整打开文章后会自动缓存正文。
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-haze border-y border-haze md:grid md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 md:gap-px md:divide-y-0 md:bg-haze">
          {history.map((article) => (
            <li
              key={article.id}
              className="bg-ink transition-colors hover:bg-ink-raised/40"
            >
              <button
                type="button"
                onClick={() => onOpen(article)}
                className="page-x w-full py-3.5 text-left"
              >
                <span className="font-mono text-[10px] tracking-[0.12em] text-paper-faint">
                  <span className="font-medium text-paper-muted">{article.sourceLabel}</span> · {articleRelativeTime(article)} · 正文已离线
                </span>
                <span className="row-title mt-1 block font-normal text-[16px] leading-snug text-paper md:text-[17px]">
                  {article.title}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </SettingsShell>
  )
}
