import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
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
  tags: string[]
  component: React.ComponentType
}

const CHAPTERS: ChapterDef[] = [
  {
    id: 'feed',
    kicker: '速闻信息流',
    title: '153 个内置源直出，',
    subtitle: '不经过任何推荐服务器。',
    desc: '新闻列表由客户端直连上游发布方站点拉取。分类轨横向滑动瞬切，未读以朱砂点提示，已读自动淡化，稍后读书签与离线缓存标识一目了然。点按任意条目当场解析全文。',
    points: [
      '涵盖国内要闻、全球视野、财经、科技、AI、科学、人文等 8 大分组',
      '下拉与双击底栏触发水墨回弹刷新动效',
      '分类标签指示条弹簧滑动，条目加载平滑错峰',
    ],
    tags: ['153 个内置源', '直连上游', '0 推荐算法', '本地首屏直出'],
    component: FeedScreenDemo,
  },
  {
    id: 'presets',
    kicker: '场景预设',
    title: '8 大官方快照互斥，',
    subtitle: '一键整包切换阅读眼镜。',
    desc: '预设是整套布局的原子快照：分类顺序、显隐状态、信源覆盖与综合频道编排一键整包替换。互斥生效，支持另存为个人定制预设或随时恢复出厂。',
    points: [
      '通勤切换「全球视野」，工作切换「科技数码」，睡前切换「深度人文」',
      '点击后选中框以高刚度弹簧吸附移动',
      '综合频道自适应混合编排，配置互不串味',
    ],
    tags: ['8 套快照互斥', '整包原子替换', '弹簧吸附', '自适应综合流'],
    component: PresetsScreenDemo,
  },
  {
    id: 'reader',
    kicker: '站内阅读与翻译',
    title: '打开条目就在应用内，',
    subtitle: '纯净排版读完。',
    desc: 'Readability 引擎即时抽取正文并过滤广告。支持「全文替代」与「对比翻译」自由切换，外文段落可折叠展开对照。字号、行距、边距在阅读器内实时联动重排。',
    points: [
      '对比翻译模式下，英文段落下插展开中文译文',
      '全文替代模式一键将外文原位切换为中文',
      '字号 5 档微调与行距 3 档实时重排',
    ],
    tags: ['Readability 引擎', '双模对比翻译', '字号行距重排', '记忆位置'],
    component: ReaderScreenDemo,
  },
  {
    id: 'speedread',
    kicker: 'AI 智能速读',
    title: '六段结构化提炼，',
    subtitle: '万字长文与外刊秒懂。',
    desc: '对长篇特稿与深度研报进行结构化解构，依次生成核心论点、时代洞察、实证证据、结构性张力、演进研判与策略切口，直击关键逻辑骨架。',
    points: [
      '六大维度认知卡片依序流式呈现',
      '观点与原文段落精准映射，杜绝幻觉',
      '支持本地端侧与云端模型驱动',
    ],
    tags: ['六段认知解构', '端侧模型', '原文精准映射', '一键导出 Markdown'],
    component: SpeedReadScreenDemo,
  },
  {
    id: 'search',
    kicker: '本地搜索',
    title: '0 次网络请求，',
    subtitle: '毫秒级本地全文检索。',
    desc: '对手机本地持久化的全量列表缓存、正文与稍后读建立高性能本地索引。输入关键词即时高亮匹配，全程离线运行，绝无网络延迟与足迹追踪。',
    points: [
      '毫秒级即时检索，断网飞行模式完全可用',
      '标题与正文关键词朱砂色彩精准高亮',
      '严格零网络请求，保证绝对隐私',
    ],
    tags: ['0 次网络请求', '毫秒级端侧索引', '朱砂高亮匹配', '绝对隐私保护'],
    component: SearchScreenDemo,
  },
  {
    id: 'store',
    kicker: '订阅与 OPML',
    title: '34,270 个源离线目录，',
    subtitle: '订阅开关实时生效。',
    desc: '内置 IndexedDB 本地海量目录快照，支持无网模糊检索与网址嗅探。订阅源开关即开即停，完整支持标准 OPML 树状目录导入导出与 RSSHub 路由匹配。',
    points: [
      '每个信源开关带有独立弹簧物理动效',
      '34,270 个源离线检索，支持别名与拼音容错',
      '单文件 OPML 导入导出无损还原层级',
    ],
    tags: ['34,270 个离线目录', 'OPML 树无损导入导出', 'RSSHub 路由', '即开即停'],
    component: StoreScreenDemo,
  },
  {
    id: 'appearance',
    kicker: '外观与排版',
    title: '切到「夜读」，',
    subtitle: '整台手机沉入冷墨静谧。',
    desc: '从客户端迁移莫问、群青、不二三大官方精选方案，均为双态独立调色，拒绝简单反色。切换昼读/夜读瞬间全站以 240ms 如灯亮起般过渡。字号大小与行高间距支持无级微调。',
    points: [
      '莫问（宣纸朱砂）、群青（冷白克莱因蓝）、不二（先锋黑白墨翠）',
      '夜读底色沉静护眼，昼读温润细腻，拒绝生硬反色',
      '字号缩放与行距即时重绘正文排版，支持纯黑白墨水屏模式',
    ],
    tags: ['莫问 · 群青 · 不二', '双态独立调色', '纯黑白墨水屏', '排版无级调节'],
    component: AppearanceScreenDemo,
  },
  {
    id: 'browser',
    kicker: '内置隐私浏览器',
    title: '油猴脚本与媒体嗅探，',
    subtitle: '全页看图与独立沙箱。',
    desc: '系统级独立会话容器。原生支持油猴脚本（Tampermonkey）热注入与权限审查，内嵌流媒体嗅探一键画中画悬浮/投屏，全页图片一键提取看图模式，并支持 Readability 站内正文提炼一键转入沉浸阅读。',
    points: [
      '油猴脚本管理器：支持 .user.js 规则热挂载、域名匹配与权限审查',
      '媒体流嗅探引擎：1080P/4K m3u8 自动捕获与画中画悬浮播放',
      '全页看图模式：文章高清图集一键瀑布流提炼与批量相册保存',
    ],
    tags: ['油猴脚本热挂载', '媒体流嗅探', '全页看图提取', 'WebView 隔离沙箱'],
    component: BrowserScreenDemo,
  },
  {
    id: 'cms',
    kicker: 'CMS 网页目录生成',
    title: '苹果CMS与影视APP，',
    subtitle: '无需 RSS 自动转原生流。',
    desc: '基于 FrameworkDetect 引擎深度适配苹果CMS (MacCMS)、海洋CMS、飞飞CMS 与 WordPress、Typecho、Hugo。影视站点天然变身原生海报墙与选集播放器；博客资讯站一键提取专栏树与站内全文。',
    points: [
      '苹果CMS/海洋CMS：2:3 原生海报墙、4K 蓝光流嗅探与选集播放',
      'WordPress/Hugo：整站专栏树与目录解析，无 RSS 亦可原生订阅',
      '列表与详情直连上游，无中转服务器依赖，秒级响应',
    ],
    tags: ['苹果CMS / 海洋CMS', '2:3 原生海报墙', 'WordPress 专栏树', '无需 RSS'],
    component: CmsScreenDemo,
  },
  {
    id: 'eink',
    kicker: '电子墨水屏重构',
    title: '为电子墨水，',
    subtitle: '重新设计阅读行为。',
    desc: '开启墨水屏模式彻底消除过渡动画与毛玻璃阴影，自动转为整页翻页。左 28% 翻上一页、中间 44% 呼出 EinkReaderMenu 专属菜单、右 28% 翻下一页，物理音量键直接翻页。',
    points: [
      '极高黑白灰对比度，页面刷新零残影',
      'EinkReaderMenu 专有底抽屉与五宫格快捷键',
      '分页视口内图片自适应限高防撑破版面',
    ],
    tags: ['整页无动画翻页', 'EinkReaderMenu 专有抽屉', '物理音量键翻页', '高反差黑白'],
    component: EinkScreenDemo,
  },
  {
    id: 'recommend',
    kicker: '本地个性化推荐',
    title: '算法留在手机里，',
    subtitle: '数据绝不出本机。',
    desc: '累计读满 5 篇后「推荐」频道自动激活。综合打分公式 = 0.55 内容相似度 + 0.20 信源亲和度 + 0.25 新鲜度衰减，同源候选项按 0.82 幂次严密打散。',
    points: [
      '中文字符 Bigram 余弦相似度计算，标题赋予 2 倍权重',
      '冷启动前优雅退化为时间序，用户画像绝不上报',
      '与主新闻流状态轴解耦，绝不反向污染订阅',
    ],
    tags: ['0.55/0.20/0.25 模型', 'Bigram 余弦相似度', '读满 5 篇激活', '数据永不出机'],
    component: RecommendScreenDemo,
  },
  {
    id: 'sync',
    kicker: '可选云同步',
    title: '业务优先写本地，',
    subtitle: '换设备无需重配。',
    desc: '仅同步自建订阅、分类、预设与 Keystore 加密 Secret；正文全文、已读、稍后读与阅读进度永不出机。多端冲突时提供三方合并决策与自动快照。',
    points: [
      'Outbox 影子比对增量上传，断网阅读完全无阻',
      '多端冲突提供保留本机、使用云端与智能合并三选一',
      'Secret 走 Android Keystore 硬件级加密存储',
    ],
    tags: ['Outbox 影子比对', '三方冲突决策', 'Keystore 硬件加密', '端侧持久化优先'],
    component: SyncScreenDemo,
  },
  {
    id: 'media',
    kicker: '媒体嗅探与画中画',
    title: '蓝光流一键捕获，',
    subtitle: '切页悬浮播放不中断。',
    desc: '自动扫描页面与正文中隐藏的 mp4/m3u8 蓝光视频流与音频直链。支持画中画悬浮窗手势缩放与边缘吸附，并支持一键通过 DLNA/UPnP 投射至大屏电视。',
    points: [
      '自动注入 Origin Headers 突破防盗链限制',
      '切换至任意应用页面音画播放无缝持续',
      '局域网电视大屏无线一键串流',
    ],
    tags: ['1080P/4K HLS 捕获', '画中画无缝切页', 'DLNA 电视大屏投屏', '防盗链穿透'],
    component: MediaScreenDemo,
  },
  {
    id: 'workspaces',
    kicker: '专属社区工作区',
    title: '知乎热榜与 LINUX DO，',
    subtitle: '高对比度徽章与论坛直连。',
    desc: '原生级独立工作区。知乎专区呈现醒目 01/02/03 高对比度热榜、4,580 万热度指数与回答连续上拉；LINUX DO 专区深度直连 Discourse 协议，完整还原站长角标、分类彩色标签与讨论楼层。',
    points: [
      '知乎工作区：醒目数字热榜、作者认证、精选回答与上拉连续阅读',
      'LINUX DO 社区：Discourse 论坛 API 直连、站长角标与未读脉冲',
      '完全独立的 Cookie/Storage 运行环境，绝不反向污染主新闻流',
    ],
    tags: ['知乎 01/02/03 热榜', 'LINUX DO 站长角标', 'Discourse 协议直连', '状态轴完全解耦'],
    component: WorkspacesScreenDemo,
  },
]

export function NarrativeShowcase() {
  const [activeChapterId, setActiveChapterId] = useState<string>(CHAPTERS[0].id)

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

  const scrollToChapter = (id: string) => {
    // 立即响应点击切换，无延迟
    setActiveChapterId(id)
    const el = document.getElementById(id)
    if (el) {
      const y = el.getBoundingClientRect().top + window.scrollY - 80
      window.scrollTo({ top: y, behavior: 'smooth' })
    }
  }

  const activeIndex = CHAPTERS.findIndex((c) => c.id === activeChapterId)
  const currentChapter = CHAPTERS[activeIndex >= 0 ? activeIndex : 0]
  const ActivePhoneScreen = currentChapter.component

  return (
    <section className="relative py-12 lg:py-20">
      <div className="page-x mx-auto max-w-6xl">
        {/* 宽屏顶部快速章节索引胶囊轨 */}
        <div className="mb-10 hidden lg:flex items-center gap-1.5 overflow-x-auto scroll-hidden py-1.5 border-b border-haze/40">
          <span className="font-mono text-[10px] text-paper-faint tracking-wider shrink-0 mr-1.5">
            功能章节索引：
          </span>
          <div className="flex items-center gap-1 overflow-x-auto scroll-hidden">
            {CHAPTERS.map((chap, idx) => {
              const isSelected = chap.id === activeChapterId
              return (
                <button
                  key={chap.id}
                  type="button"
                  onClick={() => scrollToChapter(chap.id)}
                  className={`pressable flex items-center gap-1 shrink-0 rounded-full px-2.5 py-1 font-mono text-[10.5px] transition-all ${
                    isSelected
                      ? 'border border-cinnabar/60 bg-cinnabar/15 font-bold text-cinnabar-soft shadow-xs'
                      : 'border border-transparent text-paper-muted hover:border-haze hover:bg-ink-raised/50 hover:text-paper'
                  }`}
                >
                  <span className="text-[9px] opacity-70">{String(idx + 1).padStart(2, '0')}</span>
                  <span>{chap.kicker}</span>
                </button>
              )
            })}
          </div>
        </div>

        {/* 宽屏双栏布局：左侧滚动章节文字，右侧吸顶固定手机 */}
        <div className="grid lg:grid-cols-[1.05fr_0.95fr] lg:gap-12 items-start">
          {/* 左侧章节叙事流 */}
          <div className="space-y-20 lg:space-y-28 lg:py-10">
            {CHAPTERS.map((chap, idx) => {
              const isActive = chap.id === activeChapterId
              const Comp = chap.component

              return (
                <div
                  key={chap.id}
                  id={chap.id}
                  className={`transition-all duration-300 ${
                    isActive
                      ? 'border-l-2 border-cinnabar pl-4 -ml-4 bg-cinnabar/[0.025] rounded-r-2xl py-3'
                      : 'border-l-2 border-transparent pl-4 -ml-4 py-3'
                  }`}
                >
                  <div className="flex items-center gap-2 font-mono text-[10.5px] tracking-[0.22em]">
                    <span
                      className={`h-px transition-all duration-300 ${
                        isActive ? 'w-8 bg-cinnabar' : 'w-4 bg-haze'
                      }`}
                      aria-hidden
                    />
                    <span className="font-mono opacity-70 text-paper-faint">{String(idx + 1).padStart(2, '0')}</span>
                    <span className={isActive ? 'text-cinnabar-soft font-bold' : 'text-paper-muted'}>
                      {chap.kicker}
                    </span>
                  </div>

                  <h2 className="mt-4 font-display text-[clamp(1.8rem,3.6vw,2.7rem)] leading-[1.25] text-paper">
                    <span className="block text-paper">{chap.title}</span>
                    {chap.subtitle && (
                      <span className={`block transition-colors duration-200 ${isActive ? 'text-cinnabar-soft font-bold' : 'text-paper'}`}>
                        {chap.subtitle}
                      </span>
                    )}
                  </h2>

                  <p className="mt-4 max-w-[34rem] text-[15px] leading-[1.85] text-paper/85">
                    {chap.desc}
                  </p>

                  {/* 工程亮点特性胶囊 */}
                  <div className="mt-4 flex flex-wrap gap-1.5 max-w-[34rem]">
                    {chap.tags.map((t) => (
                      <span
                        key={t}
                        className={`rounded-full px-2.5 py-0.5 font-mono text-[10.5px] tracking-wide transition-colors ${
                          isActive
                            ? 'border border-cinnabar/60 bg-cinnabar/15 text-cinnabar-soft font-semibold shadow-2xs'
                            : 'border border-haze/80 bg-ink-raised/60 text-paper'
                        }`}
                      >
                        {t}
                      </span>
                    ))}
                  </div>

                  <ul className="mt-5 space-y-2.5 max-w-[34rem]">
                    {chap.points.map((pt) => (
                      <li
                        key={pt}
                        className="flex items-start gap-2.5 text-[13.5px] leading-[1.7] text-paper"
                      >
                        <span
                          className={`mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full transition-colors ${
                            isActive
                              ? 'bg-cinnabar shadow-[0_0_8px_rgb(var(--tone-cinnabar-rgb)/0.7)]'
                              : 'bg-paper-faint'
                          }`}
                        />
                        <span className="text-paper/90">{pt}</span>
                      </li>
                    ))}
                  </ul>

                  {/* 窄屏下：每章下方直接内嵌一台可交互的真机展示 */}
                  <div className="lg:hidden mt-8 mx-auto w-full max-w-[350px]">
                    <div className="relative">
                      <div
                        className="pointer-events-none absolute -inset-4 -z-10 rounded-[2.5rem] bg-[radial-gradient(ellipse_at_center,rgb(var(--tone-cinnabar-rgb)/0.12),transparent_70%)] blur-2xl opacity-60"
                        aria-hidden
                      />
                      <PhoneFrame className="h-[580px] shadow-xl" time="21:45">
                        <Comp />
                      </PhoneFrame>
                    </div>
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
              <div className="mb-2 flex items-center justify-between px-2 font-mono text-[10px] text-paper-faint">
                <span className="flex items-center gap-1.5 text-cinnabar-soft font-semibold">
                  <span className="h-1.5 w-1.5 rounded-full bg-cinnabar animate-pulse" />
                  <span>
                    第 {String(activeIndex + 1).padStart(2, '0')} 章 · {currentChapter.kicker}
                  </span>
                </span>
                <span className="text-[9.5px]">真机全功能 · 支持点击滑动</span>
              </div>

              <PhoneFrame className="h-[clamp(560px,78vh,660px)] shadow-2xl" time="21:45">
                <AnimatePresence mode="wait">
                  <motion.div
                    key={activeChapterId}
                    initial={{ opacity: 0, y: 12, scale: 0.985 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -12, scale: 0.985 }}
                    transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
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
