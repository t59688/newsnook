import type { Article } from '../lib/types'

/** A synchronous, inexpensive first-frame surface for article navigation. */
export function ReaderEntranceShell({ article, onBack, shared = false }: {
  article: Article
  onBack: () => void
  shared?: boolean
}) {
  return (
    <div role="status" aria-label="正在打开文章" className="absolute inset-0 z-30 bg-ink"
      style={{ paddingTop: 'var(--sat)' }}>
      <div className="mx-auto w-full max-w-3xl px-5 pt-5">
        <button type="button" onClick={onBack} aria-label="返回文章列表"
          className="-ml-2 rounded-lg px-2 py-2 text-[12px] text-paper-muted active:scale-95">
          ← 返回
        </button>
        <div className="pt-8">
          <span className="font-mono text-[10px] tracking-[0.14em] text-cinnabar-soft">
            {article.sourceLabel || article.sourceName}
          </span>
          <h1 className="reader-title mt-3 font-display text-paper">{article.title}</h1>
          <p className="mt-7 font-mono text-[11px] text-paper-faint">
            {shared ? '正在打开分享的文章…' : '正在准备阅读页面…'}
          </p>
          <div className="mt-5 space-y-3.5" aria-hidden="true">
            {[96, 83, 91, 67].map(width => (
              <div key={width} className="h-3 rounded-full bg-paper/10" style={{ width: `${width}%` }} />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
