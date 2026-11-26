import { useState } from 'react'
import {
  ArrowLeft,
  BatteryLow,
  CheckCircle2,
  ChevronDown,
  Eye,
  Flame,
  Heart,
  ListFilter,
  MessageCircle,
  MessageSquareQuote,
  RefreshCcw,
  Search,
  Shield,
  ThumbsUp,
  X,
} from 'lucide-react'
import { TabBar } from '../app/TabBar'
import { PhoneStatusBar } from '../app/PhoneStatusBar'

interface ZhihuItem {
  id: string
  rank: number
  title: string
  author: string
  headline: string
  verified: boolean
  hotMetric: string
  upvotes: string
  comments: number
  excerpt: string
  kind: 'answer' | 'article'
  ipLocation: string
  publishTime: string
}

const ZHIHU_HOT_ITEMS: ZhihuItem[] = [
  {
    id: 'zh-1',
    rank: 1,
    title: '如何评价国产大模型在端侧长程推理与状态空间架构上的最新突破？',
    author: '王元',
    headline: '系统架构师 / 优秀答主',
    verified: true,
    hotMetric: '4,580 万热度',
    upvotes: '3.8 万',
    comments: 524,
    excerpt: '先说核心结论：上下文长度只是技术入场券，真正的分水岭在端侧推理量化精度与长程记忆治理。本文对比分析 Transformer 与 SSM 混合模型在 Android 端侧的实际能效比……',
    kind: 'answer',
    ipLocation: '北京',
    publishTime: '2026-11-05 14:20',
  },
  {
    id: 'zh-2',
    rank: 2,
    title: '在 2026 年，坚持本地优先（Local-First）软件架构还具有现实可行性吗？',
    author: '陈明',
    headline: '独立全栈开发者',
    verified: true,
    hotMetric: '2,940 万热度',
    upvotes: '1.4 万',
    comments: 218,
    excerpt: '本地优先带来的不是技术怀旧，而是对用户数据主权、毫秒级响应和极端离线健壮性的极致尊重。借助 SQLite 与影子对账队列，客户端在无网状态下依然可以实现 100% 的业务自洽……',
    kind: 'answer',
    ipLocation: '上海',
    publishTime: '2026-11-04 21:05',
  },
  {
    id: 'zh-3',
    rank: 3,
    title: '深入理解浏览器 System WebView 隔离沙箱与跨域媒体流嗅探机制',
    author: '张林',
    headline: 'Web 运行时安全专家',
    verified: false,
    hotMetric: '1,680 万热度',
    upvotes: '8,920',
    comments: 146,
    excerpt: '探讨 Android 平台下如何利用 CookieManager 隔离独立工作区，并通过 Native 拦截层实现 m3u8/mp4 媒体资源的无感提取……',
    kind: 'article',
    ipLocation: '杭州',
    publishTime: '2026-11-03 18:30',
  },
]

interface LinuxDoTopic {
  id: string
  title: string
  author: string
  isSiteAdmin: boolean
  category: { name: string; color: string; slug: string }
  tags: string[]
  replies: number
  views: string
  likes: number
  time: string
  lastUser: string
  isUnread: boolean
  isHot: boolean
  content: string
}

const LINUXDO_TOPICS: LinuxDoTopic[] = [
  {
    id: 'ld-1',
    title: '关于客户端高频并发抓取与会话保活协议的深度调优经验分享',
    author: 'neo',
    isSiteAdmin: true,
    category: { name: '开发调优', color: '#0088cc', slug: 'develop' },
    tags: ['LinuxDo', '客户端', '开源分享'],
    replies: 184,
    views: '5.6k',
    likes: 320,
    time: '2 小时前',
    lastUser: 'musk',
    isUnread: true,
    isHot: true,
    content: '梳理高频直连场景下的 HTTP/2 连接池复用、SSL 握手缓存与自适应指数退避策略。在 Android 环境下，通过 OkHttp 原生插件规避平台层解析限制，实现了 0 次失败率的稳定直连。',
  },
  {
    id: 'ld-2',
    title: '开源离线阅读器逆向工程笔记：从 DOMPurify 到端侧双语对照排版',
    author: 'cyrus',
    isSiteAdmin: false,
    category: { name: '开源分享', color: '#25e298', slug: 'opensource' },
    tags: ['阅读器', '逆向工程', '前端排版'],
    replies: 92,
    views: '2.8k',
    likes: 145,
    time: '昨天',
    lastUser: 'linus',
    isUnread: true,
    isHot: false,
    content: '探讨如何在无服务端代理的情况下，在 Android System WebView 中实现高纯净度正文抽取，并通过 CSS Grid 实现零位移的双语折叠翻译排版。',
  },
]

export function WorkspacesScreenDemo() {
  const [workspace, setWorkspace] = useState<'zhihu' | 'linuxdo'>('zhihu')
  const [zhihuMode, setZhihuMode] = useState<'hot' | 'smart' | 'following'>('hot')
  const [linuxdoMode, setLinuxdoMode] = useState<'latest' | 'hot' | 'new' | 'unread'>('latest')
  const [activeZhihuArticle, setActiveZhihuArticle] = useState<ZhihuItem | null>(null)
  const [activeLinuxDoTopic, setActiveLinuxDoTopic] = useState<LinuxDoTopic | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const handleRefresh = () => {
    setRefreshing(true)
    setTimeout(() => setRefreshing(false), 600)
  }

  return (
    <div className="relative flex h-full flex-col bg-ink text-paper select-none">
      {/* 顶部工作区切换胶囊导航 */}
      <header className="relative z-20 shrink-0 border-b border-haze/40 bg-ink/95 backdrop-blur-xl">
        <PhoneStatusBar />
        <div className="flex items-center justify-between px-3 py-1">
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label="返回"
              className="flex h-7 w-7 items-center justify-center rounded-full text-paper-muted hover:bg-paper/8 hover:text-paper"
            >
              <ArrowLeft size={16} strokeWidth={2} />
            </button>

          {/* 知乎 / LINUX DO 核心工作区切换开关 */}
          <div className="flex rounded-lg border border-haze bg-ink-raised/70 p-0.5 font-mono text-[10.5px]">
            <button
              type="button"
              onClick={() => {
                setWorkspace('zhihu')
                setActiveZhihuArticle(null)
                setActiveLinuxDoTopic(null)
              }}
              className={`rounded-md px-2.5 py-1 font-semibold transition-all ${
                workspace === 'zhihu'
                  ? 'bg-[#0066FF] text-white shadow-xs'
                  : 'text-paper-muted hover:text-paper'
              }`}
            >
              知乎工作区
            </button>
            <button
              type="button"
              onClick={() => {
                setWorkspace('linuxdo')
                setActiveZhihuArticle(null)
                setActiveLinuxDoTopic(null)
              }}
              className={`rounded-md px-2.5 py-1 font-semibold transition-all ${
                workspace === 'linuxdo'
                  ? 'bg-cinnabar text-white shadow-xs'
                  : 'text-paper-muted hover:text-paper'
              }`}
            >
              LINUX DO 社区
            </button>
          </div>
        </div>

        <div className="flex items-center gap-1 font-mono text-[9px] text-cinnabar-soft font-semibold">
          <Shield size={11} />
          <span>独立沙箱凭证</span>
        </div>
        </div>
      </header>

      {/* ======================= 知乎工作区真实界面 ======================= */}
      {workspace === 'zhihu' ? (
        <div className="flex min-h-0 flex-1 flex-col">
          {/* 知乎特色搜索与状态栏 */}
          <div className="flex items-center justify-between gap-2 border-b border-haze/30 bg-ink-raised/40 px-3 py-1.5">
            <div className="flex min-w-0 flex-1 items-center gap-2 rounded-full border border-haze bg-ink px-2.5 py-1 text-[11px] text-paper-faint">
              <Search size={12} className="text-[#0066FF]" />
              <span className="truncate">搜索知乎热点、问题或作者…</span>
            </div>
            <button
              type="button"
              onClick={handleRefresh}
              aria-label="刷新热榜"
              className="flex h-7 w-7 items-center justify-center rounded-full text-paper-muted hover:bg-paper/8 hover:text-[#0066FF]"
            >
              <RefreshCcw size={12} className={refreshing ? 'animate-spin text-[#0066FF]' : ''} />
            </button>
          </div>

          {/* 知乎三栏模式 Tab: 精选 / 热榜 / 关注 */}
          <div className="flex items-center justify-around border-b border-haze/40 bg-ink px-2 py-1 font-mono text-[11.5px]">
            {(
              [
                { id: 'hot', label: '热榜' },
                { id: 'smart', label: '精选 (Smart)' },
                { id: 'following', label: '关注动态' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setZhihuMode(tab.id)}
                className={`relative px-3 py-1.5 font-medium transition-colors ${
                  zhihuMode === tab.id ? 'font-bold text-[#0066FF]' : 'text-paper-muted hover:text-paper'
                }`}
              >
                <span>{tab.label}</span>
                {zhihuMode === tab.id && (
                  <span className="absolute bottom-0 left-1/2 h-0.5 w-6 -translate-x-1/2 rounded-full bg-[#0066FF]" />
                )}
              </button>
            ))}
          </div>

          {/* 知乎热榜内容流（严格复刻 ZhihuFeedScreen.tsx & ZhihuHotRankBadge） */}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 space-y-2.5">
            {ZHIHU_HOT_ITEMS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveZhihuArticle(item)}
                className="group flex w-full items-start gap-3 rounded-2xl border border-haze/50 bg-ink-raised/60 p-3 text-left transition-all hover:border-[#0066FF]/40 active:scale-[0.99] shadow-2xs"
              >
                {/* 醒目高对比度名次徽章 (01, 02, 03) */}
                <div className="pt-0.5 shrink-0">
                  {item.rank === 1 ? (
                    <span className="inline-flex min-w-[1.65rem] font-mono text-[17.5px] font-black leading-none tracking-tighter text-[#FF3838] drop-shadow-[0_1px_6px_rgba(255,56,56,0.35)]">
                      01
                    </span>
                  ) : item.rank === 2 ? (
                    <span className="inline-flex min-w-[1.65rem] font-mono text-[17.5px] font-black leading-none tracking-tighter text-[#FF7700] drop-shadow-[0_1px_6px_rgba(255,119,0,0.3)]">
                      02
                    </span>
                  ) : item.rank === 3 ? (
                    <span className="inline-flex min-w-[1.65rem] font-mono text-[17.5px] font-black leading-none tracking-tighter text-[#F5A623] drop-shadow-[0_1px_6px_rgba(245,166,35,0.25)]">
                      03
                    </span>
                  ) : (
                    <span className="inline-flex min-w-[1.65rem] font-mono text-[15.5px] font-bold leading-none text-paper-muted">
                      0{item.rank}
                    </span>
                  )}
                </div>

                {/* 主体内容 */}
                <div className="min-w-0 flex-1 space-y-1.5">
                  <h3 className="font-sans text-[14.5px] font-semibold leading-[1.4] tracking-tight text-paper group-hover:text-[#0066FF] transition-colors">
                    {item.title}
                  </h3>

                  <p className="line-clamp-2 text-[12px] leading-[1.6] text-paper-muted">{item.excerpt}</p>

                  {/* 底部元数据 */}
                  <div className="flex items-center justify-between gap-2 pt-1 font-mono text-[10.5px]">
                    <div className="flex items-center gap-2 text-paper-muted">
                      {/* 作者头像与认证勾选 */}
                      <span className="relative flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-paper/10 text-[8px] font-bold">
                        {item.author[0]}
                        {item.verified && (
                          <span className="absolute -bottom-0.5 -right-0.5 flex h-2.5 w-2.5 items-center justify-center rounded-full bg-[#0066FF] text-white">
                            <CheckCircle2 size={8} strokeWidth={3} />
                          </span>
                        )}
                      </span>
                      <span className="truncate max-w-24 text-paper-muted font-medium">{item.author}</span>

                      {/* 热度指数 */}
                      <span className="inline-flex items-center gap-0.5 font-semibold text-[#FF7700]">
                        <Flame size={11} className="fill-[#FF7700]/20 text-[#FF7700]" />
                        <span>{item.hotMetric}</span>
                      </span>

                      {/* 赞同数 */}
                      <span className="inline-flex items-center gap-0.5 text-[#0066FF]">
                        <ThumbsUp size={10.5} />
                        <span>{item.upvotes}</span>
                      </span>
                    </div>

                    {/* 回答 / 文章徽标 */}
                    <span className="inline-flex items-center gap-0.5 text-paper-faint text-[10px]">
                      <MessageSquareQuote size={11} />
                      <span>回答</span>
                    </span>
                  </div>
                </div>
              </button>
            ))}

            {/* 连续回答上拉指示条 (ZhihuAnswerContinuation) */}
            <div className="mt-4 flex items-center justify-center border-t border-haze/40 pt-4 text-center font-mono text-[10px] tracking-wider text-paper-faint">
              <span>到达底部后，持续上拉预览相邻精选回答</span>
            </div>
          </div>
        </div>
      ) : (
        /* ======================= LINUX DO 社区真实界面 ======================= */
        <div className="flex min-h-0 flex-1 flex-col">
          {/* LINUX DO 专属 Discourse 顶栏 */}
          <div className="page-x flex items-center gap-1.5 py-1.5 border-b border-haze/30 bg-ink-raised/50">
            {/* 模式选择 */}
            <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto rounded-xl border border-paper/[0.06] bg-paper/[0.03] p-1 scrollbar-none">
              {(
                [
                  { id: 'latest', label: '最新' },
                  { id: 'hot', label: '热门' },
                  { id: 'new', label: '新' },
                  { id: 'unread', label: '未读' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setLinuxdoMode(tab.id)}
                  className={`min-h-[28px] shrink-0 rounded-lg px-2.5 py-0.8 text-[11px] font-medium transition-all ${
                    linuxdoMode === tab.id
                      ? 'bg-cinnabar text-white font-semibold shadow-[0_2px_8px_rgba(235,68,54,0.35)]'
                      : 'text-paper-muted hover:bg-paper/[0.05] hover:text-paper'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <button
              type="button"
              className="inline-flex h-7 shrink-0 items-center gap-1 rounded-xl border border-paper/[0.08] bg-paper/[0.03] px-2 text-[10.5px] text-paper-muted"
            >
              <ListFilter size={11.5} />
              <ChevronDown size={9.5} className="text-paper-faint" />
            </button>

            <button
              type="button"
              onClick={handleRefresh}
              className="grid h-7 w-7 shrink-0 place-items-center rounded-xl border border-paper/[0.08] bg-paper/[0.03] text-paper-muted hover:text-cinnabar"
            >
              <RefreshCcw size={11.5} className={refreshing ? 'animate-spin text-cinnabar' : ''} />
            </button>
          </div>

          {/* 新话题更新条 */}
          <div className="flex shrink-0 justify-center border-b border-haze/30 bg-cinnabar/8 px-3 py-1 font-mono text-[10px] text-cinnabar-soft font-semibold">
            <span>发现 2 个更新过的话题 · 会话保活</span>
          </div>

          {/* Discourse 主题流 (严格复刻 TopicCard 来自 shared.tsx) */}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 space-y-2.5">
            {LINUXDO_TOPICS.map((topic) => (
              <article
                key={topic.id}
                onClick={() => setActiveLinuxDoTopic(topic)}
                className="group relative w-full cursor-pointer rounded-2xl border border-haze/50 bg-ink-raised/85 p-3 text-left transition-all hover:border-cinnabar/40 shadow-xs"
              >
                <div className="flex items-start gap-2.5">
                  {/* 作者头像 */}
                  <div className="relative mt-0.5 shrink-0">
                    <div
                      className={
                        topic.isSiteAdmin
                          ? 'relative flex h-8 w-8 items-center justify-center overflow-hidden rounded-[7px] ring-1 ring-paper/10 bg-ink-deep font-mono text-[12px] font-bold text-[#0088ff]'
                          : 'relative flex h-8 w-8 items-center justify-center overflow-hidden rounded-full ring-1 ring-paper/10 bg-ink-deep font-mono text-[12px] font-bold text-paper'
                      }
                    >
                      {topic.author[0].toUpperCase()}
                    </div>
                    {/* 站长专属徽章 */}
                    {topic.isSiteAdmin && (
                      <span
                        title="站长"
                        className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[#0088ff] text-white ring-1.5 ring-ink-raised"
                      >
                        <BatteryLow size={9} strokeWidth={2.5} />
                      </span>
                    )}
                  </div>

                  {/* 主体信息 */}
                  <div className="min-w-0 flex-1">
                    {/* 顶栏作者与时间 */}
                    <div className="mb-1 flex items-center justify-between text-[11px]">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`font-semibold ${
                            topic.isSiteAdmin ? 'text-[#0088ff] font-bold' : 'text-paper'
                          }`}
                        >
                          {topic.author}
                        </span>
                        {topic.isSiteAdmin && (
                          <Shield size={11} className="fill-[#0088ff] text-[#0088ff]" />
                        )}
                        {topic.isHot && (
                          <span className="inline-flex items-center gap-0.5 rounded-full bg-cinnabar/12 border border-cinnabar/25 px-1.5 py-0.2 font-mono text-[8.5px] font-bold text-cinnabar">
                            <Flame size={8.5} className="fill-cinnabar text-cinnabar" />
                            <span>HOT</span>
                          </span>
                        )}
                      </div>
                      <span className="font-mono text-[10px] text-paper-faint">{topic.time}</span>
                    </div>

                    {/* 标题与未读脉冲蓝点 */}
                    <div className="flex items-start gap-1.5">
                      <h3 className="line-clamp-2 flex-1 font-display text-[14px] font-semibold leading-[1.38] text-paper group-hover:text-cinnabar-soft transition-colors">
                        {topic.title}
                      </h3>
                      {topic.isUnread && (
                        <span className="mt-1 size-2 shrink-0 rounded-full bg-sky-400 shadow-[0_0_8px_rgba(56,189,248,0.7)] ring-2 ring-sky-400/20" />
                      )}
                    </div>

                    {/* 分类标签与 Tags */}
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 font-mono text-[10px]">
                      <span
                        style={{
                          backgroundColor: `color-mix(in srgb, ${topic.category.color} 15%, transparent)`,
                          color: topic.category.color,
                          borderColor: `color-mix(in srgb, ${topic.category.color} 30%, transparent)`,
                        }}
                        className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-semibold"
                      >
                        <span>{topic.category.slug === 'develop' ? '</>' : '■'}</span>
                        <span>{topic.category.name}</span>
                      </span>

                      {topic.tags.map((tag) => (
                        <span
                          key={tag}
                          className="rounded-md border border-paper/[0.08] bg-paper/[0.03] px-1.5 py-0.5 text-paper-muted"
                        >
                          #{tag}
                        </span>
                      ))}
                    </div>

                    {/* 底部数据：最后回复与互动 */}
                    <div className="mt-2 flex items-center justify-between text-[10px] text-paper-faint font-mono">
                      <span>最后回复 @{topic.lastUser}</span>
                      <div className="flex items-center gap-2.5">
                        <span className="inline-flex items-center gap-1 font-medium text-paper-muted">
                          <MessageCircle size={11} />
                          <span>{topic.replies}</span>
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <Eye size={10.5} />
                          <span>{topic.views}</span>
                        </span>
                        <span className="inline-flex items-center gap-1 text-rose-400">
                          <Heart size={10} className="fill-rose-400/20 text-rose-400" />
                          <span>{topic.likes}</span>
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      )}

      {/* ======================= 知乎回答详情抽屉 (ZhihuAnswerPeek) ======================= */}
      {activeZhihuArticle && (
        <div
          className="absolute inset-0 z-50 flex flex-col justify-end bg-black/80 backdrop-blur-sm"
          onClick={() => setActiveZhihuArticle(null)}
        >
          <div
            className="max-h-[90%] w-full overflow-y-auto rounded-t-3xl border-t border-haze/60 bg-ink-raised p-4 space-y-3.5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-haze/40 pb-2.5">
              <span className="font-mono text-[10px] text-[#0066FF] font-semibold">知乎精选回答 · 站内全文</span>
              <button
                type="button"
                onClick={() => setActiveZhihuArticle(null)}
                className="rounded-full p-1 text-paper-muted hover:bg-paper/10"
              >
                <X size={16} />
              </button>
            </div>

            <h1 className="font-sans text-[17px] font-bold leading-snug text-paper">
              {activeZhihuArticle.title}
            </h1>

            {/* 作者信息栏 */}
            <div className="flex items-center justify-between text-[11.5px] border-b border-haze/30 pb-3">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#0066FF]/20 font-bold text-[#0066FF]">
                  {activeZhihuArticle.author[0]}
                </span>
                <div>
                  <div className="flex items-center gap-1">
                    <span className="font-semibold text-paper">{activeZhihuArticle.author}</span>
                    <CheckCircle2 size={12} className="text-[#0066FF]" />
                  </div>
                  <span className="font-mono text-[9px] text-paper-faint">{activeZhihuArticle.headline}</span>
                </div>
              </div>

              <div className="text-right font-mono text-[9px] text-paper-faint">
                <div>IP 属地：{activeZhihuArticle.ipLocation}</div>
                <div>{activeZhihuArticle.publishTime}</div>
              </div>
            </div>

            {/* 回答正文 */}
            <div className="space-y-2.5 text-[12.5px] leading-relaxed text-paper-muted">
              <p>{activeZhihuArticle.excerpt}</p>
              <p>
                在本地优先模型中，模型状态不仅保留在显存中，还可以通过端侧嵌入库直接沉淀到设备 SQLite
                。这意味着所有的个人讨论与收藏，不需要依赖云端平台做持久化映射，客户端直接掌控数据所有权。
              </p>
            </div>

            {/* 底部互动 */}
            <div className="flex items-center justify-between pt-2 border-t border-haze/40 font-mono text-[11px]">
              <button
                type="button"
                className="flex items-center gap-1.5 rounded-full bg-[#0066FF]/15 px-3 py-1 font-bold text-[#0066FF]"
              >
                <ThumbsUp size={12} />
                <span>赞同 {activeZhihuArticle.upvotes}</span>
              </button>
              <span className="text-paper-faint">{activeZhihuArticle.comments} 条讨论</span>
            </div>
          </div>
        </div>
      )}

      {/* ======================= LINUX DO 话题讨论抽屉 ======================= */}
      {activeLinuxDoTopic && (
        <div
          className="absolute inset-0 z-50 flex flex-col justify-end bg-black/80 backdrop-blur-sm"
          onClick={() => setActiveLinuxDoTopic(null)}
        >
          <div
            className="max-h-[90%] w-full overflow-y-auto rounded-t-3xl border-t border-haze/60 bg-ink-raised p-4 space-y-3.5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-haze/40 pb-2.5">
              <span className="font-mono text-[10px] text-cinnabar font-semibold">Discourse 论坛直连 · 楼层 #1</span>
              <button
                type="button"
                onClick={() => setActiveLinuxDoTopic(null)}
                className="rounded-full p-1 text-paper-muted hover:bg-paper/10"
              >
                <X size={16} />
              </button>
            </div>

            <h1 className="font-display text-[16px] font-bold leading-snug text-paper">
              {activeLinuxDoTopic.title}
            </h1>

            {/* 楼层楼主信息 */}
            <div className="flex items-center justify-between text-[11.5px] border-b border-haze/30 pb-3">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-[7px] bg-[#0088ff] font-mono font-bold text-white">
                  {activeLinuxDoTopic.author[0].toUpperCase()}
                </span>
                <div>
                  <div className="flex items-center gap-1">
                    <span className="font-bold text-[#0088ff]">{activeLinuxDoTopic.author}</span>
                    <Shield size={12} className="text-[#0088ff]" />
                    <span className="rounded bg-[#0088ff]/20 px-1 py-0.2 font-mono text-[8px] text-[#0088ff]">
                      站长
                    </span>
                  </div>
                  <span className="font-mono text-[9px] text-paper-faint">{activeLinuxDoTopic.time}</span>
                </div>
              </div>

              <div className="flex items-center gap-2 font-mono text-[10px] text-paper-faint">
                <span>💬 {activeLinuxDoTopic.replies} 回复</span>
                <span>👁 {activeLinuxDoTopic.views}</span>
              </div>
            </div>

            {/* 帖子正文 */}
            <div className="space-y-2.5 text-[12.5px] leading-relaxed text-paper-muted">
              <p>{activeLinuxDoTopic.content}</p>
            </div>

            {/* 楼层底部操作 */}
            <div className="flex items-center justify-between pt-2 border-t border-haze/40 font-mono text-[11px]">
              <button
                type="button"
                className="flex items-center gap-1.5 rounded-full bg-rose-500/15 px-3 py-1 font-bold text-rose-400"
              >
                <Heart size={12} className="fill-rose-400" />
                <span>点赞 {activeLinuxDoTopic.likes}</span>
              </button>
              <button
                type="button"
                className="rounded-full border border-haze px-3 py-1 text-paper-muted hover:text-paper"
              >
                查看全部楼层讨论
              </button>
            </div>
          </div>
        </div>
      )}

      <TabBar active="today" />
    </div>
  )
}
