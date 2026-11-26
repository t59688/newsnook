import { useState } from 'react'
import {
  ArrowLeft,
  ChevronDown,
  Clapperboard,
  Film,
  FolderOpen,
  LayoutGrid,
  List,
  Play,
  RotateCw,
  Search,
  Sparkles,
  Tv,
  X,
} from 'lucide-react'
import { ReaderDemo } from '../app/ReaderDemo'
import { Cover } from '../app/Cover'
import { PhoneStatusBar } from '../app/PhoneStatusBar'

interface VideoItem {
  id: string
  title: string
  category: '电影' | '电视剧' | '动漫' | '纪录片'
  score: string
  quality: string
  status: string
  director: string
  episodes: string[]
  synopsis: string
}

const VIDEO_LIST: VideoItem[] = [
  {
    id: 'vod-1',
    title: '星际边缘：奥德赛',
    category: '电影',
    score: '9.3',
    quality: '4K 蓝光',
    status: 'HD 原盘完结',
    director: '克里斯托弗 · 诺兰',
    episodes: ['正片 4K 原盘', '导演剪辑版', '幕后纪录片'],
    synopsis: '未来星际深空探测舰队遭遇微型黑洞扰动，人类最后的拓荒者在时空扭曲中寻找地外宜居带。',
  },
  {
    id: 'vod-2',
    title: '赛博纪元：深海网络',
    category: '电视剧',
    score: '8.9',
    quality: '1080P 60fps',
    status: '更新至第 16 集',
    director: '押井守',
    episodes: ['第 1 集', '第 2 集', '第 3 集', '第 4 集', '第 5 集', '第 6 集', '第 7 集', '第 8 集'],
    synopsis: '水下长距离海底光缆遭受未知自主演化病毒入侵，网络安全调查局介入深潜排障。',
  },
  {
    id: 'vod-3',
    title: '光年编年史',
    category: '动漫',
    score: '9.1',
    quality: '4K 杜比视界',
    status: '全 24 集',
    director: '新海诚',
    episodes: ['第 1 集', '第 2 集', '第 3 集', '第 4 集', '第 5 集'],
    synopsis: '跨越双星系统的少年与少女通过引力透镜脉冲通信，展开长达一个世纪的宏大相遇。',
  },
  {
    id: 'vod-4',
    title: '深空深渊：南极望远镜',
    category: '纪录片',
    score: '9.5',
    quality: '4K HDR',
    status: '全 4 集',
    director: 'BBC 自然历史部',
    episodes: ['第 1 集 冰封穹顶', '第 2 集 宇宙微波', '第 3 集 极夜守望', '第 4 集 恒星摇篮'],
    synopsis: '跟随南极点科研队，记录世界尽头最寒冷寂静处对宇宙创生第一缕引力波的捕获。',
  },
]

interface CmsArticle {
  id: string
  title: string
  category: string
  time: string
  readingTime: string
  summary: string
  author: string
}

const CMS_ARTICLES: CmsArticle[] = [
  {
    id: 'cms-1',
    title: 'Go 1.24 运行时调度器重构：从 GMP 到轻量状态空间调度',
    category: '系统架构',
    time: '2 小时前',
    readingTime: '8 分钟阅读',
    summary: '深入分析 Go 运行时在长连接高并发场景下的调度瓶颈与最新的优化实践。',
    author: '张立 · 架构师',
  },
  {
    id: 'cms-2',
    title: '本地优先软件工程架构：如何在断网状态下保证毫秒级响应',
    category: '分布式演进',
    time: '昨天',
    readingTime: '12 分钟阅读',
    summary: '从端侧持久化到影子比对队列，探讨生产级 Local-First 应用的设计哲学。',
    author: '李睿 · 全栈开发',
  },
  {
    id: 'cms-3',
    title: '十万并发长连接网关的高可用与容灾排障实录',
    category: '系统架构',
    time: '3 天前',
    readingTime: '15 分钟阅读',
    summary: '一次生产环境网关 CPU 突增的定位全过程与内核参数调优总结。',
    author: '陈林 · SRE 负责人',
  },
  {
    id: 'cms-4',
    title: '现代前端静态生成与增量水合的权衡之争',
    category: '长文深度',
    time: '上周',
    readingTime: '10 分钟阅读',
    summary: '从 SSR 到 SSG，再到 Islands 架构与全栈框架的生态演进。',
    author: '王薇 · 前端专家',
  },
]

const SITES = [
  {
    id: 'vod-maccms',
    name: '看看影院',
    engine: '苹果CMS v10 (MacCMS)',
    type: 'video' as const,
    count: 3820,
    url: 'qiyunzl.cn',
    desc: '自动嗅探 m3u8 原画流 · 原生海报墙与选集播放器',
  },
  {
    id: 'tech-wp',
    name: 'TechInsights 博客',
    engine: 'WordPress 6.5',
    type: 'blog' as const,
    count: 284,
    url: 'tech-insights.blog',
    desc: '全站专栏树与目录解析 · 站内全文纯净阅读',
  },
  {
    id: 'weekly-hugo',
    name: '开源技术周刊',
    engine: 'Hugo 静态引擎',
    type: 'blog' as const,
    count: 98,
    url: 'weekly.tech',
    desc: '文档树结构提取 · 毫秒级离线缓存',
  },
]

export function CmsScreenDemo() {
  const [selectedSite, setSelectedSite] = useState(SITES[0])
  const [activeCategory, setActiveCategory] = useState('全部')
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [siteSheetOpen, setSiteSheetOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [selectedVideo, setSelectedVideo] = useState<VideoItem | null>(null)
  const [selectedEpisode, setSelectedEpisode] = useState(0)
  const [openedArticle, setOpenedArticle] = useState<CmsArticle | null>(null)
  const [playingVideo, setPlayingVideo] = useState(false)

  const isVideoMode = selectedSite.type === 'video'
  const categories = isVideoMode
    ? ['全部', '电影', '电视剧', '动漫', '纪录片']
    : ['全部', '系统架构', '分布式演进', '长文深度']

  const handleRefresh = () => {
    setRefreshing(true)
    setTimeout(() => setRefreshing(false), 600)
  }

  if (openedArticle) {
    return (
      <div className="relative h-full flex flex-col bg-ink text-paper">
        <ReaderDemo
          article={{
            source: selectedSite.name,
            time: openedArticle.time,
            title: openedArticle.title,
            summary: openedArticle.summary,
          }}
          onClose={() => setOpenedArticle(null)}
        />
      </div>
    )
  }

  return (
    <div className="relative flex h-full flex-col bg-ink text-paper select-none">
      {/* 沉浸式紧凑顶部 Header (SiteScreen Header) */}
      <header className="sticky top-0 z-20 shrink-0 border-b border-haze/40 bg-ink/95 backdrop-blur-xl transition-colors">
        <PhoneStatusBar />
        <div className="page-x flex items-center justify-between gap-2 py-1">
          {/* 左侧：返回 */}
          <div className="flex shrink-0 items-center">
            <button
              type="button"
              aria-label="返回"
              className="flex h-7 w-7 items-center justify-center rounded-full text-paper-muted hover:bg-paper/8 hover:text-paper"
            >
              <ArrowLeft size={16} strokeWidth={2} />
            </button>
          </div>

          {/* 居中：核心站点切换器标题（点击呼出切换抽屉） */}
          <div className="flex min-w-0 flex-1 items-center justify-center">
            <button
              type="button"
              onClick={() => setSiteSheetOpen(true)}
              className="group inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-center hover:bg-paper/6 active:scale-95 transition-transform"
            >
              <span className="truncate font-display text-[14px] font-semibold text-paper group-hover:text-cinnabar transition-colors">
                {selectedSite.name}
              </span>
              <span className="shrink-0 text-paper-faint">
                <ChevronDown size={12} strokeWidth={2.2} />
              </span>
            </button>
          </div>

          {/* 右侧：操作区（搜索/网格切换/刷新） */}
          <div className="flex shrink-0 items-center gap-0.5 text-paper-muted">
            <button
              type="button"
              onClick={() => setSearchOpen(!searchOpen)}
              aria-label="站内检索"
              className={`flex h-7 w-7 items-center justify-center rounded-full transition-colors ${
                searchOpen ? 'bg-cinnabar/15 text-cinnabar' : 'hover:bg-paper/8 hover:text-paper'
              }`}
            >
              <Search size={14} strokeWidth={2} />
            </button>
            <button
              type="button"
              onClick={() => setViewMode(viewMode === 'grid' ? 'list' : 'grid')}
              aria-label="排版切换"
              className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-paper/8 hover:text-paper"
            >
              {viewMode === 'grid' ? <List size={14} strokeWidth={2} /> : <LayoutGrid size={14} strokeWidth={2} />}
            </button>
            <button
              type="button"
              onClick={handleRefresh}
              aria-label="刷新目录"
              className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-paper/8 hover:text-paper"
            >
              <RotateCw size={13} strokeWidth={2} className={refreshing ? 'animate-spin text-cinnabar' : ''} />
            </button>
          </div>
        </div>

        {/* 动态内嵌搜索栏 */}
        {searchOpen && (
          <div className="page-x pb-2 pt-0.5">
            <div className="flex items-center gap-2 rounded-xl border border-cinnabar/30 bg-ink-raised px-3 py-1.5 text-[12px]">
              <Search size={13} className="text-paper-faint" />
              <input
                type="text"
                placeholder={isVideoMode ? '在影视海报墙中搜索片名、导演、演员…' : '在已提取栏目目录中检索…'}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="min-w-0 flex-1 bg-transparent text-paper placeholder-paper-faint/60 outline-none"
              />
              {searchQuery && (
                <button type="button" onClick={() => setSearchQuery('')} className="text-paper-faint hover:text-paper">
                  <X size={12} />
                </button>
              )}
            </div>
          </div>
        )}

        {/* 框架识别诊断与能力指示条 */}
        <div className="flex items-center justify-between border-t border-haze/30 bg-ink-raised/40 px-3.5 py-1 font-mono text-[9.5px]">
          <span className="flex items-center gap-1.5 text-paper-muted">
            <Sparkles size={11} className="text-cinnabar" />
            <span>FrameworkDetect：</span>
            <span className="font-semibold text-cinnabar-soft">{selectedSite.engine}</span>
          </span>
          <span className="rounded bg-black/40 px-1.5 py-0.2 font-mono text-[9px] text-paper-faint">
            {isVideoMode ? '影视 APP 模式 · m3u8 自动嗅探' : '目录模式 · 站内全文就绪'}
          </span>
        </div>

        {/* 栏目分类横滑轨 (Category Rail) */}
        <div className="flex items-center gap-1.5 overflow-x-auto px-3 py-1.5 scrollbar-none border-t border-haze/20">
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setActiveCategory(cat)}
              className={`shrink-0 rounded-lg px-2.5 py-1 font-mono text-[11px] transition-colors ${
                activeCategory === cat
                  ? 'bg-paper text-ink font-bold shadow-xs'
                  : 'text-paper-muted hover:bg-paper/5 hover:text-paper'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </header>

      {/* 核心内容区 */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
        {isVideoMode ? (
          /* ================= 苹果CMS / 海洋CMS 影视海报墙模式 ================= */
          <div className="space-y-3">
            <div className="flex items-center justify-between font-mono text-[10px] text-paper-faint px-0.5">
              <span>已识别视频影视树 · 共 4 个精选流</span>
              <span className="text-[#38bdf8] font-bold">直连 InkVideoPlayer</span>
            </div>

            {viewMode === 'grid' ? (
              <div className="grid grid-cols-2 gap-2.5">
                {VIDEO_LIST.filter(
                  (v) =>
                    (activeCategory === '全部' || v.category === activeCategory) &&
                    (!searchQuery || v.title.includes(searchQuery) || v.director.includes(searchQuery)),
                ).map((video) => (
                  <button
                    key={video.id}
                    type="button"
                    onClick={() => {
                      setSelectedVideo(video)
                      setSelectedEpisode(0)
                      setPlayingVideo(false)
                    }}
                    className="group relative flex flex-col overflow-hidden rounded-xl border border-haze/60 bg-ink-raised/60 text-left transition-all hover:border-cinnabar/50 active:scale-[0.98]"
                  >
                    {/* 2:3 纵向海报封面（纯矢量，零破损，100% 离线就绪） */}
                    <div className="relative aspect-[2/3] w-full overflow-hidden bg-black">
                      <Cover
                        seed={video.id}
                        label={video.title}
                        aspect="poster"
                        className="h-full w-full"
                        subtitle={video.status}
                      />
                      {/* 豆瓣高分胶囊 */}
                      <div className="absolute top-2 right-2 rounded-md bg-black/75 px-1.5 py-0.5 font-mono text-[9px] font-black text-[#f59e0b] shadow-md backdrop-blur-md border border-[#f59e0b]/30">
                        ★ {video.score}
                      </div>
                      {/* 4K 蓝光角标 */}
                      <div className="absolute top-2 left-2 rounded-md bg-cinnabar/80 px-1.5 py-0.5 font-mono text-[8.5px] font-bold text-white shadow-md">
                        {video.quality}
                      </div>
                    </div>

                    {/* 海报底栏片名与状态 */}
                    <div className="p-2.5 space-y-1">
                      <h3 className="truncate font-display text-[13px] font-bold text-paper group-hover:text-cinnabar transition-colors">
                        {video.title}
                      </h3>
                      <div className="flex items-center justify-between font-mono text-[9px] text-paper-faint">
                        <span>{video.director}</span>
                        <span className="text-paper-muted">{video.status}</span>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              /* 影视列表模式 */
              <div className="space-y-2">
                {VIDEO_LIST.map((video) => (
                  <button
                    key={video.id}
                    type="button"
                    onClick={() => {
                      setSelectedVideo(video)
                      setSelectedEpisode(0)
                      setPlayingVideo(false)
                    }}
                    className="flex w-full items-center gap-3 rounded-xl border border-haze/60 bg-ink-raised/50 p-2 text-left transition-colors hover:border-cinnabar/50"
                  >
                    <div className="h-16 w-12 shrink-0 overflow-hidden rounded-lg bg-black">
                      <Cover seed={video.id} label={video.title} aspect="poster" className="h-full w-full" />
                    </div>
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center justify-between font-mono text-[9px]">
                        <span className="rounded bg-cinnabar/15 px-1 py-0.2 font-bold text-cinnabar-soft">
                          {video.quality}
                        </span>
                        <span className="font-bold text-[#f59e0b]">★ {video.score}</span>
                      </div>
                      <h3 className="truncate font-display text-[13px] font-medium text-paper">{video.title}</h3>
                      <p className="truncate font-mono text-[9px] text-paper-faint">{video.synopsis}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          /* ================= WordPress / Hugo 博客文章目录模式 ================= */
          <div className="space-y-2.5">
            <div className="flex items-center justify-between font-mono text-[10px] text-paper-faint px-0.5">
              <span>已解析全站专栏树 · 共 12 栏目 284 篇</span>
              <span className="text-cinnabar-soft font-bold">站内全文就绪</span>
            </div>

            {CMS_ARTICLES.filter(
              (a) =>
                (activeCategory === '全部' || a.category === activeCategory) &&
                (!searchQuery || a.title.includes(searchQuery) || a.summary.includes(searchQuery)),
            ).map((article) => (
              <button
                key={article.id}
                type="button"
                onClick={() => setOpenedArticle(article)}
                className="group flex w-full items-center gap-3 rounded-xl border border-haze/60 bg-ink-raised/50 p-2.5 text-left transition-colors hover:border-cinnabar/40"
              >
                <div className="h-14 w-20 shrink-0 overflow-hidden rounded-lg bg-ink border border-haze/60">
                  <Cover seed={article.id} label={article.category} aspect="standard" className="h-full w-full" />
                </div>
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center justify-between font-mono text-[9px] text-paper-faint">
                    <span className="rounded bg-ink px-1.5 py-0.2 text-cinnabar-soft font-bold border border-haze/60">
                      {article.category}
                    </span>
                    <span>{article.time}</span>
                  </div>
                  <h3 className="truncate font-display text-[13px] font-medium text-paper group-hover:text-cinnabar transition-colors">
                    {article.title}
                  </h3>
                  <div className="flex items-center justify-between font-mono text-[8.5px] text-paper-faint">
                    <span>{article.author}</span>
                    <span className="text-cinnabar-soft">一键站内阅读 &gt;</span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 影视详情与选集抽屉 (Film Details & Episode Modal) */}
      {selectedVideo && (
        <div
          className="absolute inset-0 z-40 flex flex-col justify-end bg-black/80 backdrop-blur-sm"
          onClick={() => setSelectedVideo(null)}
        >
          <div
            className="max-h-[85%] w-full overflow-y-auto rounded-t-3xl border-t border-haze/60 bg-ink-raised p-4 space-y-3.5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 顶栏控制 */}
            <div className="flex items-center justify-between border-b border-haze/40 pb-2.5">
              <div className="flex items-center gap-2">
                <Film size={16} className="text-cinnabar" />
                <h2 className="font-display text-[15px] font-bold text-paper">{selectedVideo.title}</h2>
              </div>
              <button
                type="button"
                onClick={() => setSelectedVideo(null)}
                className="rounded-full p-1 text-paper-muted hover:bg-paper/10"
              >
                <X size={16} />
              </button>
            </div>

            {/* 视频内联播放器区域 */}
            <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-haze/60 bg-black">
              <Cover
                seed={`player-${selectedVideo.id}`}
                label={selectedVideo.title}
                aspect="video"
                className="h-full w-full opacity-80"
                subtitle={`正在播放：${selectedVideo.episodes[selectedEpisode]} · 1080P m3u8`}
              />
              <button
                type="button"
                onClick={() => setPlayingVideo(!playingVideo)}
                className="absolute inset-0 m-auto flex h-12 w-12 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-md hover:scale-105 transition-transform"
              >
                {playingVideo ? <Tv size={20} className="text-cinnabar" /> : <Play size={20} className="ml-0.5" />}
              </button>
              <div className="absolute bottom-2 left-2 flex items-center gap-1.5 font-mono text-[9px] text-white/90 bg-black/60 px-2 py-0.5 rounded-full">
                <span className="h-1.5 w-1.5 rounded-full bg-cinnabar animate-pulse" />
                <span>原生播放器已装载 · 02:45 / 45:00</span>
              </div>
            </div>

            {/* 影片元数据 */}
            <div className="space-y-1 text-[11px] text-paper-muted">
              <div className="flex items-center gap-2">
                <span className="rounded bg-cinnabar/20 px-1.5 py-0.2 font-mono text-[9px] font-bold text-cinnabar-soft">
                  {selectedVideo.quality}
                </span>
                <span className="font-bold text-[#f59e0b]">豆瓣 ★ {selectedVideo.score}</span>
                <span>·</span>
                <span>导演：{selectedVideo.director}</span>
              </div>
              <p className="leading-relaxed text-paper-faint">{selectedVideo.synopsis}</p>
            </div>

            {/* 剧集选集栏 */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between font-mono text-[10px] text-paper-faint">
                <span>选集播放（共 {selectedVideo.episodes.length} 集）</span>
                <span className="text-[#38bdf8]">m3u8 直连就绪</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {selectedVideo.episodes.map((ep, idx) => (
                  <button
                    key={ep}
                    type="button"
                    onClick={() => {
                      setSelectedEpisode(idx)
                      setPlayingVideo(true)
                    }}
                    className={`rounded-lg px-3 py-1.5 font-mono text-[11px] font-semibold transition-colors ${
                      selectedEpisode === idx
                        ? 'bg-cinnabar text-white shadow-xs'
                        : 'border border-haze bg-ink text-paper hover:border-cinnabar/40'
                    }`}
                  >
                    {ep}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 站点切换抽屉 (Site Picker Sheet) */}
      {siteSheetOpen && (
        <div
          className="absolute inset-0 z-40 flex flex-col justify-end bg-black/75 backdrop-blur-xs"
          onClick={() => setSiteSheetOpen(false)}
        >
          <div
            className="w-full rounded-t-3xl border-t border-haze/60 bg-ink-raised p-4 space-y-2.5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-haze/40 pb-2">
              <h3 className="font-display text-[14px] font-bold text-paper">切换站点与 CMS 引擎</h3>
              <button
                type="button"
                onClick={() => setSiteSheetOpen(false)}
                className="text-paper-muted hover:text-paper"
              >
                <X size={16} />
              </button>
            </div>

            <div className="space-y-1.5">
              {SITES.map((site) => (
                <button
                  key={site.id}
                  type="button"
                  onClick={() => {
                    setSelectedSite(site)
                    setActiveCategory('全部')
                    setSiteSheetOpen(false)
                  }}
                  className={`flex w-full items-center justify-between rounded-xl border p-2.5 text-left transition-colors ${
                    selectedSite.id === site.id
                      ? 'border-cinnabar bg-cinnabar/10 text-paper'
                      : 'border-haze bg-ink text-paper-muted hover:border-paper/20 hover:text-paper'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {site.type === 'video' ? (
                        <Clapperboard size={14} className="text-cinnabar" />
                      ) : (
                        <FolderOpen size={14} className="text-paper-faint" />
                      )}
                      <span className="font-display text-[13px] font-semibold text-paper">{site.name}</span>
                    </div>
                    <p className="mt-0.5 truncate font-mono text-[9px] text-paper-faint">{site.desc}</p>
                  </div>
                  <span className="rounded-md bg-paper/10 px-1.5 py-0.5 font-mono text-[9px] font-bold text-paper">
                    {site.engine}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
