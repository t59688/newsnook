import { useState, useEffect } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { Eye, ChevronUp } from 'lucide-react'
import { PhoneFrame } from '../components/app/PhoneFrame'
import { FeedScreenDemo } from '../components/screens/FeedScreenDemo'
import { PresetsScreenDemo } from '../components/screens/PresetsScreenDemo'
import { ReaderScreenDemo } from '../components/screens/ReaderScreenDemo'
import { SpeedReadScreenDemo } from '../components/screens/SpeedReadScreenDemo'
import { SearchScreenDemo } from '../components/screens/SearchScreenDemo'
import { StoreScreenDemo } from '../components/screens/StoreScreenDemo'
import { AppearanceScreenDemo } from '../components/screens/AppearanceScreenDemo'
import { BrowserScreenDemo } from '../components/screens/BrowserScreenDemo'
import { CmsScreenDemo } from '../components/screens/CmsScreenDemo'
import { EinkScreenDemo } from '../components/screens/EinkScreenDemo'
import { RecommendScreenDemo } from '../components/screens/RecommendScreenDemo'
import { SyncScreenDemo } from '../components/screens/SyncScreenDemo'
import { MediaScreenDemo } from '../components/screens/MediaScreenDemo'
import { WorkspacesScreenDemo } from '../components/screens/WorkspacesScreenDemo'

export interface ChapterDef {
  id: string
  kicker: string
  title: string
  subtitle?: string
  desc: string
  points: string[]
  component: React.ComponentType
}

const CHAPTERS: ChapterDef[] = [
  {
    id: 'feed',
    kicker: '速闻信息流',
    title: '你想看的新闻，',
    subtitle: '自己决定从哪里开始。',
    desc: '直连你选择的媒体与 RSS 来源。打开信息流，看看新的报道；点开一篇文章，就能继续在应用内阅读。',
    points: [
      '涵盖国内要闻、全球视野、财经、科技、AI、科学、人文等 8 大分组',
      '下拉与双击底栏触发水墨回弹刷新动效',
      '分类标签指示条弹簧滑动，条目加载平滑错峰',
    ],
    component: FeedScreenDemo,
  },
  {
    id: 'presets',
    kicker: '场景预设',
    title: '忙碌的早晨与安静的夜晚，',
    subtitle: '可以有不同的首页。',
    desc: '不同的阅读场景，保留不同的频道和来源。通勤、工作或睡前，只需一次切换。',
    points: [
      '通勤切换「全球视野」，工作切换「科技数码」，睡前切换「深度人文」',
      '点击后选中框以高刚度弹簧吸附移动',
      '综合频道自适应混合编排，配置互不串味',
    ],
    component: PresetsScreenDemo,
  },
  {
    id: 'reader',
    kicker: '站内阅读与翻译',
    title: '好的文章，',
    subtitle: '值得好好读完。',
    desc: '抽取网页正文，减少干扰；字号、行距和中外文对照，都能按自己的阅读习惯调整。',
    points: [
      '对比翻译模式下，英文段落下插展开中文译文',
      '全文替代模式一键将外文原位切换为中文',
      '字号 5 档微调与行距 3 档实时重排',
    ],
    component: ReaderScreenDemo,
  },
  {
    id: 'speedread',
    kicker: 'AI 智能速读',
    title: '遇到长文章，',
    subtitle: '先抓住它的脉络。',
    desc: '用结构化速读整理文章的论点与证据，再决定哪些段落值得深入阅读。',
    points: [
      '六大维度认知卡片依序流式呈现',
      '观点与原文段落精准映射，杜绝幻觉',
      '支持本地端侧与云端模型驱动',
    ],
    component: SpeedReadScreenDemo,
  },
  {
    id: 'search',
    kicker: '本地搜索',
    title: '读过的内容，',
    subtitle: '总能再次找到。',
    desc: '在设备里搜索已经收藏和缓存的文章。查找标题与正文，不必把阅读记录交给远端服务器。',
    points: [
      '毫秒级即时检索，断网飞行模式完全可用',
      '标题与正文关键词朱砂色彩精准高亮',
      '严格零网络请求，保证绝对隐私',
    ],
    component: SearchScreenDemo,
  },
  {
    id: 'store',
    kicker: '订阅与 OPML',
    title: '想读的世界很大，',
    subtitle: '订阅却可以很简单。',
    desc: '从离线 RSS 目录里找到感兴趣的媒体、博客与专题，查看内容后再决定是否订阅。',
    points: [
      '每个信源开关带有独立弹簧物理动效',
      '34,270 个源离线检索，支持别名与拼音容错',
      '单文件 OPML 导入导出无损还原层级',
    ],
    component: StoreScreenDemo,
  },
  {
    id: 'appearance',
    kicker: '外观与排版',
    title: '界面的样子，',
    subtitle: '也应该由你决定。',
    desc: '六套独立的主题配色，昼读与夜读都经过专门调校。文字大小、行距、墨水屏翻页方式，也都可以自由选择。',
    points: [
      '墨问（宣纸朱砂）、群青（冷白克莱因蓝）、不二（先锋黑白墨翠）',
      '夜读底色沉静护眼，昼读温润细腻，拒绝生硬反色',
      '字号缩放与行距即时重绘正文排版，支持纯黑白墨水屏模式',
    ],
    component: AppearanceScreenDemo,
  },
  {
    id: 'browser',
    kicker: '内置隐私浏览器',
    title: '遇见好网页，',
    subtitle: '不必停在浏览器里。',
    desc: '内置浏览器支持脚本、媒体与图片查看；遇到值得细读的文章，还可以转换成安静的阅读页面。',
    points: [
      '油猴脚本管理器：支持 .user.js 规则热挂载、域名匹配与权限审查',
      '媒体流嗅探引擎：1080P/4K m3u8 自动捕获与画中画悬浮播放',
      '全页看图模式：文章高清图集一键瀑布流提炼与批量相册保存',
    ],
    component: BrowserScreenDemo,
  },
  {
    id: 'cms',
    kicker: 'CMS 网页目录生成',
    title: '喜欢的网站，',
    subtitle: '也能整理成阅读目录。',
    desc: '部分 CMS 和博客站点可以被识别为栏目、文章或视频列表，直接在有所闻里浏览与阅读。',
    points: [
      '苹果CMS/海洋CMS：2:3 原生海报墙、4K 蓝光流嗅探与选集播放',
      'WordPress/Hugo：整站专栏树与目录解析，无 RSS 亦可原生订阅',
      '列表与详情直连上游，无中转服务器依赖，秒级响应',
    ],
    component: CmsScreenDemo,
  },
  {
    id: 'eink',
    kicker: '电子墨水屏重构',
    title: '给电子墨水屏，',
    subtitle: '一套更自然的翻页方式。',
    desc: '弱化颜色和动画，用高对比文字、整页翻动与物理按键，找回接近纸书的节奏。',
    points: [
      '极高黑白灰对比度，页面刷新零残影',
      'EinkReaderMenu 专有底抽屉与五宫格快捷键',
      '分页视口内图片自适应限高防撑破版面',
    ],
    component: EinkScreenDemo,
  },
  {
    id: 'recommend',
    kicker: '本地个性化推荐',
    title: '更懂你的推荐，',
    subtitle: '不必知道你是谁。',
    desc: '推荐来自设备上的阅读偏好分析，而不是把你的阅读历史上传给平台。',
    points: [
      '中文字符 Bigram 余弦相似度计算，标题赋予 2 倍权重',
      '冷启动前优雅退化为时间序，用户画像绝不上报',
      '与主新闻流状态轴解耦，绝不反向污染订阅',
    ],
    component: RecommendScreenDemo,
  },
  {
    id: 'sync',
    kicker: '可选云同步',
    title: '换了设备，',
    subtitle: '熟悉的阅读习惯还在。',
    desc: '同步可选；订阅与偏好优先保存在本机，需要时再选择如何迁移和合并。',
    points: [
      'Outbox 影子比对增量上传，断网阅读完全无阻',
      '多端冲突提供保留本机、使用云端与智能合并三选一',
      'Secret 走 Android Keystore 硬件级加密存储',
    ],
    component: SyncScreenDemo,
  },
  {
    id: 'media',
    kicker: '媒体嗅探与画中画',
    title: '一篇报道之外，',
    subtitle: '还有声音和画面。',
    desc: '从文章或网页中发现媒体资源，支持画中画与设备投屏，让阅读和观看自然衔接。',
    points: [
      '自动注入 Origin Headers 突破防盗链限制',
      '切换至任意应用页面音画播放无缝持续',
      '局域网电视大屏无线一键串流',
    ],
    component: MediaScreenDemo,
  },
  {
    id: 'workspaces',
    kicker: '专属社区工作区',
    title: '喜欢的社区，',
    subtitle: '在一个地方继续关注。',
    desc: '知乎与 Linux.do 有各自的工作区，保留它们熟悉的讨论与浏览方式，不干扰主新闻流。',
    points: [
      '知乎工作区：醒目数字热榜、作者认证、精选回答与上拉连续阅读',
      'LINUX DO 社区：Discourse 论坛 API 直连、站长角标与未读脉冲',
      '完全独立的 Cookie/Storage 运行环境，绝不反向污染主新闻流',
    ],
    component: WorkspacesScreenDemo,
  },
]

const FEATURED_MOBILE_DEMOS = new Set(['feed', 'reader', 'store', 'browser'])

export function NarrativeShowcase() {
  const reduced = useReducedMotion()
  const [activeChapterId, setActiveChapterId] = useState<string>(CHAPTERS[0].id)
  const [expandedChapters, setExpandedChapters] = useState<string[]>([])
  const togglePreview = (id: string) => {
    setExpandedChapters((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  }

  useEffect(() => {
    let ticking = false

    const calculateActiveChapter = () => {
      // 视口中轴线偏上位置（黄金阅读视线）
      const focusY = window.innerHeight * 0.42
      let closestId = CHAPTERS[0].id
      let minDistance = Infinity

      for (let i = 0; i < CHAPTERS.length; i++) {
        const chap = CHAPTERS[i]
        const el = document.getElementById(chap.id)
        if (!el) continue

        const rect = el.getBoundingClientRect()
        // 章节顶部向下 120px 为焦点锚点
        const anchorY = rect.top + Math.min(rect.height * 0.35, 140)
        const distance = Math.abs(anchorY - focusY)

        if (distance < minDistance) {
          minDistance = distance
          closestId = chap.id
        }
      }

      setActiveChapterId((prev) => (prev === closestId ? prev : closestId))
    }

    const onScroll = () => {
      if (!ticking) {
        ticking = true
        window.requestAnimationFrame(() => {
          calculateActiveChapter()
          ticking = false
        })
      }
    }

    // 初始立即执行与延时复测
    calculateActiveChapter()
    const timer = window.setTimeout(calculateActiveChapter, 120)

    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll, { passive: true })

    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [])

  const activeIndex = CHAPTERS.findIndex((c) => c.id === activeChapterId)
  const currentChapter = CHAPTERS[activeIndex >= 0 ? activeIndex : 0]
  const ActivePhoneScreen = currentChapter.component

  return (
    <section className="portal-showcase relative py-12 lg:py-20">
      <div className="page-x mx-auto max-w-6xl">
        <div className="portal-showcase-intro">
          <p className="portal-overline">
            <span className="portal-overline-mark" aria-hidden="true" />
            从发现，到读完
          </p>
          <h2>每一次探索，都值得一次完整的阅读。</h2>
          <p>让工具退后，让好内容站到前面。沿着下面的章节，看看有所闻怎样陪你发现、理解和珍藏世界。</p>
        </div>

        {/* 宽屏双栏布局：左侧滚动章节文字，右侧吸顶固定手机 */}
        <div className="grid lg:grid-cols-[1.05fr_0.95fr] lg:gap-12 items-start">
          {/* 左侧章节叙事流 */}
          <div className="space-y-0 lg:py-10">
            {CHAPTERS.map((chap, idx) => {
              const isActive = chap.id === activeChapterId
              const Comp = chap.component
              const previewFeatured = FEATURED_MOBILE_DEMOS.has(chap.id)
              const previewOpen = previewFeatured || expandedChapters.includes(chap.id)

              return (
                <div
                  key={chap.id}
                  id={chap.id}
                  data-active={isActive ? 'true' : undefined}
                  className="portal-chapter"
                >
                  <div className="portal-chapter-kicker">
                    <span className="portal-chapter-number">{String(idx + 1).padStart(2, '0')}</span>
                    <span>{chap.kicker}</span>
                  </div>

                  <h2 className="portal-chapter-title font-display text-paper">
                    <span className="block">{chap.title}</span>
                    {chap.subtitle && <span className="portal-chapter-subtitle block">{chap.subtitle}</span>}
                  </h2>

                  <p className="portal-chapter-desc">{chap.desc}</p>

                  <ul className="portal-chapter-points">
                    {chap.points.slice(0, 2).map((pt) => (
                      <li key={pt}>{pt}</li>
                    ))}
                  </ul>

                  {/* 手机端保留四个核心真机展示，其余章节按需展开，避免十四台手机连排。 */}
                  <div className="portal-mobile-preview lg:hidden">
                    {previewOpen ? (
                      <div className="mx-auto w-full max-w-[350px]">
                        <PhoneFrame className="h-[580px] shadow-xl" time="21:45">
                          <Comp />
                        </PhoneFrame>
                        {!previewFeatured && (
                          <button type="button" className="portal-mobile-preview-collapse" onClick={() => togglePreview(chap.id)}>
                            收起界面 <ChevronUp size={15} strokeWidth={1.65} aria-hidden="true" />
                          </button>
                        )}
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="portal-mobile-preview-trigger pressable"
                        aria-expanded="false"
                        onClick={() => togglePreview(chap.id)}
                      >
                        <span>查看「{chap.kicker}」界面</span>
                        <Eye size={16} strokeWidth={1.6} aria-hidden="true" />
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {/* 宽屏下：右侧钉住吸顶的手机界面（垂直居中自适应，跟随左侧章节滚动瞬切） */}
          <div className="hidden lg:flex sticky top-14 z-30 flex-col justify-center min-h-[calc(100vh-4.5rem)] py-4">
            <div className="relative mx-auto w-full max-w-[370px]">
              {/* 氛围彩色漫射光晕 */}
              <div
                className="pointer-events-none absolute -inset-8 -z-10 rounded-[3rem] bg-[radial-gradient(ellipse_at_center,rgb(var(--tone-cinnabar-rgb)/0.15),transparent_70%)] blur-3xl opacity-75"
                aria-hidden
              />

              {/* 顶部交互引导状态指示器 */}
              <div className="portal-stage-topline">
                <span className="flex items-center gap-1.5 text-cinnabar-soft font-semibold">
                  <span className="h-1.5 w-1.5 rounded-full bg-cinnabar animate-pulse" />
                  <span>
                    第 {String(activeIndex + 1).padStart(2, '0')} 章 · {currentChapter.kicker}
                  </span>
                </span>
                <span className="text-[9.5px]">交互式界面展示</span>
              </div>

              <PhoneFrame className="h-[clamp(560px,78vh,660px)] shadow-2xl" time="21:45">
                <AnimatePresence mode="wait">
                  <motion.div
                    key={activeChapterId}
                    initial={reduced ? false : { opacity: 0, y: 12, scale: 0.985 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={reduced ? { opacity: 0 } : { opacity: 0, y: -12, scale: 0.985 }}
                    transition={reduced ? { duration: 0 } : { duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                    className="h-full w-full"
                  >
                    <ActivePhoneScreen />
                  </motion.div>
                </AnimatePresence>
              </PhoneFrame>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
