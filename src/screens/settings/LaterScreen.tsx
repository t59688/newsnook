import { Bookmark, X } from 'lucide-react'

import { SettingsShell } from '../../components/SettingsShell'
import { articleRelativeTime } from '../../lib/time'
import type { Article } from '../../lib/types'

interface Props {
  later: Article[]
  onOpen: (article: Article) => void
  onRemoveLater: (id: string) => void
  onBack: () => void
}

export function LaterScreen({ later, onOpen, onRemoveLater, onBack }: Props) {
  return (
    <SettingsShell
      title="稍后读"
      caption={later.length ? `共 ${later.length} 篇` : '阅读器顶栏点收藏加入'}
      onBack={onBack}
    >
      {later.length === 0 ? (
        <div className="page-x flex flex-col items-center justify-center py-20 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-ink-raised/60 text-paper-muted">
            <Bookmark size={22} strokeWidth={1.5} />
          </div>
          <p className="mt-4 font-display text-[16px] text-paper">暂无稍后读内容</p>
          <p className="mt-2 max-w-xs text-[12px] leading-relaxed text-paper-faint">
            打开文章后，点阅读器顶栏「收藏」即可加入。
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-haze border-y border-haze md:grid md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 md:gap-px md:divide-y-0 md:bg-haze">
          {later.map((article) => (
            <li
              key={article.id}
              className="relative flex items-start gap-3 bg-ink-raised/70 px-5 py-3.5 sm:px-6 md:px-5 transition-colors hover:bg-ink-raised/90"
            >
              <button
                type="button"
                onClick={() => onOpen(article)}
                className="group relative min-w-0 flex-1 text-left"
              >
                <span className="font-mono text-[10px] tracking-[0.12em] text-paper-faint">
                  <span className="font-medium text-paper-muted">{article.sourceLabel}</span> · {articleRelativeTime(article)}
                </span>
                <span className="row-title mt-1 block font-medium text-[16px] leading-snug text-paper md:text-[17px]">
                  {article.title}
                </span>
              </button>
              <button
                type="button"
                aria-label="移出稍后读"
                onClick={() => onRemoveLater(article.id)}
                className="mt-1 p-1.5 text-paper-faint transition-colors hover:text-cinnabar"
              >
                <X size={15} strokeWidth={1.6} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </SettingsShell>
  )
}
