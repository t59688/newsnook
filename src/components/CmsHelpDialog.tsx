import { memo, useEffect, useId } from 'react'
import { createPortal } from 'react-dom'
import {
  BookOpen,
  Check,
  CircleAlert,
  Film,
  Globe,
  Layers3,
  Plus,
  Sparkles,
  UsersRound,
  X,
} from 'lucide-react'
import { useHardwareBackLayer } from '../hooks/useHardwareBackLayer'

export interface CmsHelpDialogProps {
  open: boolean
  onClose: () => void
  onAddCms?: () => void
}

/**
 * CMS 独立站点空间说明与支持类型帮助弹窗
 * 向用户解释 CMS 独立站点的用途、与 RSS 的差异以及支持添加的网站框架类型。
 */
export const CmsHelpDialog = memo(function CmsHelpDialog({
  open,
  onClose,
  onAddCms,
}: CmsHelpDialogProps) {
  const titleId = useId()

  useHardwareBackLayer(open, () => {
    onClose()
    return true
  })

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center md:items-center p-0 md:p-6"
      role="presentation"
    >
      {/* 半透明遮罩，点击关闭 */}
      <button
        type="button"
        aria-label="关闭说明弹窗"
        className="absolute inset-0 bg-black/65 transition-opacity animate-in fade-in duration-200"
        onClick={onClose}
      />

      {/* 弹窗主体容器 */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative z-10 flex max-h-[min(90vh,700px)] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl md:rounded-2xl border border-haze/90 bg-ink-raised shadow-2xl"
        style={{
          paddingBottom: 'calc(var(--sab, 0px) + 12px)',
        }}
      >
        {/* 移动端顶部拉手把 */}
        <div className="flex shrink-0 justify-center pt-2.5 pb-1 md:hidden" aria-hidden>
          <span className="h-1 w-10 rounded-full bg-haze" />
        </div>

        {/* 头部标题与关闭按钮 */}
        <div className="page-x flex shrink-0 items-center justify-between gap-3 border-b border-haze/50 pt-3 pb-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-cinnabar/15 text-cinnabar">
              <Layers3 size={18} strokeWidth={1.8} />
            </div>
            <div className="min-w-0">
              <h2 id={titleId} className="font-display text-[17px] font-semibold text-paper">
                CMS 站点说明与支持类型
              </h2>
              <p className="mt-0.5 text-[11px] text-paper-faint">
                无需 RSS 订阅源 · 原生化沉浸阅读空间
              </p>
            </div>
          </div>

          <button
            type="button"
            aria-label="关闭"
            onClick={onClose}
            className="flex size-8 shrink-0 items-center justify-center rounded-full text-paper-muted transition-colors hover:bg-paper/8 hover:text-paper"
          >
            <X size={16} />
          </button>
        </div>

        {/* 滚动内容区 */}
        <div className="scroll-hidden min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 space-y-4">
          {/* 板块 1：用途与核心优势 */}
          <section className="rounded-2xl border border-haze/70 bg-ink/40 p-3.5 space-y-2">
            <div className="flex items-center gap-1.5 text-cinnabar">
              <Sparkles size={14} strokeWidth={2} />
              <h3 className="font-display text-[13.5px] font-semibold text-paper">
                什么是 CMS 独立站点空间？
              </h3>
            </div>
            <p className="text-[12px] leading-relaxed text-paper-muted">
              很多优质网站或资源库并没有提供 RSS 订阅源。NewsNook 内置<strong className="text-paper font-medium">本地目录引擎</strong>，能够直接从网站公开页面或轻量接口中智能提取目录结构、全站分类、分页列表与正文。
            </p>
            <div className="grid grid-cols-2 gap-2 pt-1">
              <div className="rounded-xl border border-haze/50 bg-ink-raised/60 p-2.5">
                <span className="block text-[11.5px] font-semibold text-paper">纯净无干扰</span>
                <span className="mt-0.5 block text-[10.5px] leading-normal text-paper-faint">
                  自动过滤网页浮动广告与杂乱排版，保留纯粹内容。
                </span>
              </div>
              <div className="rounded-xl border border-haze/50 bg-ink-raised/60 p-2.5">
                <span className="block text-[11.5px] font-semibold text-paper">本地优先解析</span>
                <span className="mt-0.5 block text-[10.5px] leading-normal text-paper-faint">
                  直接由设备连接目标站点，不经云端转发，保护隐私。
                </span>
              </div>
            </div>
          </section>

          {/* 板块 2：支持添加哪些网站 */}
          <section className="space-y-2.5">
            <div className="flex items-center gap-1.5 px-0.5">
              <CircleAlert size={14} className="text-cinnabar" />
              <h3 className="font-display text-[13.5px] font-semibold text-paper">
                支持添加哪些类型的网站？
              </h3>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {/* 影视动漫 */}
              <div className="rounded-2xl border border-haze/70 bg-ink/40 p-3 transition-colors hover:border-cinnabar/35">
                <div className="flex items-center gap-2">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-cinnabar/15 text-cinnabar">
                    <Film size={14} />
                  </span>
                  <span className="font-display text-[13px] font-semibold text-paper">影视与动漫</span>
                </div>
                <p className="mt-1.5 text-[11px] text-paper-faint leading-relaxed">
                  支持识别苹果CMS (MacCMS)、海洋CMS (SeaCMS)、飞飞CMS (FFCMS)、赞片CMS、努努影院等影视站。
                </p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {['MacCMS', 'SeaCMS', '飞飞CMS', '海报流'].map((tag) => (
                    <span
                      key={tag}
                      className="rounded bg-paper/6 px-1.5 py-0.5 font-mono text-[9px] text-paper-muted"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>

              {/* 博客专栏 */}
              <div className="rounded-2xl border border-haze/70 bg-ink/40 p-3 transition-colors hover:border-cinnabar/35">
                <div className="flex items-center gap-2">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-cinnabar/15 text-cinnabar">
                    <BookOpen size={14} />
                  </span>
                  <span className="font-display text-[13px] font-semibold text-paper">博客与专栏</span>
                </div>
                <p className="mt-1.5 text-[11px] text-paper-faint leading-relaxed">
                  支持 WordPress、Typecho、Hugo、Hexo、Ghost、织梦 (DedeCMS)、PbootCMS、Z-Blog 等。
                </p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {['WordPress', 'Typecho', 'Hugo', '离线正文'].map((tag) => (
                    <span
                      key={tag}
                      className="rounded bg-paper/6 px-1.5 py-0.5 font-mono text-[9px] text-paper-muted"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>

              {/* 论坛社区 */}
              <div className="rounded-2xl border border-haze/70 bg-ink/40 p-3 transition-colors hover:border-cinnabar/35">
                <div className="flex items-center gap-2">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-cinnabar/15 text-cinnabar">
                    <UsersRound size={14} />
                  </span>
                  <span className="font-display text-[13px] font-semibold text-paper">社区论坛</span>
                </div>
                <p className="mt-1.5 text-[11px] text-paper-faint leading-relaxed">
                  支持 Discuz! 论坛系统及公开讨论区版块，自动抽取主题列表与贴文内容。
                </p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {['Discuz!', '公开版块', '帖子列表'].map((tag) => (
                    <span
                      key={tag}
                      className="rounded bg-paper/6 px-1.5 py-0.5 font-mono text-[9px] text-paper-muted"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>

              {/* 结构化网页目录 */}
              <div className="rounded-2xl border border-haze/70 bg-ink/40 p-3 transition-colors hover:border-cinnabar/35">
                <div className="flex items-center gap-2">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-cinnabar/15 text-cinnabar">
                    <Globe size={14} />
                  </span>
                  <span className="font-display text-[13px] font-semibold text-paper">标准网页目录</span>
                </div>
                <p className="mt-1.5 text-[11px] text-paper-faint leading-relaxed">
                  具备清晰文章列表结构或 JSON-LD 结构化数据的各类公开资讯与资源网页。
                </p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {['JSON-LD', '列表分页', '智能抽取'].map((tag) => (
                    <span
                      key={tag}
                      className="rounded bg-paper/6 px-1.5 py-0.5 font-mono text-[9px] text-paper-muted"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </section>

          {/* 板块 3：如何添加 */}
          <section className="rounded-2xl border border-haze/70 bg-ink/40 p-3.5 space-y-2.5">
            <h3 className="font-display text-[13px] font-semibold text-paper">
              如何添加自定义 CMS 站点？
            </h3>
            <ol className="space-y-1.5 text-[11.5px] text-paper-muted">
              <li className="flex items-start gap-2">
                <span className="flex size-4.5 shrink-0 items-center justify-center rounded-full bg-cinnabar/15 font-mono text-[10px] font-bold text-cinnabar">
                  1
                </span>
                <span>复制想要浏览的网站主页或栏目 URL 地址。</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="flex size-4.5 shrink-0 items-center justify-center rounded-full bg-cinnabar/15 font-mono text-[10px] font-bold text-cinnabar">
                  2
                </span>
                <span>前往「我的 / 设置」→「自定义订阅」→ 点击「添加自定义源」。</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="flex size-4.5 shrink-0 items-center justify-center rounded-full bg-cinnabar/15 font-mono text-[10px] font-bold text-cinnabar">
                  3
                </span>
                <span>直接粘贴网址并保存，系统将自动探测网站结构并将其收纳至独立空间中。</span>
              </li>
            </ol>
          </section>
        </div>

        {/* 底部操作按钮 */}
        <div className="page-x flex shrink-0 items-center gap-2 border-t border-haze/50 pt-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 inline-flex items-center justify-center rounded-xl border border-haze/90 bg-ink/40 py-2.5 text-[12px] font-medium text-paper-muted transition-colors hover:border-cinnabar/40 hover:text-paper active:scale-[0.99]"
          >
            <Check size={13} className="mr-1" />
            我知道了
          </button>

          {onAddCms && (
            <button
              type="button"
              onClick={() => {
                onClose()
                onAddCms()
              }}
              className="flex-1 inline-flex items-center justify-center gap-1 rounded-xl bg-cinnabar py-2.5 text-[12px] font-medium text-white shadow-xs transition-opacity hover:opacity-90 active:scale-[0.99]"
            >
              <Plus size={14} strokeWidth={2} />
              去添加站点
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
})
