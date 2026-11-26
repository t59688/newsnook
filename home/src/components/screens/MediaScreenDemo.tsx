import { useState } from 'react'
import {
  ArrowLeft,
  Cast,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  Radio,
  Tv,
} from 'lucide-react'
import { TabBar } from '../app/TabBar'
import { Cover } from '../app/Cover'
import { PhoneStatusBar } from '../app/PhoneStatusBar'

/* 媒体嗅探与悬浮画中画真机界面 —— 严格复刻 src/features/floatingVideo & mediaSniffer：
 * 原生嗅探横幅（1080P m3u8 流检测）+ 全屏/小窗无缝漫游（切页不中断）+
 * 浮动画中画手势窗口 + DLNA 局域网大屏投屏。 */
export function MediaScreenDemo() {
  const [playing, setPlaying] = useState(true)
  const [casting, setCasting] = useState(false)
  const [pipMinimized, setPipMinimized] = useState(false)

  return (
    <div className="relative flex h-full flex-col bg-ink text-paper select-none">
      {/* 沉浸式顶栏 */}
      <header className="relative z-20 shrink-0 border-b border-haze/40 bg-ink/95 backdrop-blur-xl">
        <PhoneStatusBar />
        <div className="flex items-center justify-between px-3 py-1.5">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              aria-label="返回"
              className="flex h-7 w-7 items-center justify-center rounded-full text-paper-muted hover:bg-paper/8 hover:text-paper"
            >
              <ArrowLeft size={16} strokeWidth={2} />
            </button>
            <div className="flex items-center gap-1.5">
              <Radio size={14} className="text-cinnabar" />
              <span className="font-display text-[14px] font-semibold text-paper">
                媒体嗅探与画中画
              </span>
            </div>
          </div>

          <span className="rounded-full bg-cinnabar/15 px-2 py-0.5 font-mono text-[9px] text-cinnabar-soft font-semibold">
            切页不中断
          </span>
        </div>
      </header>

      {/* 蓝光流媒体嗅探状态横幅 */}
      <div className="border-b border-cinnabar/30 bg-cinnabar/10 px-3.5 py-1.5 space-y-0.5 font-mono text-[9.5px]">
        <div className="flex items-center justify-between text-cinnabar-soft font-bold">
          <span>✓ 已捕获蓝光流：1080P H.264 (m3u8)</span>
          <span>48kHz 杜比音效</span>
        </div>
        <div className="text-[8.5px] text-paper-faint truncate">
          https://media-stream.news.cn/2026/feature_1080p.m3u8
        </div>
      </div>

      {/* 底层阅览内容视口（背景文字信息流） */}
      <div className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain p-3.5 space-y-3 opacity-90">
        <div className="space-y-1.5 border-b border-haze/30 pb-3">
          <div className="font-mono text-[9px] text-cinnabar-soft">特稿纪实 · 现场视频直击</div>
          <h2 className="font-display text-[15px] font-bold text-paper">
            高铁穿行武陵山脉：内陆交通走廊如何激活县城产业生态
          </h2>
          <div className="font-mono text-[9px] text-paper-faint">
            发布于 2 小时前 · 新华社现场报道
          </div>
        </div>

        <p className="text-[12px] leading-relaxed text-paper-muted">
          清晨六点半，第一趟动车从湘西小站呼啸驶出。在车厢里，有往返于县城与省城之间的小微企业主，也有带着样机前往沿海参展的技术工人……
        </p>

        {/* 投屏状态反馈卡片 */}
        {casting && (
          <div className="rounded-xl border border-cinnabar/40 bg-cinnabar/15 p-2.5 font-mono text-[10px] flex items-center justify-between text-cinnabar-soft">
            <span className="flex items-center gap-1.5 font-bold">
              <Tv size={13} />
              <span>正在向【客厅电视 · LG webOS】无线投屏中</span>
            </span>
            <button
              type="button"
              onClick={() => setCasting(false)}
              className="rounded bg-cinnabar/20 px-2 py-0.5 text-[9px] font-bold text-cinnabar-soft"
            >
              断开
            </button>
          </div>
        )}

        {/* 悬浮画中画组件 (InkVideoPlayer) */}
        {!pipMinimized ? (
          <div className="rounded-2xl border border-cinnabar/40 bg-ink-raised shadow-2xl overflow-hidden">
            {/* 播放器状态条 */}
            <div className="flex items-center justify-between bg-black/60 px-3 py-1 text-[9px] font-mono text-paper-muted">
              <span>独立视频渲染宿主 · 1080P 蓝光</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setCasting(!casting)}
                  title="DLNA 投屏"
                  className={`hover:text-paper ${casting ? 'text-cinnabar-soft font-bold' : ''}`}
                >
                  <Cast size={12} />
                </button>
                <button
                  type="button"
                  onClick={() => setPipMinimized(true)}
                  title="最小化为悬浮窗"
                  className="hover:text-paper"
                >
                  <Minimize2 size={12} />
                </button>
              </div>
            </div>

            {/* 真实视频画面 */}
            <div className="relative aspect-video w-full bg-black flex items-center justify-center overflow-hidden">
              <Cover seed="media-stream-1080p" label="蓝光 1080P" className="h-full w-full opacity-80" aspect="video" />

              <button
                type="button"
                onClick={() => setPlaying(!playing)}
                className="absolute flex h-10 w-10 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-md hover:scale-105 transition-transform"
              >
                {playing ? <Pause size={16} /> : <Play size={16} className="ml-0.5" />}
              </button>

              <div className="absolute bottom-2 left-2 flex items-center gap-1.5 font-mono text-[9px] text-white/90 bg-black/50 px-2 py-0.5 rounded-full">
                <span className="h-1.5 w-1.5 rounded-full bg-cinnabar animate-pulse" />
                <span>02:14 / 04:36</span>
              </div>
            </div>

            {/* 进度控制条 */}
            <div className="h-1 bg-paper/10">
              <div className="h-full w-[48%] bg-cinnabar" />
            </div>
          </div>
        ) : (
          /* 右下角极简画中画小窗 */
          <div className="fixed bottom-16 right-4 z-50 w-36 overflow-hidden rounded-xl border border-cinnabar/60 bg-black shadow-2xl">
            <div className="relative aspect-video w-full">
              <Cover seed="media-stream-pip" label="画中画" className="h-full w-full opacity-90" aspect="video" />
              <button
                type="button"
                onClick={() => setPipMinimized(false)}
                className="absolute top-1 right-1 rounded-full bg-black/70 p-0.5 text-white"
              >
                <Maximize2 size={10} />
              </button>
            </div>
          </div>
        )}
      </div>

      <TabBar active="today" />
    </div>
  )
}
