import { useState, useRef, useEffect } from 'react'
import { motion, useReducedMotion, AnimatePresence } from 'framer-motion'
import {
  BookOpen,
  Code,
  Languages,
  Play,
  Radio,
  RotateCcw,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import { PhoneFrame } from '../components/app/PhoneFrame'
import { FeedDemo } from '../components/app/FeedDemo'
import { ReaderDemo } from '../components/app/ReaderDemo'
import { MaskRise } from '../portal/Reveal'
import { GhostCta, PrimaryCta } from '../portal/Cta'
import {
  BUILTIN_SOURCES_COUNT,
  type DemoArticle,
} from '../lib/demo'

export function HeroScroll() {
  const reduced = useReducedMotion()
  const [openedArticle, setOpenedArticle] = useState<DemoArticle | null>(null)
  const [autoPlaying, setAutoPlaying] = useState(false)
  const [activeStep, setActiveStep] = useState(0)
  const [tapPosition, setTapPosition] = useState<{ x: number; y: number } | null>(null)

  const timerRef = useRef<number | null>(null)

  // 自动化演练流程
  const startAutoTour = () => {
    if (autoPlaying) {
      if (timerRef.current) window.clearTimeout(timerRef.current)
      setAutoPlaying(false)
      setOpenedArticle(null)
      setTapPosition(null)
      return
    }

    setAutoPlaying(true)
    setOpenedArticle(null)
    setActiveStep(1)

    // 步骤 1: 定位头条
    timerRef.current = window.setTimeout(() => {
      setTapPosition({ x: 50, y: 160 })
      setActiveStep(2)

      // 步骤 2: 打开阅读器
      timerRef.current = window.setTimeout(() => {
        setTapPosition(null)
        setOpenedArticle({
          id: 'lead-auto',
          source: '澎湃·特稿',
          title: '回到县城的人们：一份持续十年的中部就业观察',
          time: '2 小时前',
          category: '深度人文',
          summary: '我们跟踪了 47 位从沿海返乡的务工者。',
        })
        setActiveStep(3)

        // 步骤 3: 停留阅读后平滑收起
        timerRef.current = window.setTimeout(() => {
          setActiveStep(0)
          setAutoPlaying(false)
        }, 3600)
      }, 700)
    }, 1200)
  }

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current)
    }
  }, [])

  return (
    <section id="top" className="relative min-h-dvh overflow-hidden pt-20 pb-16 lg:pt-24 lg:pb-24">
      {/* 背景微晕染光斑 */}
      <div
        className="pointer-events-none absolute -top-40 right-[-10%] h-[520px] w-[520px] rounded-full bg-cinnabar/8 blur-[120px]"
        aria-hidden
      />

      <div className="page-x mx-auto grid w-full max-w-6xl items-center gap-10 lg:grid-cols-[1.05fr_0.95fr] lg:gap-8">
        {/* 左侧叙事 */}
        <div className="relative z-10 flex flex-col items-start">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 rounded-full border border-cinnabar/40 bg-cinnabar/15 px-3 py-1 font-mono text-[11px] font-bold text-cinnabar-soft shadow-xs">
              <span className="h-2 w-2 rounded-full bg-cinnabar animate-pulse" />
              <span>NewsNook · 有所闻</span>
            </div>
            <span className="rounded-full border border-haze bg-ink-raised/60 px-2.5 py-1 font-mono text-[10.5px] text-paper-muted">
              本地优先 · Android / Web 纯净新闻与 RSS 客户端
            </span>
          </div>

          <h1 className="mt-5 font-display text-[clamp(2.4rem,5.4vw,4.2rem)] leading-[1.18] text-paper">
            <span className="block">
              <MaskRise text="更大的世界，" onMount />
            </span>
            <span className="block">
              <MaskRise text="更好的判断。" delay={0.08} onMount className="text-cinnabar-soft" />
            </span>
          </h1>

          <p className="mt-4 max-w-[34rem] text-[14.5px] leading-[1.85] text-paper-muted">
            <strong className="text-paper font-semibold">NewsNook（有所闻）</strong> 是一款专为深度读者打造的<strong className="text-paper font-semibold">本地优先（Local-First）新闻与 RSS 全文阅读工具</strong>，拒绝平台算法投喂与流量裹挟。
            不强制登录、无开屏广告、断网秒开全文；153 个内置精选信源与 3.4 万+ 离线订阅直连上游媒体发布方。集成 Readability 净洁排版、离线双模神经翻译、端侧隐私推荐、油猴脚本沙箱与 CMS 自动转流，将阅读主权交还读者。
          </p>

          {/* 六大核心特性速览矩阵 */}
          <div className="mt-5 grid grid-cols-2 sm:grid-cols-3 gap-2 w-full max-w-[34rem] font-mono text-[11px]">
            <div className="flex items-center gap-1.5 rounded-xl border border-haze/70 bg-ink-raised/50 p-2 text-paper">
              <ShieldCheck size={13} className="text-cinnabar shrink-0" />
              <span className="truncate">免登录 · 0 平台算法</span>
            </div>
            <div className="flex items-center gap-1.5 rounded-xl border border-haze/70 bg-ink-raised/50 p-2 text-paper">
              <Radio size={13} className="text-cinnabar shrink-0" />
              <span className="truncate">153+ 信源直连上游</span>
            </div>
            <div className="flex items-center gap-1.5 rounded-xl border border-haze/70 bg-ink-raised/50 p-2 text-paper">
              <BookOpen size={13} className="text-cinnabar shrink-0" />
              <span className="truncate">站内全文 · 拒绝外链</span>
            </div>
            <div className="flex items-center gap-1.5 rounded-xl border border-haze/70 bg-ink-raised/50 p-2 text-paper">
              <Languages size={13} className="text-cinnabar shrink-0" />
              <span className="truncate">Bergamot 离线翻译</span>
            </div>
            <div className="flex items-center gap-1.5 rounded-xl border border-haze/70 bg-ink-raised/50 p-2 text-paper">
              <Code size={13} className="text-cinnabar shrink-0" />
              <span className="truncate">隐私浏览器 · 油猴脚本</span>
            </div>
            <div className="flex items-center gap-1.5 rounded-xl border border-haze/70 bg-ink-raised/50 p-2 text-paper">
              <Sparkles size={13} className="text-cinnabar shrink-0" />
              <span className="truncate">苹果CMS / 专栏转流</span>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <PrimaryCta href="#download">下载 Android 版</PrimaryCta>
            <button
              type="button"
              onClick={startAutoTour}
              className="pressable flex h-10 items-center gap-2 rounded-full border border-haze/80 bg-ink-raised/60 px-4 font-mono text-[12px] text-paper transition-all hover:border-paper-faint/60 hover:bg-ink-raised"
            >
              {autoPlaying ? (
                <>
                  <RotateCcw size={13} className="text-cinnabar" />
                  <span>停止演练</span>
                </>
              ) : (
                <>
                  <Play size={13} className="text-cinnabar fill-cinnabar" />
                  <span>自动体验</span>
                </>
              )}
            </button>
            <GhostCta href="#feed">浏览全部特性</GhostCta>
          </div>

          {/* 实时演练提示指示器 */}
          <div className="mt-7 w-full max-w-[34rem] rounded-2xl border border-haze/60 bg-ink-raised/40 p-3.5 backdrop-blur-md">
            <div className="flex items-center justify-between text-[11px] font-mono pb-2 border-b border-haze/40">
              <span className="flex items-center gap-1.5 text-cinnabar-soft font-bold">
                <Sparkles size={13} />
                <span>核心动作三步闭环</span>
              </span>
              <span className="text-paper-faint text-[10px]">
                {autoPlaying ? '正在步进呈现' : '真机全功能就绪'}
              </span>
            </div>

            <div className="mt-2.5 grid grid-cols-3 gap-2 font-mono text-[10.5px]">
              <button
                type="button"
                onClick={() => {
                  if (autoPlaying && timerRef.current) window.clearTimeout(timerRef.current)
                  setAutoPlaying(false)
                  setTapPosition(null)
                  setOpenedArticle(null)
                  setActiveStep(1)
                }}
                className={`rounded-xl p-2.5 text-left transition-all ${
                  activeStep === 1
                    ? 'border border-cinnabar/60 bg-cinnabar/15 text-paper shadow-sm'
                    : 'border border-transparent text-paper-muted hover:border-haze hover:bg-ink-raised/50'
                }`}
              >
                <div className="font-bold text-cinnabar-soft">① 直连上游</div>
                <div className="text-[9.5px] mt-0.5 text-paper-faint">
                  {BUILTIN_SOURCES_COUNT} 源直出，零中转
                </div>
              </button>
              <button
                type="button"
                onClick={() => {
                  if (autoPlaying && timerRef.current) window.clearTimeout(timerRef.current)
                  setAutoPlaying(false)
                  setTapPosition({ x: 50, y: 160 })
                  setTimeout(() => setTapPosition(null), 700)
                  setActiveStep(2)
                }}
                className={`rounded-xl p-2.5 text-left transition-all ${
                  activeStep === 2
                    ? 'border border-cinnabar/60 bg-cinnabar/15 text-paper shadow-sm'
                    : 'border border-transparent text-paper-muted hover:border-haze hover:bg-ink-raised/50'
                }`}
              >
                <div className="font-bold text-cinnabar-soft">② 点击条目</div>
                <div className="text-[9.5px] mt-0.5 text-paper-faint">
                  当场抽提正文，不跳外链
                </div>
              </button>
              <button
                type="button"
                onClick={() => {
                  if (autoPlaying && timerRef.current) window.clearTimeout(timerRef.current)
                  setAutoPlaying(false)
                  setTapPosition(null)
                  setOpenedArticle({
                    id: 'lead-click',
                    source: '澎湃·特稿',
                    title: '回到县城的人们：一份持续十年的中部就业观察',
                    time: '2 小时前',
                    category: '深度人文',
                    summary: '我们跟踪了 47 位从沿海返乡的务工者。',
                  })
                  setActiveStep(3)
                }}
                className={`rounded-xl p-2.5 text-left transition-all ${
                  activeStep === 3
                    ? 'border border-cinnabar/60 bg-cinnabar/15 text-paper shadow-sm'
                    : 'border border-transparent text-paper-muted hover:border-haze hover:bg-ink-raised/50'
                }`}
              >
                <div className="font-bold text-cinnabar-soft">③ 站内读完</div>
                <div className="text-[9.5px] mt-0.5 text-paper-faint">
                  断网/飞行/无云无阻
                </div>
              </button>
            </div>
          </div>

          {/* 底部架构亮点胶囊 */}
          <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-1.5 font-mono text-[11px] tracking-[0.08em] text-paper-muted">
            <span className="flex items-center gap-1">
              <ShieldCheck size={12} className="text-cinnabar" />
              <span>开源 AGPL-3.0</span>
            </span>
            <span aria-hidden className="text-paper-faint">·</span>
            <span>通用轻量包 6 MB</span>
            <span aria-hidden className="text-paper-faint">·</span>
            <span>完整版含 Bergamot 神经网络</span>
            <span aria-hidden className="text-paper-faint">·</span>
            <span>v1.9.2</span>
          </div>
        </div>

        {/* 右侧手机界面（全功能交互设备） */}
        <div className="relative mx-auto w-full max-w-[350px] lg:max-w-[380px]">
          {/* 氛围彩色漫射光晕 */}
          <div
            className="pointer-events-none absolute -inset-8 -z-10 rounded-[3rem] bg-[radial-gradient(ellipse_at_center,rgb(var(--tone-cinnabar-rgb)/0.15),transparent_70%)] blur-3xl opacity-80"
            aria-hidden
          />

          {/* 点击手势波纹动效 */}
          <AnimatePresence>
            {tapPosition && (
              <motion.div
                initial={{ scale: 0.4, opacity: 0 }}
                animate={{ scale: [0.8, 1.4, 1.8], opacity: [0.8, 1, 0] }}
                transition={{ duration: 0.6, ease: 'easeOut' }}
                style={{ left: `${tapPosition.x}%`, top: `${tapPosition.y}px` }}
                className="pointer-events-none absolute z-50 h-12 w-12 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-cinnabar bg-cinnabar/25"
                aria-hidden
              />
            )}
          </AnimatePresence>

          <PhoneFrame className="h-[clamp(580px,80vh,660px)]" time="20:45">
            <div className="relative h-full overflow-hidden">
              {/* 主信息流 */}
              <FeedDemo
                interactive={!autoPlaying}
                onOpen={(art) => setOpenedArticle(art)}
              />

              {/* 点击条目后升起的站内阅读器 */}
              <AnimatePresence>
                {openedArticle && (
                  <motion.div
                    className="absolute inset-0 z-40 overflow-hidden"
                    initial={reduced ? { opacity: 0 } : { y: '100%' }}
                    animate={reduced ? { opacity: 1 } : { y: 0 }}
                    exit={reduced ? { opacity: 0 } : { y: '100%' }}
                    transition={{
                      duration: reduced ? 0.15 : 0.42,
                      ease: [0.22, 1, 0.36, 1],
                    }}
                  >
                    <ReaderDemo
                      article={{
                        source: openedArticle.source,
                        time: openedArticle.time,
                        title: openedArticle.title,
                        summary: openedArticle.summary,
                      }}
                      onClose={() => setOpenedArticle(null)}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </PhoneFrame>

          <div className="mt-3 flex items-center justify-between px-3 font-mono text-[10px] text-paper-faint">
            <span>↑ 手势滑动分类与点击即时响应</span>
            {openedArticle && (
              <button
                type="button"
                onClick={() => setOpenedArticle(null)}
                className="text-cinnabar-soft underline"
              >
                返回速闻列表
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
