import { useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import {
  Bookmark,
  Flame,
  Globe,
  Headphones,
  Home,
  Maximize2,
  Pause,
  Play,
  ScrollText,
  Search as SearchIcon,
  ShieldCheck,
  Sparkles,
  Tv,
  X,
  Zap,
} from 'lucide-react'

/* 「核心能力与专属工作区」全景互动矩阵：
 * 每一个卡片均严格对应源码中真实存在的模块与功能，无任何虚构与遗漏。 */

function Cell({
  title,
  badge,
  note,
  featured = false,
  children,
}: {
  title: string
  badge?: string
  note: string
  featured?: boolean
  children: React.ReactNode
}) {
  return (
    <div
      className={`group flex flex-col overflow-hidden rounded-2xl border border-haze bg-ink-raised/40 transition-all duration-300 hover:border-paper-faint/50 hover:bg-ink-raised/60 hover:shadow-lg ${
        featured ? 'sm:col-span-2 lg:col-span-2' : ''
      }`}
    >
      <div className="flex items-center justify-between gap-2 border-b border-haze/60 bg-ink-raised/60 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] font-bold tracking-[0.14em] text-cinnabar-soft">
            {title}
          </span>
          {badge && (
            <span className="rounded-full bg-cinnabar/15 px-1.5 py-0.2 font-mono text-[8.5px] font-semibold text-cinnabar-soft">
              {badge}
            </span>
          )}
        </div>
        <span className="font-mono text-[9.5px] tracking-[0.06em] text-paper-faint">{note}</span>
      </div>
      <div className="min-h-0 flex-1 p-4 flex flex-col justify-between">{children}</div>
    </div>
  )
}

// 1. TTS 语音朗读 (src/features/readAloud)
export function ReadAloudDemo() {
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState('1.0x')
  const [activePara, setActivePara] = useState(1)

  return (
    <Cell title="TTS 语音朗读" badge="听书模式" note="AI / 系统原生 · 锁屏可控" featured>
      <div className="space-y-3">
        <div className="rounded-xl border border-haze/70 bg-ink p-3 space-y-2 text-[12px]">
          <div
            onClick={() => setActivePara(0)}
            className={`cursor-pointer rounded p-1.5 transition-colors ${
              activePara === 0 ? 'bg-cinnabar/15 text-paper border-l-2 border-cinnabar' : 'text-paper-muted'
            }`}
          >
            十年前的冬天，陈礼明从东莞回到湖南老家时，县城能提供的岗位只有两种：工地，或者开车。
          </div>
          <div
            onClick={() => setActivePara(1)}
            className={`cursor-pointer rounded p-1.5 transition-colors ${
              activePara === 1 ? 'bg-cinnabar/15 text-paper border-l-2 border-cinnabar font-medium' : 'text-paper-muted'
            }`}
          >
            变化是从第三年开始的。先是食品加工厂搬进了开发区，然后是做小家电出口的工厂也来了。
          </div>
        </div>

        {/* 悬浮播控条 */}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-cinnabar/30 bg-cinnabar/10 p-2.5">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPlaying(!playing)}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-cinnabar text-ink font-bold shadow-sm"
            >
              {playing ? <Pause size={13} /> : <Play size={13} className="ml-0.5" />}
            </button>
            <div>
              <div className="font-mono text-[11px] font-bold text-paper flex items-center gap-1.5">
                <Headphones size={12} className="text-cinnabar" />
                <span>{playing ? '正在后台语音朗读…' : '已暂停'}</span>
              </div>
              <div className="font-mono text-[9px] text-paper-faint">
                MediaSession 系统级后台播放 · 拔耳机自动暂停
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1 font-mono text-[10px]">
            {['0.8x', '1.0x', '1.25x', '1.5x'].map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSpeed(s)}
                className={`rounded px-1.5 py-0.5 ${
                  speed === s ? 'bg-cinnabar text-ink font-bold' : 'text-paper-muted hover:text-paper'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>
      <p className="mt-3 font-mono text-[9.5px] text-paper-faint text-center">
        支持 Android 系统 TTS、AI TTS 与 Web Speech API · 跟随段落高亮
      </p>
    </Cell>
  )
}

// 2. AI 智能速读 (src/features/speedRead)
export function SpeedReadDemo() {
  const [streamed, setStreamed] = useState(true)

  return (
    <Cell title="AI 智能速读" badge="长文速览" note="流式提炼 · 观点论据" featured>
      <div className="space-y-3">
        <div className="flex items-center justify-between text-[11px] font-mono text-paper-faint">
          <span className="flex items-center gap-1 text-cinnabar-soft">
            <Sparkles size={12} />
            <span>AI 深度速读模型：提取结构化知识</span>
          </span>
          <button
            type="button"
            onClick={() => setStreamed(!streamed)}
            className="rounded border border-haze px-2 py-0.5 text-paper-muted hover:text-paper"
          >
            {streamed ? '重新流式生成' : '查看完整结构'}
          </button>
        </div>

        <div className="rounded-xl border border-haze bg-ink p-3 space-y-2 text-[12px]">
          <div className="font-mono text-[10px] text-cinnabar-soft font-bold flex items-center gap-1">
            <Zap size={11} /> 💡 核心观点
          </div>
          <p className="text-paper/90 leading-relaxed pl-3 border-l border-cinnabar/40">
            中西部县城就业生态正由“单向劳动力流出”转变为“就地产业承接”，产业转移的微观载体是具体的家庭去留抉择。
          </p>

          <div className="font-mono text-[10px] text-cinnabar-soft font-bold flex items-center gap-1 pt-1">
            <ScrollText size={11} /> 🔍 关键论据
          </div>
          <ul className="text-paper-muted space-y-1 pl-3 text-[11px]">
            <li>1. 跟踪 47 位返乡样本，本地就业平均薪资已达沿海同岗位 75% 且生活成本降低 40%。</li>
            <li>2. 小家电与跨境电商仓储下沉，形成 15 分钟通勤圈。</li>
          </ul>
        </div>
      </div>
      <p className="mt-3 font-mono text-[9.5px] text-paper-faint text-center">
        支持本地端侧模型与云端 API · 外刊长文与专业论文秒出摘要
      </p>
    </Cell>
  )
}

// 3. 视频悬浮窗 (src/features/floatingVideo)
export function FloatingVideoDemo() {
  const [pipExpanded, setPipExpanded] = useState(false)
  const [playing, setPlaying] = useState(true)

  return (
    <Cell title="悬浮播放" badge="画中画" note="切页不中断 · 原生隔离">
      <div className="relative flex flex-col items-center">
        <div className="w-full overflow-hidden rounded-xl border border-haze bg-ink-deep shadow-lg">
          <div className="flex items-center justify-between bg-ink-raised px-2.5 py-1.5 border-b border-haze/60">
            <span className="font-mono text-[9.5px] text-paper-muted truncate">
              BBC 特别纪录片 · 悬浮小窗
            </span>
            <div className="flex items-center gap-1 text-paper-faint">
              <button
                type="button"
                onClick={() => setPipExpanded(!pipExpanded)}
                className="hover:text-paper"
              >
                <Maximize2 size={11} />
              </button>
              <button type="button" className="hover:text-paper">
                <X size={11} />
              </button>
            </div>
          </div>
          <div
            className={`relative flex items-center justify-center bg-black/80 transition-all duration-300 ${
              pipExpanded ? 'h-36' : 'h-24'
            }`}
          >
            <div className="absolute inset-0 bg-gradient-to-tr from-cinnabar/20 to-transparent opacity-40" />
            <button
              type="button"
              onClick={() => setPlaying(!playing)}
              className="relative flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm hover:scale-105"
            >
              {playing ? <Pause size={13} /> : <Play size={13} className="ml-0.5" />}
            </button>
            <span className="absolute bottom-1 right-1 rounded bg-black/60 px-1 py-0.5 font-mono text-[8px] text-white/80">
              1080P · 02:40
            </span>
          </div>
          <div className="h-1 bg-paper/10">
            <div className="h-full w-[45%] bg-cinnabar" />
          </div>
        </div>
      </div>
      <p className="mt-2 text-center font-mono text-[9.5px] text-paper-faint">
        拖动标题栏任意移动 · 切至主页/设置/阅读器播放持续不断
      </p>
    </Cell>
  )
}

// 4. 智能媒体嗅探 (src/features/mediaSniffer)
export function MediaSnifferDemo() {
  return (
    <Cell title="媒体资源嗅探" badge="蓝光提取" note="mp4 · m3u8 · 音频">
      <div className="space-y-2">
        <div className="flex items-center justify-between text-[11px] font-mono text-paper-muted">
          <span>页面流探测器：</span>
          <span className="text-cinnabar-soft font-bold">2 条媒体源</span>
        </div>

        <div className="rounded-xl border border-cinnabar/30 bg-ink p-2.5 space-y-1.5 font-mono text-[10px]">
          <div className="flex items-center justify-between">
            <span className="text-paper font-semibold">1080P H.264 (m3u8 直链)</span>
            <span className="text-cinnabar-soft">已捕获</span>
          </div>
          <div className="text-[9px] text-paper-faint truncate">
            https://video.thepaper.cn/stream/2026/h264_1080p.m3u8
          </div>
          <div className="flex gap-1.5 pt-1">
            <button className="flex-1 rounded bg-cinnabar/20 py-1 text-cinnabar-soft font-bold text-center">
              浮窗播放
            </button>
            <button className="flex-1 rounded border border-haze py-1 text-paper-muted text-center hover:text-paper">
              无线投屏
            </button>
          </div>
        </div>
      </div>
      <p className="mt-2 text-center font-mono text-[9.5px] text-paper-faint">
        突破网页播放器限制 · 自动注入 Origin Headers · 蓝光免广告播放
      </p>
    </Cell>
  )
}

// 5. 无线大屏投屏 (src/features/cast)
export function CastDemo() {
  const [target, setTarget] = useState('客厅电视 (LG webOS)')

  return (
    <Cell title="无线大屏投屏" badge="DLNA / UPnP" note="一键送大屏">
      <div className="space-y-2 font-mono text-[11px]">
        <div className="flex items-center gap-1.5 text-cinnabar-soft text-[10px]">
          <Tv size={13} />
          <span>局域网投屏设备发现：</span>
        </div>
        <div className="space-y-1.5">
          {['客厅电视 (LG webOS)', '卧室激光投影 (DLNA)'].map((dev) => (
            <button
              key={dev}
              type="button"
              onClick={() => setTarget(dev)}
              className={`flex w-full items-center justify-between rounded-xl border p-2 text-left transition-colors ${
                target === dev ? 'border-cinnabar bg-cinnabar/15 text-paper' : 'border-haze bg-ink text-paper-muted'
              }`}
            >
              <span>{dev}</span>
              {target === dev ? (
                <span className="text-[9px] font-bold text-cinnabar-soft">● 正在串流</span>
              ) : (
                <span className="text-[9px] text-paper-faint">待命</span>
              )}
            </button>
          ))}
        </div>
      </div>
      <p className="mt-2 text-center font-mono text-[9.5px] text-paper-faint">
        手机充当遥控器 · 音频与视频无缝隔空投放
      </p>
    </Cell>
  )
}

// 6. 离线智能预存 (src/features/prestore)
export function PrestoreDemo() {
  const [wifiOnly, setWifiOnly] = useState(true)

  return (
    <Cell title="智能离线预存" badge="零网秒开" note="正文+高清图预缓存">
      <div className="space-y-2.5 font-mono text-[11px]">
        <div className="flex items-center justify-between">
          <span className="text-paper">预存状态：</span>
          <span className="text-cinnabar-soft font-bold">已预存 38 篇正文</span>
        </div>
        <div className="h-2 rounded-full bg-paper/10 overflow-hidden">
          <div className="h-full w-[76%] bg-cinnabar rounded-full" />
        </div>
        <div className="flex justify-between text-[9px] text-paper-faint">
          <span>存储预算: 3.2MB / 5.0MB</span>
          <span>智能滚动置换</span>
        </div>
        <div className="flex items-center justify-between pt-1 border-t border-haze/40 text-[10px]">
          <span className="text-paper-muted">仅在 Wi-Fi 下自动预抓</span>
          <button
            type="button"
            onClick={() => setWifiOnly(!wifiOnly)}
            className={`rounded-full px-2 py-0.5 text-[9px] ${
              wifiOnly ? 'bg-cinnabar text-ink font-bold' : 'border border-haze text-paper-faint'
            }`}
          >
            {wifiOnly ? '已启用' : '关闭'}
          </button>
        </div>
      </div>
      <p className="mt-2 text-center font-mono text-[9.5px] text-paper-faint">
        地铁/高铁/飞机离线无缝阅读 · 图片自动 WebP 压缩持久化
      </p>
    </Cell>
  )
}

// 7. LINUX DO 社区专属工作区 (src/features/linuxdo)
export function LinuxDoDemo() {
  const [tab, setTab] = useState('最新')

  return (
    <Cell title="LINUX DO 工作区" badge="专属社区" note="Discourse 直连 · 沉浸阅读">
      <div className="space-y-2">
        <div className="flex gap-1 font-mono text-[10px]">
          {['最新', '热议', '开发', '福利'].map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-lg px-2 py-0.5 ${
                tab === t ? 'bg-paper text-ink font-bold' : 'border border-haze text-paper-muted'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="rounded-xl border border-haze bg-ink p-2.5 space-y-1.5 text-[11.5px]">
          <div className="flex items-center gap-1.5 font-mono text-[9px] text-paper-faint">
            <span className="text-cinnabar-soft">开发调优</span>
            <span>·</span>
            <span>始皇 👑</span>
            <span>·</span>
            <span>10 分钟前</span>
          </div>
          <div className="text-paper font-medium line-clamp-2">
            关于提高客户端连接并发与会话保活协议的最佳实践总结
          </div>
          <div className="flex items-center justify-between font-mono text-[9px] text-paper-faint pt-1">
            <span>回复 128 · 浏览 4.2k</span>
            <span className="text-cinnabar-soft">位置记忆</span>
          </div>
        </div>
      </div>
      <p className="mt-2 text-center font-mono text-[9.5px] text-paper-faint">
        独立工作区隔离 · 论坛楼层排版优化 · 私信与未读通知
      </p>
    </Cell>
  )
}

// 8. 知乎深度工作区 (src/features/zhihu)
export function ZhihuDemo() {
  const [tab, setTab] = useState('热榜')
  const tabs = [
    { key: '热榜', Icon: Flame },
    { key: '回答', Icon: Home },
    { key: '想法', Icon: Sparkles },
    { key: '我的', Icon: Bookmark },
  ]
  return (
    <Cell title="知乎工作区" badge="独立会话" note="热榜 · 精选回答 · AI 速读">
      <div className="space-y-2">
        <div className="rounded-xl border border-haze/60 bg-ink p-2.5">
          <div className="flex items-center justify-between font-mono text-[9px]">
            <span className="text-cinnabar-soft font-bold flex items-center gap-1">
              <Flame size={10} /> 热榜第 1 名 · 3.2 万赞同
            </span>
            <span className="text-paper-faint">知乎精选</span>
          </div>
          <p className="mt-1 line-clamp-2 text-[12px] leading-snug text-paper">
            如何评价国产大模型在长文本上的进步？分水岭在工程化记忆。
          </p>
          <span className="mt-1.5 inline-flex items-center gap-1 rounded bg-cinnabar/15 px-1.5 py-0.5 font-mono text-[8.5px] text-cinnabar-soft">
            <ScrollText size={9} /> AI 速读 · 核心观点已提炼
          </span>
        </div>
        <div className="flex justify-between rounded-xl border border-haze/60 bg-ink-raised/50 px-2 py-1">
          {tabs.map(({ key, Icon }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex items-center gap-1 px-1.5 py-0.5 font-mono text-[9px] ${
                tab === key ? 'text-cinnabar font-bold' : 'text-paper-faint'
              }`}
            >
              <Icon size={11} />
              {key}
            </button>
          ))}
        </div>
      </div>
      <p className="mt-2 text-center font-mono text-[9.5px] text-paper-faint">
        本地个性化打散重排 · 独立账号会话隔离 · 绝不污染主新闻流
      </p>
    </Cell>
  )
}

// 9. 网页目录与 CMS 智能解析 (src/features/siteCatalog & frameworkDetect)
export function SiteCatalogDemo() {
  const [framework, setFramework] = useState('WordPress 6.5')

  return (
    <Cell title="网页目录 / CMS 抓取" badge="无需 RSS" note="WordPress · Ghost · Hugo">
      <div className="space-y-2 font-mono text-[11px]">
        <div className="rounded-xl border border-cinnabar/30 bg-cinnabar/10 p-2.5">
          <div className="flex items-center justify-between text-[10px] text-cinnabar-soft">
            <span className="font-bold">FrameworkDetect 自动识别</span>
            <span>200 OK</span>
          </div>
          <div className="text-paper mt-1 font-bold">目标站点: {framework}</div>
          <div className="text-[9.5px] text-paper-muted mt-0.5">
            ✓ 自动构建栏目索引树 · 提取 18 个分类共 320 篇全文
          </div>
        </div>
        <div className="flex gap-1 text-[9px]">
          {['WordPress', 'Typecho', 'Hugo', 'Ghost', 'Hexo'].map((f) => (
            <button
              key={f}
              onClick={() => setFramework(`${f} 站点`)}
              className="flex-1 rounded border border-haze bg-ink py-1 text-center text-paper-muted hover:text-paper"
            >
              {f}
            </button>
          ))}
        </div>
      </div>
      <p className="mt-2 text-center font-mono text-[9.5px] text-paper-faint">
        任何博客与新闻网即使不提供 RSS，也能一键转成站内原生流
      </p>
    </Cell>
  )
}

// 10. 划词百科 (src/features/wiki)
export function WikiDemo() {
  return (
    <Cell title="划词百科" badge="长按即查" note="百度百科 · 中文维基">
      <div className="space-y-2">
        <p className="text-[12px] leading-relaxed text-paper-muted">
          …这次实验的关键在于
          <span className="rounded bg-cinnabar/20 px-1 py-0.5 text-paper font-semibold border border-cinnabar/40">
            约瑟夫森效应
          </span>
          ，它让超导库珀对隧穿…
        </p>
        <div className="rounded-xl border border-haze bg-ink p-2.5">
          <div className="flex items-center justify-between">
            <span className="font-display font-bold text-[13px] text-paper">约瑟夫森效应</span>
            <span className="font-mono text-[8.5px] text-paper-faint">百度百科 / 维基百科</span>
          </div>
          <p className="mt-1 line-clamp-2 text-[10.5px] leading-snug text-paper-muted">
            弱连接超导体间即使无电压也有超导电流流过（直流效应），加电压则产生高频振荡…
          </p>
          <div className="mt-1.5 flex justify-between border-t border-haze/50 pt-1 font-mono text-[9px] text-paper-faint">
            <span>发现者: B. D. Josephson</span>
            <span>1973 诺贝尔物理学奖</span>
          </div>
        </div>
      </div>
      <p className="mt-2 text-center font-mono text-[9.5px] text-paper-faint">
        Android 原生安全容器展示 · 遇生僻词与专有名词随时查阅
      </p>
    </Cell>
  )
}

// 11. 跟贴互动 (src/features/comments)
export function CommentsDemo() {
  const [tab, setTab] = useState('热评')
  return (
    <Cell title="多源跟贴" badge="原汁原味" note="网易 · 东财 · Hacker News">
      <div className="space-y-2">
        <div className="flex gap-1">
          {['热评', '最新', '长评'].map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-full px-2 py-0.5 font-mono text-[9.5px] ${
                tab === t ? 'bg-paper text-ink font-bold' : 'border border-haze text-paper-muted'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="rounded-xl border border-haze/60 bg-ink p-2 space-y-1">
          <div className="flex items-center justify-between font-mono text-[9px] text-paper-faint">
            <span className="text-paper-muted font-medium">山月不知心里事 (江苏)</span>
            <span className="flex items-center gap-0.5 text-cinnabar-soft font-bold">
              <Flame size={9} /> 482 顶
            </span>
          </div>
          <p className="text-[11px] text-paper/90 line-clamp-2">
            终于有人把返乡讲清楚了。小县城生活节奏慢，工作搬过来之后幸福感提升显著。
          </p>
        </div>
      </div>
      <p className="mt-2 text-center font-mono text-[9.5px] text-paper-faint">
        纯净跟贴抽屉 · 支持点赞排序与长评筛选
      </p>
    </Cell>
  )
}

// 12. 零服务端自解释短链 (lib/shareToken.ts)
export function ShareDemo() {
  return (
    <Cell title="零服务端分享" badge="自解释 Token" note="v2 压缩算法 · 隐私安全">
      <div className="space-y-2">
        <div className="rounded-xl border border-cinnabar/30 bg-ink p-2.5 space-y-1.5">
          <div className="flex items-center gap-1.5 font-mono text-[9px] text-paper-faint">
            <span className="text-cinnabar-soft font-bold">澎湃·特稿</span>
            <span>· 2 小时前</span>
          </div>
          <div className="font-display text-[12.5px] font-bold text-paper line-clamp-1">
            回到县城的人们：一份持续十年的中部就业观察
          </div>
          <div className="flex items-center justify-between border-t border-haze/50 pt-1.5 font-mono text-[9px]">
            <span className="text-paper-muted">news.aizeek.com/a/8fQ2xK</span>
            <span className="text-cinnabar-soft">微信/TG 抓出 OG 富卡片</span>
          </div>
        </div>
      </div>
      <p className="mt-2 text-center font-mono text-[9.5px] text-paper-faint">
        无需任何中心数据库 · Token 自身包含原文与信源 · 对方秒开站内全文
      </p>
    </Cell>
  )
}

// 13. 智能代理与流量分流 (src/features/proxy)
export function ProxyDemo() {
  const [mode, setMode] = useState('智能分流')
  return (
    <Cell title="智能分流代理" badge="SOCKS5 / HTTP" note="42+ 直连规则 · 测速">
      <div className="space-y-2">
        <div className="flex rounded-xl border border-haze bg-ink-raised/50 p-1">
          {['智能分流', '全局代理', '直连'].map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`flex-1 rounded-lg py-1 text-[11px] font-mono font-medium transition-colors ${
                mode === m ? 'bg-paper text-ink font-bold' : 'text-paper-muted'
              }`}
            >
              {m}
            </button>
          ))}
        </div>
        <ul className="space-y-1 font-mono text-[9.5px] text-paper-faint">
          <li className="flex justify-between">
            <span>海外信源 (BBC/Reuters/HN)</span>
            <span className="text-cinnabar-soft font-bold">走代理隧道 · 68ms</span>
          </li>
          <li className="flex justify-between">
            <span>国内信源 (澎湃/见闻/晚点)</span>
            <span className="text-paper-muted font-bold">直连 · 18ms</span>
          </li>
        </ul>
      </div>
      <p className="mt-2 text-center font-mono text-[9.5px] text-paper-faint">
        CapacitorHttp 原生网络栈 · 支持用户自定义代理服务器凭据
      </p>
    </Cell>
  )
}

// 14. 阅读足迹与进度历史 (src/features/readingHistory & readingPosition)
export function ReadingHistoryDemo() {
  return (
    <Cell title="阅读足迹与历史" badge="毫秒级记忆" note="时长统计 · 滚动/分页互折">
      <div className="space-y-2 font-mono text-[11px]">
        <div className="grid grid-cols-2 gap-2 text-center">
          <div className="rounded-xl border border-haze bg-ink p-2">
            <div className="text-[16px] font-bold text-cinnabar-soft">42 分钟</div>
            <div className="text-[9px] text-paper-faint">今日专注阅读</div>
          </div>
          <div className="rounded-xl border border-haze bg-ink p-2">
            <div className="text-[16px] font-bold text-paper">6 篇</div>
            <div className="text-[9px] text-paper-faint">今日完读文章</div>
          </div>
        </div>
        <div className="flex items-center justify-between text-[9.5px] text-paper-muted border-t border-haze/40 pt-1">
          <span>阅读位置无损映射</span>
          <span className="text-cinnabar-soft">滚动 68% ⇄ 墨水屏第 3 页</span>
        </div>
      </div>
      <p className="mt-2 text-center font-mono text-[9.5px] text-paper-faint">
        阅读进度无论在正常长滚动还是墨水屏分页翻页间切换，一律分毫不差
      </p>
    </Cell>
  )
}

// 15. 本地配置备份 (lib/backup.ts)
export function BackupDemo() {
  return (
    <Cell title="全量配置备份" badge="零云依赖" note="本地 JSON · 导入导出">
      <div className="space-y-1.5 font-mono text-[10px]">
        <div className="rounded-xl border border-haze bg-ink p-2 space-y-1">
          <div className="flex justify-between text-paper font-semibold">
            <span>newsnook-backup-20261105.json</span>
            <span className="text-cinnabar-soft">148 KB</span>
          </div>
          <div className="text-[9px] text-paper-faint">
            包含: 8 套预设、自建 RSS 订阅、分类顺序、启用开关、稍后读
          </div>
        </div>
        <div className="flex gap-1.5 pt-0.5">
          <button className="flex-1 rounded-lg border border-cinnabar bg-cinnabar/15 py-1 text-center font-bold text-cinnabar-soft">
            导出备份文件
          </button>
          <button className="flex-1 rounded-lg border border-haze bg-ink-raised py-1 text-center text-paper-muted hover:text-paper">
            恢复本地备份
          </button>
        </div>
      </div>
      <p className="mt-2 text-center font-mono text-[9.5px] text-paper-faint">
        无需登录账户 · 随时导出本地文件在任意设备无损还原
      </p>
    </Cell>
  )
}

// 16. 本地离线搜索 (lib/localSearch.ts)
export function SearchDemo() {
  const [keyword, setKeyword] = useState('产业转移')

  return (
    <Cell title="本地离线搜索" badge="毫秒直出" note="零网络 · 标题正文双搜">
      <div className="space-y-2">
        <label className="flex items-center gap-1.5 rounded-xl border border-haze bg-ink px-2.5 py-1.5 text-[11px] focus-within:border-cinnabar/60">
          <SearchIcon size={12} className="text-paper-faint" />
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            className="flex-1 bg-transparent font-mono text-paper outline-none"
            placeholder="搜已缓存标题与正文…"
          />
        </label>
        <div className="rounded-xl border border-haze bg-ink p-2 font-mono text-[10.5px]">
          <span className="text-[9px] text-cinnabar-soft font-bold">12 条命中记录：</span>
          <div className="text-paper line-clamp-1 mt-0.5">
            回到县城的人们：关于<span className="bg-cinnabar/25 text-paper font-bold px-0.5">产业转移</span>的十年观察
          </div>
        </div>
      </div>
      <p className="mt-2 text-center font-mono text-[9.5px] text-paper-faint">
        对手机中已缓存的全部信源列表与文章秒速全文检索
      </p>
    </Cell>
  )
}

// 17. 增量更新 (src/features/appUpdate)
export function UpdateDemo() {
  return (
    <Cell title="应用增量更新" badge="GDIFF 差分" note="SHA-256 · 极小补丁">
      <div className="space-y-2 font-mono text-[10.5px]">
        <div className="flex items-center justify-between rounded-xl border border-cinnabar/30 bg-cinnabar/10 p-2">
          <span className="font-bold text-paper">NewsNook v1.9.2</span>
          <span className="rounded bg-cinnabar/20 px-1.5 py-0.5 text-[9px] text-cinnabar-soft">
            最新稳定版
          </span>
        </div>
        <div className="space-y-1 text-[9.5px] text-paper-faint">
          <div className="flex justify-between">
            <span>差分补丁 (gdiff-gzip-v1):</span>
            <span className="text-paper font-bold">4.2 MB (无需下 38MB 全包)</span>
          </div>
          <div className="flex justify-between">
            <span>完整性校验:</span>
            <span className="text-cinnabar-soft font-bold">✓ SHA-256 校验通过</span>
          </div>
        </div>
      </div>
      <p className="mt-2 text-center font-mono text-[9.5px] text-paper-faint">
        直连 GitHub Release 检测发布 · 应用内无缝静默升级
      </p>
    </Cell>
  )
}

// 18. 内置隐私浏览器 (src/features/browser)
export function BrowserDemo() {
  return (
    <Cell title="内置隐私浏览器" badge="隔离会话" note="无痕 · 多标签 · 油猴">
      <div className="space-y-2">
        <div className="rounded-xl border border-haze bg-ink overflow-hidden">
          <div className="flex items-center gap-1.5 border-b border-haze/60 bg-ink-raised px-2 py-1 font-mono text-[9px]">
            <ShieldCheck size={11} className="text-cinnabar" />
            <span className="text-paper font-bold">无痕多标签会话 2</span>
            <span className="text-paper-faint ml-auto">退出即焚</span>
          </div>
          <div className="p-2 space-y-1 font-mono text-[9.5px]">
            <div className="flex items-center gap-1.5 text-paper-muted">
              <Globe size={11} />
              <span className="truncate">news.aizeek.com/a/article-reader</span>
            </div>
            <div className="flex gap-1 text-[8px] text-paper-faint pt-1">
              <span className="rounded border border-haze px-1.5 py-0.2">独立 Cookie 会话</span>
              <span className="rounded border border-haze px-1.5 py-0.2">油猴脚本注入</span>
              <span className="rounded border border-haze px-1.5 py-0.2">桌面 UA</span>
            </div>
          </div>
        </div>
      </div>
      <p className="mt-2 text-center font-mono text-[9.5px] text-paper-faint">
        系统级 WebView 独立 Profile · 与阅读器完全隔离 · 绝不污染凭据
      </p>
    </Cell>
  )
}

// 19. 功能引导 (src/features/productTour)
export function TourDemo() {
  return (
    <Cell title="交互式功能引导" badge="driver.js" note="逐步探索 · 随时重看">
      <div className="relative rounded-xl border border-dashed border-cinnabar/60 bg-ink p-3 space-y-2">
        <div className="flex items-center justify-between font-mono text-[10px]">
          <span className="text-cinnabar-soft font-bold">步骤 3 / 11 · 分类轨</span>
          <span className="rounded-full bg-cinnabar px-2 py-0.5 text-ink font-bold text-[9px]">
            下一步
          </span>
        </div>
        <p className="text-[11px] text-paper-muted leading-tight">
          长按任意分类标签，即可进入频道管理页，自由拖动排序与隐藏。
        </p>
      </div>
      <p className="mt-2 text-center font-mono text-[9.5px] text-paper-faint">
        昼读暖墨遮罩 · 夜读纯黑高亮 · 换新机或新手随时在「关于」重看
      </p>
    </Cell>
  )
}

// 20. 纸鹤行彩蛋 (src/features/easterEgg)
export function EasterEggDemo() {
  const reduced = useReducedMotion()

  return (
    <Cell title="纸鹤行" badge="隐藏彩蛋" note="连点 5 次品牌">
      <div className="flex flex-col items-center justify-center space-y-2 py-1">
        <div className="flex items-end gap-2 text-cinnabar-soft">
          {['◢', '◣', '◢', '◣', '◢'].map((c, i) => (
            <motion.span
              key={i}
              className="text-[18px] font-bold"
              animate={reduced ? undefined : { y: [0, -6, 0] }}
              transition={
                reduced
                  ? undefined
                  : { duration: 2.0, repeat: Infinity, delay: i * 0.25, ease: 'easeInOut' }
              }
            >
              {c}
            </motion.span>
          ))}
        </div>
        <div className="font-mono text-[10px] text-paper-muted">
          触发方式：1 秒内快速连点顶栏品牌字标 5 次
        </div>
      </div>
      <p className="mt-2 text-center font-mono text-[9.5px] text-paper-faint">
        全屏极简折纸飞行小游戏 · 感受宣纸墨色的宁静片刻
      </p>
    </Cell>
  )
}
