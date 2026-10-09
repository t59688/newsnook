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
      className="flex w-full items-center gap-3 rounded-2xl border border-haze bg-ink-raised/50 px-3.5 py-3 text-left transition-colors hover:border-cinnabar/50 hover:bg-cinnabar/5 disabled:opacity-35"
    >
      <Icon size={17} strokeWidth={1.6} className="shrink-0 text-paper-muted" />
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] text-paper">{title}</span>
        <span className="mt-0.5 block font-mono text-[10px] text-paper-faint">{caption}</span>
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
        className="min-h-0 flex-1 bg-ink/40"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-label="更多操作"
        className="max-h-[85vh] shrink-0 overflow-y-auto border-t border-haze bg-ink pt-3"
        style={{ paddingBottom: 'calc(var(--sab) + 12px)' }}
      >
        <div className="page-x mx-auto w-full max-w-3xl space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[10px] tracking-[0.16em] text-paper-faint">更多操作</span>
            <button
              type="button"
              onClick={onClose}
              aria-label="关闭"
              className="flex h-8 w-8 items-center justify-center text-paper-muted"
            >
              <X size={16} strokeWidth={1.7} />
            </button>
          </div>

          <div className="space-y-2">
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
