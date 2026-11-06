import { Copy, FileDown, Globe, RefreshCw, Share2, X, type LucideIcon } from 'lucide-react'

interface Props {
  open: boolean
  /** 有原文地址时才允许浏览器核对与复制链接 */
  hasOriginUrl: boolean
  canExportMarkdown: boolean
  exportingMarkdown: boolean
  onClose: () => void
  onShare: () => void
  onCopyLink: () => void
  onExportMarkdown: () => void
  onOpenOriginal: () => void
  onReextract: () => void
}

interface ActionRowProps {
  icon: LucideIcon
  title: string
  caption: string
  disabled?: boolean
  onClick: () => void
}

function ActionRow({ icon: Icon, title, caption, disabled, onClick }: ActionRowProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="group flex min-h-[72px] w-full items-center gap-3.5 px-4 py-3 text-left transition-colors hover:bg-paper/5 active:bg-paper/8 disabled:cursor-default disabled:opacity-40"
    >
      <Icon size={18} strokeWidth={1.65} className="shrink-0 text-paper-muted transition-colors group-hover:text-paper" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block text-[14.5px] font-medium leading-[1.4] text-paper">{title}</span>
        <span className="mt-1 block text-[12px] leading-[1.5] text-paper-muted">{caption}</span>
      </span>
    </button>
  )
}

/**
 * 阅读器溢出菜单：顶栏只留翻译 / 收藏 / 跟贴这些高频动作，
 * 分享、导出、核对原文、重新抽取收到这里，避免小屏顶栏挤到点不准。
 */
export function ReaderMoreMenu({
  open,
  hasOriginUrl,
  canExportMarkdown,
  exportingMarkdown,
  onClose,
  onShare,
  onCopyLink,
  onExportMarkdown,
  onOpenOriginal,
  onReextract,
}: Props) {
  if (!open) return null

  return (
    <div className="absolute inset-0 z-40 flex flex-col justify-end" data-no-page-tap>
      <button
        type="button"
        aria-label="关闭更多菜单"
        className="absolute inset-0 bg-black/35"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-label="更多操作"
        className="relative z-10 mx-auto max-h-[85vh] w-full shrink-0 overflow-y-auto rounded-t-[22px] border-t border-haze bg-ink pt-3 shadow-[0_-12px_36px_rgba(0,0,0,0.12)] sm:mb-5 sm:max-w-[620px] sm:rounded-[22px] sm:border"
        style={{ paddingBottom: 'calc(var(--sab) + 12px)' }}
      >
        <div className="page-x mx-auto w-full max-w-[620px] space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[15px] font-semibold tracking-[-0.015em] text-paper">更多操作</span>
            <button
              type="button"
              onClick={onClose}
              aria-label="关闭"
              className="flex h-9 w-9 items-center justify-center rounded-full text-paper-muted transition-colors hover:bg-paper/5 hover:text-paper"
            >
              <X size={16} strokeWidth={1.7} />
            </button>
          </div>

          <div className="divide-y divide-haze/75 overflow-hidden rounded-[16px] border border-haze bg-ink-raised/45">
            <ActionRow
              icon={Share2}
              title="分享文章"
              caption="先看分享卡片，再交给系统分享面板"
              onClick={onShare}
            />
            <ActionRow
              icon={FileDown}
              title="导出 Markdown"
              caption={
                exportingMarkdown
                  ? '正在整理原文正文…'
                  : canExportMarkdown
                    ? '保留正文结构与原文链接，便于存档或交给 AI 分析'
                    : '正文加载完成后可导出'
              }
              disabled={!canExportMarkdown || exportingMarkdown}
              onClick={onExportMarkdown}
            />
            <ActionRow
              icon={Copy}
              title="复制链接"
              caption={hasOriginUrl ? '复制站内分享链接到剪贴板' : '这篇没有原文地址'}
              disabled={!hasOriginUrl}
              onClick={onCopyLink}
            />
            <ActionRow
              icon={Globe}
              title="在浏览器核对原文"
              caption={hasOriginUrl ? '站内阅读为主，核对时才外跳' : '这篇没有原文地址'}
              disabled={!hasOriginUrl}
              onClick={onOpenOriginal}
            />
            <ActionRow
              icon={RefreshCw}
              title="重新抽取正文"
              caption="排版异常或内容缺失时再抓一次"
              onClick={onReextract}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
