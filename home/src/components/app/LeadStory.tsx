import type { DemoArticle } from '../../lib/demo'
import { Cover } from './Cover'

/* 头条卡 —— 复刻 ArticleItem.tsx 的 LeadStory（variant="lead"）：
 * 全宽沉浸封面 + 底部压字 + 朱砂短线 kicker。 */
export function LeadStory({
  article,
  onOpen,
}: {
  article: DemoArticle
  onOpen?: (a: DemoArticle) => void
}) {
  const read = !!article.read
  return (
    <button type="button" onClick={() => onOpen?.(article)} className="lead-hero group h-[14.5rem] w-full text-left sm:h-[16rem]">
      <span className="block h-[14.5rem] w-full overflow-hidden sm:h-[16rem]" aria-hidden={!article}>
        <Cover seed={article.id} label={article.source} className="h-full w-full" />
      </span>
      <span className="lead-cover-veil" aria-hidden />
      <span className={`lead-hero-copy page-x pb-4 pt-10 sm:pb-4.5 ${read ? 'is-read' : ''}`}>
        <span className="lead-hero-kicker flex items-center gap-2 font-mono text-[11px] tracking-[0.14em]">
          <span className="h-[2px] w-3.5 rounded-full bg-cinnabar" aria-hidden />
          头条 · {article.source}
        </span>
        <span className="lead-title mt-2 line-clamp-2 text-[19px] font-medium leading-[1.42] tracking-[-0.01em] sm:line-clamp-3 sm:text-[21px]">
          {article.title}
        </span>
        {article.summary && (
          <span className="lead-hero-summary mt-1.5 line-clamp-2 text-[12.5px] leading-relaxed">
            {article.summary}
          </span>
        )}
        <span className="lead-hero-meta mt-2.5 flex items-center gap-2 font-mono text-[10.5px] tracking-[0.06em] text-white/60">
          {article.time}
          <span aria-hidden>·</span>
          站内全文
        </span>
      </span>
    </button>
  )
}
