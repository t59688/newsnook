import { Copy, Share2, X } from 'lucide-react'

import { shareUrlDisplay } from '../lib/shareLink'
import { articleRelativeTime } from '../lib/time'

interface Props {
  open: boolean
  title: string
  sourceName: string
  summary?: string
  publishedAt: number
  hasRealDate: boolean
  /** 站内短链，卡片与系统面板用的是同一个地址 */
  shareUrl: string
  /** 出版社域名，只作说明文字，不是分享出去的主链接 */
  originHost?: string
  onClose: () => void
  onShare: () => void
  onCopy: () => void
}

const SHEET_SECONDARY_CLASS =
  'flex flex-1 items-center justify-center gap-1.5 rounded-full border border-haze px-4 py-2.5 font-mono text-[11.5px] text-paper-muted transition-colors hover:text-paper'

const SHEET_PRIMARY_CLASS =
  'flex flex-1 items-center justify-center gap-1.5 rounded-full border border-cinnabar/70 bg-cinnabar/15 px-4 py-2.5 font-mono text-[11.5px] font-medium text-cinnabar-soft transition-colors hover:bg-cinnabar/25'

/**
 * 分享预览：先在应用内按现有 paper 主题排一张卡片，确认后再调系统面板。
 * 卡片只用主题变量着色，明暗、配色方案与墨水屏都跟着 data-scheme / data-eink 走。
 */
export function ShareArticleSheet({
  open,
  title,
  sourceName,
  summary,
  publishedAt,
  hasRealDate,
  shareUrl,
  originHost,
  onClose,
  onShare,
  onCopy,
}: Props) {
  if (!open) return null

  const time = articleRelativeTime({ publishedAt, hasRealDate })

  return (
    <div className="absolute inset-0 z-50 flex flex-col justify-end" data-no-page-tap>
      <button
        type="button"
        aria-label="关闭分享卡片"
        className="min-h-0 flex-1 bg-ink/40"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-label="分享文章"
        className="shrink-0 border-t border-haze bg-ink pt-3"
        style={{ paddingBottom: 'calc(var(--sab) + 12px)' }}
      >
        <div className="page-x mx-auto w-full max-w-3xl space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[10px] tracking-[0.16em] text-paper-faint">
              分享这篇
            </span>
            <button
              type="button"
              onClick={onClose}
              aria-label="关闭"
              className="flex h-8 w-8 items-center justify-center text-paper-muted"
            >
              <X size={16} strokeWidth={1.7} />
            </button>
          </div>

          <article className="overflow-hidden rounded-2xl border border-haze bg-ink-raised">
            <span className="block h-px bg-cinnabar/35" aria-hidden />
            <div className="space-y-2.5 px-4 py-4">
              <div className="flex items-center gap-2 font-mono text-[10px] tracking-[0.14em] text-paper-faint">
                {sourceName && <span className="truncate text-cinnabar-soft">{sourceName}</span>}
                {sourceName && <span aria-hidden>·</span>}
                <span className="truncate">{time}</span>
              </div>

              <h3 className="line-clamp-3 font-display text-[17px] leading-[1.5] text-paper">
                {title}
              </h3>

              {summary && (
                <p className="line-clamp-2 text-[12.5px] leading-relaxed text-paper-muted">
                  {summary}
                </p>
              )}

              <div className="flex items-center gap-2.5 border-t border-haze/60 pt-3">
                <span
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-cinnabar/15 font-display text-[13px] leading-none text-cinnabar-soft"
                  aria-hidden
                >
                  闻
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[12px] text-paper">有所闻 · NewsNook</span>
                  {/* 卡片里的链接可直接点开，方便自己确认这条分享是通的 */}
                  <a
                    href={shareUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={shareUrl}
                    className="mt-0.5 block truncate font-mono text-[10px] text-paper-faint underline-offset-2 hover:text-cinnabar-soft hover:underline"
                  >
                    {shareUrlDisplay(shareUrl)}
                  </a>
                </span>
              </div>
            </div>
          </article>

          <p className="font-mono text-[10px] leading-relaxed text-paper-faint">
            链接打开后在「有所闻」网页版站内读全文
            {originHost ? ` · 原文来自 ${originHost}` : ''}
          </p>

          <div className="flex items-center gap-2.5">
            <button type="button" onClick={onCopy} className={SHEET_SECONDARY_CLASS}>
              <Copy size={14} strokeWidth={1.7} />
              复制链接
            </button>
            <button type="button" onClick={onShare} className={SHEET_PRIMARY_CLASS}>
              <Share2 size={14} strokeWidth={1.8} />
              分享
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
