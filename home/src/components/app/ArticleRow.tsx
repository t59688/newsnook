import { BookmarkCheck, Cloud } from 'lucide-react'
import type { DemoArticle } from '../../lib/demo'
import { Cover } from './Cover'

/* 信息流列表项 —— 复刻 src/components/ArticleItem.tsx 的 variant="row"，
 * 类名与状态（未读朱砂点 / 已读淡化 / 稍后读 / 已预存 / 视频角标）保持一致。 */
export function ArticleRow({
  article,
  onOpen,
}: {
  article: DemoArticle
  onOpen?: (a: DemoArticle) => void
}) {
  const read = !!article.read
  return (
    <li className="article-row-item relative transition-colors duration-300">
      <button
        type="button"
        onClick={() => onOpen?.(article)}
        className={`group pressable-card relative flex w-full items-center gap-4 px-4 py-3.5 text-left sm:px-5 sm:py-4 ${
          read
            ? 'bg-transparent hover:bg-ink/50'
            : 'bg-gradient-to-b from-ink-raised/35 to-transparent hover:bg-ink-raised/80'
        }`}
      >
        <span className="min-w-0 flex-1">
          <span
            className={`flex items-center gap-1.5 font-mono text-[11px] tracking-[0.04em] ${
              read ? 'text-paper-faint/75' : 'text-paper-faint'
            }`}
          >
            {!read && (
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full bg-cinnabar/90 shadow-[0_0_5px_rgba(196,92,74,0.4)]"
                aria-label="未读"
              />
            )}
            <span className={read ? 'text-paper-faint' : 'text-paper-muted font-[450]'}>
              {article.source}
            </span>
            <span aria-hidden className="text-paper-faint/45">
              ·
            </span>
            <span className="tabular-nums">{article.time}</span>
            {article.saved && <BookmarkCheck size={11} strokeWidth={1.8} className="ml-0.5 text-cinnabar" />}
            {article.prestored && (
              <Cloud size={11} strokeWidth={1.35} className="ml-0.5 text-paper-faint/70" aria-label="已预存，可离线阅读" />
            )}
          </span>
          <span
            className={`row-title mt-1.5 line-clamp-2 text-[16.5px] leading-[1.5] tracking-[-0.012em] transition-colors ${
              read ? 'font-normal text-paper-muted/70' : 'font-medium text-paper/93 group-hover:text-cinnabar'
            }`}
          >
            {article.title}
          </span>
          {article.summary && (
            <span
              className={`mt-2 line-clamp-2 text-[13px] leading-[1.62] ${
                read ? 'text-paper-faint/75' : 'text-paper-muted/92'
              }`}
            >
              {article.summary}
            </span>
          )}
        </span>
        <span className="relative h-16 w-[5.35rem] shrink-0 overflow-hidden rounded-[10px] border border-haze/60 bg-ink-deep/25 shadow-[0_2px_8px_rgba(0,0,0,0.04)] sm:h-[4.5rem] sm:w-[6rem]">
          <Cover
            seed={article.id}
            label={article.source}
            className={`h-full w-full transition-all duration-300 ${
              read ? 'opacity-[0.62] saturate-[0.8]' : 'opacity-[0.98]'
            }`}
          />
          {article.video && (
            <span className="absolute bottom-1 right-1 rounded bg-black/60 px-1 py-0.5 font-mono text-[8.5px] leading-none text-white/90 backdrop-blur-sm">
              视频
            </span>
          )}
        </span>
      </button>
    </li>
  )
}
