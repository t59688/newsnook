import { useRef, useState, useEffect } from 'react'
import { motion, useScroll, useTransform, AnimatePresence } from 'framer-motion'
import {
  ArrowLeft,
  BookmarkCheck,
  BookmarkPlus,
  Headphones,
  Languages,
  MessageSquare,
  MoreHorizontal,
  Sparkles,
} from 'lucide-react'
import { READER_ARTICLE } from '../../lib/demo'
import { PhoneStatusBar } from './PhoneStatusBar'

export interface ReaderOverride {
  source: string
  time: string
  title: string
  summary?: string
}

/* 站内阅读器 —— 严格复刻 ReaderScreen：
 * 顶栏（返回 / 来源 / 朗读 / 翻译 / 收藏 / 分享）+ 记忆位置浮层 +
 * reader-prose 正文 + 译文块 + 朗读悬浮控制条 + 右侧 ReaderScrollIndicator。 */
export function ReaderDemo({
  onClose,
  article,
}: {
  onClose?: () => void
  article?: ReaderOverride
}) {
  const scroller = useRef<HTMLDivElement>(null)
  const [indent, setIndent] = useState(true)
  const [showTranslate, setShowTranslate] = useState(false)
  const [saved, setSaved] = useState(false)
  const [showAudio, setShowAudio] = useState(false)
  const [audioPlaying, setAudioPlaying] = useState(true)
  const [audioSpeed, setAudioSpeed] = useState('1.0x')
  const [readingPosRestored, setReadingPosRestored] = useState(true)

  const { scrollYProgress } = useScroll({ container: scroller })
  const thumbTop = useTransform(scrollYProgress, [0, 1], ['0%', '78%'])

  useEffect(() => {
    const t = setTimeout(() => setReadingPosRestored(false), 3000)
    return () => clearTimeout(t)
  }, [])

  const a = article
    ? {
        ...READER_ARTICLE,
        source: article.source,
        time: article.time,
        title: article.title,
        lede: article.summary || READER_ARTICLE.lede,
      }
    : READER_ARTICLE

  return (
    <div className="flex h-full flex-col bg-ink text-paper">
      <header
        data-surface="reader-chrome"
        className="sticky top-0 z-30 shrink-0 border-b border-haze/30 bg-ink/94 pb-1 backdrop-blur-md"
      >
        <PhoneStatusBar />
        <div className="page-x flex w-full items-center justify-between gap-1.5">
          <button
            type="button"
            onClick={onClose}
            aria-label="返回列表"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full hover:bg-ink-raised active:scale-95"
          >
            <ArrowLeft size={16.5} strokeWidth={1.8} className="text-paper" />
          </button>
          <span className="min-w-0 flex-1 truncate text-center font-mono text-[10px] tracking-[0.18em] text-paper-faint lg:text-[11px]">
            {a.source}
          </span>
          <div className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              onClick={() => setShowAudio((v) => !v)}
              title="TTS 语音朗读"
              className={`flex h-8 items-center gap-1 rounded-full px-2 font-mono text-[10px] transition-colors ${
                showAudio ? 'bg-cinnabar/20 text-cinnabar-soft' : 'text-paper-muted hover:text-paper'
              }`}
            >
              <Headphones size={13} strokeWidth={1.7} />
              <span className="hidden sm:inline">听书</span>
            </button>
            <button
              type="button"
              onClick={() => setShowTranslate((v) => !v)}
              title="离线/在线对比翻译"
              className={`flex h-8 items-center gap-1 rounded-full px-2 font-mono text-[10px] transition-colors ${
                showTranslate ? 'bg-cinnabar/20 text-cinnabar-soft' : 'text-paper-muted hover:text-paper'
              }`}
            >
              <Languages size={13} strokeWidth={1.7} />
              <span>翻译</span>
            </button>
            <button
              type="button"
              onClick={() => setSaved((v) => !v)}
              aria-label="稍后读"
              className="flex h-8 w-8 items-center justify-center rounded-full text-paper-muted hover:text-paper"
            >
              {saved ? (
                <BookmarkCheck size={14.5} strokeWidth={2} className="text-cinnabar" />
              ) : (
                <BookmarkPlus size={14.5} strokeWidth={1.7} />
              )}
            </button>
            <button
              type="button"
              aria-label="跟贴"
              className="flex h-8 w-8 items-center justify-center rounded-full text-paper-muted hover:text-paper"
            >
              <MessageSquare size={14} strokeWidth={1.7} />
            </button>
            <button
              type="button"
              aria-label="更多操作"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-paper-muted hover:text-paper"
            >
              <MoreHorizontal size={15} strokeWidth={1.7} />
            </button>
          </div>
        </div>
      </header>

      {/* 阅读位置记忆提示条 */}
      <AnimatePresence>
        {readingPosRestored && (
          <motion.div
            initial={{ opacity: 0, y: -16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            className="pointer-events-none absolute top-12 left-1/2 z-40 -translate-x-1/2 rounded-full border border-cinnabar/30 bg-ink-raised/95 px-3 py-1 font-mono text-[10px] text-cinnabar-soft shadow-lg backdrop-blur-md"
          >
            ✓ 已恢复上次阅读位置 · 02:45
          </motion.div>
        )}
      </AnimatePresence>

      <div className="relative min-h-0 flex-1">
        <div
          ref={scroller}
          className="reader-font-pinch-surface scroll-hidden h-full overflow-y-auto"
        >
          <div className="mx-auto w-full max-w-3xl">
            <div className="page-x pt-4">
              <span className="flex items-center gap-2 font-mono text-[10px] tracking-[0.16em] text-cinnabar-soft">
                <span className="h-px w-5 bg-cinnabar" aria-hidden />
                {a.time}
              </span>
              <h1 className="reader-title mt-3 text-paper">{a.title}</h1>
              <p className="mt-2.5 font-mono text-[10px] leading-[13px] tracking-[0.12em] text-paper-faint">
                {a.source} · 站内 Readability 纯净全文 · 零广告
              </p>
            </div>

            <div className="page-x pt-5" style={{ paddingBottom: showAudio ? 80 : 40 }}>
              <div
                className="reader-prose"
                data-article-lang="zh"
                style={{ ['--reader-text-indent' as string]: indent ? '2em' : '0' }}
              >
                <p className="is-cjk" style={{ color: 'var(--tone-quote-text)' }}>
                  {a.lede}
                </p>

                {/* 译文折叠展开对比示意 */}
                {showTranslate && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    className="my-3 rounded-xl border border-cinnabar/25 bg-cinnabar/10 p-3 font-mono text-[12px] text-paper-muted"
                    style={{ textIndent: 0 }}
                  >
                    <div className="flex items-center gap-1.5 text-cinnabar-soft text-[10px] mb-1">
                      <Sparkles size={11} />
                      <span>Android 本地离线引擎 · 英语译文对照</span>
                    </div>
                    <p className="text-[12.5px] leading-relaxed text-paper/85">
                      "We tracked 47 migrant workers returning from coastal factories to inland county towns. Their decisions outline the real industrial shift."
                    </p>
                  </motion.div>
                )}

                {a.paragraphs.map((p, i) => (
                  <p key={i} className="is-cjk">
                    {p}
                  </p>
                ))}

                <blockquote>
                  <p>{a.quote}</p>
                </blockquote>

                <p className="is-cjk">
                  十年时间，47 个人，三个省，十一个县。我们把他们的故事放在数据旁边，发现两者讲的是同一件事：
                  产业不是抽象的曲线，它最终会落到一个人「要不要回来」的具体决定上。
                </p>

                <figure>
                  <span
                    className="block aspect-[16/9] w-full rounded-[12px] border border-haze/60 shadow-sm"
                    style={{
                      background:
                        'linear-gradient(135deg, var(--tone-ink-deep), var(--tone-ink-raised))',
                    }}
                  />
                  <figcaption>{a.caption}</figcaption>
                </figure>

                <div className="h-px w-full bg-haze" />
                <div className="mt-4 flex items-center justify-between font-mono text-[9.5px] text-paper-faint" style={{ textIndent: 0 }}>
                  <span>本文由有所闻解析排版 · 原文来自 {a.source}</span>
                  <button
                    type="button"
                    onClick={() => setIndent((v) => !v)}
                    className="text-cinnabar-soft underline decoration-dotted"
                  >
                    {indent ? '关闭缩进' : '开启首行缩进'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 右侧悬浮进度细条 */}
        <div className="pointer-events-none absolute inset-y-2 right-0 z-[15] w-3" aria-hidden>
          <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 rounded-full bg-paper/10" />
          <motion.span
            className="absolute left-1/2 w-[2.5px] -translate-x-1/2 rounded-full bg-cinnabar"
            style={{ height: '22%', top: thumbTop }}
          />
        </div>

        {/* 底部 TTS 语音朗读控制条（ReadAloudBar 同款） */}
        <AnimatePresence>
          {showAudio && (
            <motion.div
              initial={{ y: 50, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 50, opacity: 0 }}
              className="absolute inset-x-2 bottom-2 z-30 flex items-center justify-between rounded-2xl border border-haze/80 bg-ink-raised/95 px-3 py-2 shadow-xl backdrop-blur-xl"
            >
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setAudioPlaying((p) => !p)}
                  className="flex h-7 w-7 items-center justify-center rounded-full bg-cinnabar text-ink font-bold"
                >
                  {audioPlaying ? '❚❚' : '▶'}
                </button>
                <div className="min-w-0">
                  <div className="truncate font-mono text-[10.5px] text-paper font-medium">
                    TTS 语音朗读中 · 第 2 段
                  </div>
                  <div className="font-mono text-[9px] text-paper-faint">
                    Android System TTS · 锁屏可控
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1.5 font-mono text-[9.5px]">
                {['0.8x', '1.0x', '1.25x', '1.5x'].map((spd) => (
                  <button
                    key={spd}
                    type="button"
                    onClick={() => setAudioSpeed(spd)}
                    className={`rounded px-1.5 py-0.5 ${
                      audioSpeed === spd ? 'bg-cinnabar text-ink font-bold' : 'text-paper-muted'
                    }`}
                  >
                    {spd}
                  </button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
