import { useState } from 'react'
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Code,
  Copy,
  FileCode,
  Film,
  Images,
  Lock,
  Maximize2,
  MoreHorizontal,
  Play,
  Plus,
  RotateCw,
  Shield,
  ShieldCheck,
  Sparkles,
  Terminal,
  X,
} from 'lucide-react'
import { ReaderDemo } from '../app/ReaderDemo'
import { Cover } from '../app/Cover'
import { PhoneStatusBar } from '../app/PhoneStatusBar'

interface UserScriptItem {
  id: string
  name: string
  version: string
  match: string
  enabled: boolean
  grants: string[]
  runAt: string
  codeSnippet: string
}

const INITIAL_SCRIPTS: UserScriptItem[] = [
  {
    id: 'script-1',
    name: '少数派：自动展开全文 & 移除阅读遮罩',
    version: '2.4.1',
    match: '*://*.sspai.com/*',
    enabled: true,
    grants: ['GM_addStyle', 'unsafeWindow'],
    runAt: 'document-idle',
    codeSnippet: `// ==UserScript==
// @name         少数派自动展开全文 & 遮罩移除
// @namespace    newsnook.tampermonkey
// @version      2.4.1
// @match        *://*.sspai.com/*
// @grant        GM_addStyle
// @grant        unsafeWindow
// @run-at       document-idle
// ==/UserScript==

(function() {
  'use strict';
  // 注入样式强制展开长文并移除登录弹窗遮罩
  GM_addStyle('.article-mask, .paywall-wrapper { display: none !important; }');
  GM_addStyle('.content-overflow { max-height: none !important; }');
})();`,
  },
  {
    id: 'script-2',
    name: '网页反追踪与广告净化拦截',
    version: '3.1.0',
    match: '*://*/*',
    enabled: true,
    grants: ['GM_xmlhttpRequest', 'GM_setValue'],
    runAt: 'document-start',
    codeSnippet: `// ==UserScript==
// @name         通用网页反追踪与广告净化
// @version      3.1.0
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @run-at       document-start
// ==/UserScript==

(function() {
  'use strict';
  const blockHosts = ['hm.baidu.com', 'google-analytics.com'];
  window.addEventListener('beforescriptexecute', (e) => {
    if (blockHosts.some(h => e.target.src?.includes(h))) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);
})();`,
  },
  {
    id: 'script-3',
    name: '内联流媒体嗅探增强与画中画劫持',
    version: '1.9.0',
    match: '*://*.sspai.com/*',
    enabled: true,
    grants: ['GM_download', 'GM_addStyle'],
    runAt: 'document-end',
    codeSnippet: `// ==UserScript==
// @name         流媒体自动嗅探与 PiP 投屏
// @version      1.9.0
// @match        *://*.sspai.com/*
// @grant        GM_download
// @grant        GM_addStyle
// @run-at       document-end
// ==/UserScript==

(function() {
  'use strict';
  // 劫持 HTML5 视频标签并向宿主通知 m3u8 流地址
  document.querySelectorAll('video').forEach(v => {
    v.setAttribute('playsinline', 'true');
  });
})();`,
  },
]

const GALLERY_IMAGES = [
  { id: 'img-1', title: '离线优先客户端架构图', size: '1920x1080 · 420 KB', tag: '矢量架构' },
  { id: 'img-2', title: '双语对照排版工程实录', size: '1440x900 · 310 KB', tag: '排版对比' },
  { id: 'img-3', title: '本地数据库缓存拓扑', size: '1280x720 · 280 KB', tag: '端侧存储' },
  { id: 'img-4', title: '网络降级状态机图解', size: '1080x1080 · 240 KB', tag: '状态迁移' },
]

export function BrowserScreenDemo() {
  const [incognito, setIncognito] = useState(true)
  const [desktopUA, setDesktopUA] = useState(false)
  const [tabsOpen, setTabsOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [activeTabId, setActiveTabId] = useState<'sspai' | 'thepaper'>('sspai')
  const [readerViewOpen, setReaderViewOpen] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  // 油猴脚本控制台状态
  const [scriptsDrawerOpen, setScriptsDrawerOpen] = useState(false)
  const [scriptsTab, setScriptsTab] = useState<'list' | 'code' | 'logs'>('list')
  const [selectedScriptId, setSelectedScriptId] = useState<string>('script-1')
  const [scripts, setScripts] = useState(INITIAL_SCRIPTS)

  // 媒体嗅探与看图模式
  const [imagesPanelOpen, setImagesPanelOpen] = useState(false)
  const [mediaDrawerOpen, setMediaDrawerOpen] = useState(false)
  const [selectedGalleryImg, setSelectedGalleryImg] = useState<string | null>(null)
  const [toastMessage, setToastMessage] = useState<string | null>(null)

  const showToast = (msg: string) => {
    setToastMessage(msg)
    setTimeout(() => setToastMessage(null), 2200)
  }

  const handleRefresh = () => {
    setRefreshing(true)
    setTimeout(() => {
      setRefreshing(false)
      showToast('网页已重新载入并完成油猴脚本注入')
    }, 600)
  }

  const toggleScript = (id: string) => {
    setScripts((prev) =>
      prev.map((s) => {
        if (s.id === id) {
          const next = !s.enabled
          showToast(`脚本「${s.name}」已${next ? '启用并挂载' : '停用'}`)
          return { ...s, enabled: next }
        }
        return s
      }),
    )
  }

  const activeScriptCount = scripts.filter((s) => s.enabled).length
  const selectedScript = scripts.find((s) => s.id === selectedScriptId) || scripts[0]

  if (readerViewOpen) {
    return (
      <div className="relative h-full flex flex-col bg-[#fbfbf9] text-slate-800">
        <ReaderDemo
          article={{
            source: '少数派 sspai',
            time: '昨天 19:30',
            title: '我把整个阅读工作流换成了本地离线优先：对抗信息焦虑的实操手记',
            summary: '当算法推荐把「你可能喜欢」变成平台的内容指标，主动选择信源与离线解析成了一种自救。',
          }}
          onClose={() => setReaderViewOpen(false)}
        />
      </div>
    )
  }

  return (
    <div className="relative flex h-full flex-col bg-[#f8f9fa] text-slate-800 select-none">
      {/* ================= 沉浸式浅色顶栏与地址栏 (BrowserAddressBar) ================= */}
      <header className="relative z-20 shrink-0 border-b border-slate-200/90 bg-[#f8f9fa]/95 pb-1 backdrop-blur-xl">
        <PhoneStatusBar className="text-slate-700" />

        <div className="flex items-center gap-1.5 px-2.5 pt-0.5">
          <div className="flex items-center gap-0.5 text-slate-500 shrink-0">
            <button
              type="button"
              aria-label="后退"
              className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-slate-200/70 hover:text-slate-900 transition-colors"
            >
              <ArrowLeft size={13} strokeWidth={2} />
            </button>
            <button
              type="button"
              aria-label="刷新"
              onClick={handleRefresh}
              className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-slate-200/70 hover:text-slate-900 transition-colors"
            >
              <RotateCw size={12} strokeWidth={2} className={refreshing ? 'animate-spin text-cinnabar' : ''} />
            </button>
          </div>

          {/* 浅色精致网址输入胶囊 */}
          <div
            className={`flex min-w-0 flex-1 items-center gap-1.5 rounded-xl border px-2.5 py-1 transition-all ${
              incognito ? 'border-cinnabar/40 bg-white shadow-xs' : 'border-slate-200 bg-white shadow-xs'
            }`}
          >
            {incognito ? (
              <Shield size={12.5} className="shrink-0 text-cinnabar" />
            ) : (
              <Lock size={12} className="shrink-0 text-emerald-600" />
            )}

            <div className="flex min-w-0 flex-1 items-center gap-1 text-[11px] font-mono leading-none">
              {incognito && (
                <span className="shrink-0 rounded bg-cinnabar/10 px-1 py-0.2 text-[8.5px] font-bold text-cinnabar">
                  无痕
                </span>
              )}
              <span className="truncate text-slate-800 font-medium">
                {activeTabId === 'sspai' ? 'sspai.com/post/87241' : 'thepaper.cn/newsDetail_2789'}
              </span>
            </div>

            {/* 油猴脚本徽章（高亮显示正在运行的脚本数，点击直达脚本管理器） */}
            <button
              type="button"
              onClick={() => {
                setScriptsTab('list')
                setScriptsDrawerOpen(true)
              }}
              title="油猴脚本 (Tampermonkey)：已挂载 3 个脚本"
              className="flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 border border-emerald-500/30 px-1.5 py-0.5 font-mono text-[9px] font-bold text-emerald-700 hover:bg-emerald-100 transition-colors"
            >
              <span className="text-[10px]">🐒</span>
              <span>{activeScriptCount}</span>
            </button>

            {/* 媒体流嗅探徽章 */}
            <button
              type="button"
              onClick={() => setMediaDrawerOpen(true)}
              title="媒体嗅探：发现 1 个 1080P 高清流媒体"
              className="flex shrink-0 items-center gap-0.5 rounded-full bg-amber-50 border border-amber-500/30 px-1.5 py-0.5 font-mono text-[9px] font-bold text-amber-700 hover:bg-amber-100 transition-colors"
            >
              <Film size={10} />
              <span>1</span>
            </button>
          </div>
        </div>
      </header>

      {/* ================= 实时油猴脚本生效提示栏 (Tampermonkey Active Ribbon) ================= */}
      <div
        onClick={() => {
          setScriptsTab('list')
          setScriptsDrawerOpen(true)
        }}
        className="flex items-center justify-between border-b border-emerald-500/25 bg-emerald-50/90 px-3 py-1 font-mono text-[9.5px] text-emerald-800 cursor-pointer hover:bg-emerald-100/80 transition-colors"
      >
        <div className="flex items-center gap-1.5 font-medium">
          <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
          <span>🐒 油猴脚本生效中：{activeScriptCount} 个脚本注入安全沙箱</span>
          <span className="rounded bg-emerald-200/60 px-1 py-0.2 text-[8px] font-bold text-emerald-900">
            端侧拦截
          </span>
        </div>
        <span className="flex items-center gap-0.5 font-semibold text-emerald-700 underline underline-offset-2">
          查看脚本 →
        </span>
      </div>

      {/* ================= 真实浅色网页渲染视口 (Web Content Viewport) ================= */}
      <div className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain bg-white text-slate-900">
        {/* Readability 正文就绪悬浮抽提条（一键转入站内沉浸阅读） */}
        <div className="sticky top-0 z-30 flex items-center justify-between border-b border-rose-200 bg-rose-50/95 px-3 py-1.5 backdrop-blur-md shadow-xs">
          <div className="flex items-center gap-1.5 text-[10.5px] font-mono text-cinnabar font-semibold">
            <Sparkles size={12} />
            <span>检测到正文内容，支持一键转入站内阅读器</span>
          </div>
          <button
            type="button"
            onClick={() => setReaderViewOpen(true)}
            className="flex items-center gap-1 rounded-full bg-cinnabar px-2.5 py-0.5 font-mono text-[9.5px] font-bold text-white shadow-xs transition-transform hover:bg-cinnabar-soft active:scale-95"
          >
            <span>转入站内</span>
            <ChevronRight size={11} strokeWidth={2.5} />
          </button>
        </div>

        {/* 少数派浅色网页正文排版 */}
        <div className="p-4 space-y-3.5">
          {/* 原站顶栏 */}
          <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
            <div className="flex items-center gap-2">
              <span className="rounded bg-[#d71920] px-1.5 py-0.5 text-[9px] font-black text-white">SSPAI</span>
              <span className="font-sans text-[11px] font-bold text-slate-800">少数派 · 专栏</span>
            </div>
            <div className="flex items-center gap-2 font-mono text-[9px] text-slate-500">
              <span>{desktopUA ? '桌面渲染模式' : '移动触控视图'}</span>
              <span className="rounded bg-emerald-100 px-1.5 py-0.2 font-bold text-emerald-800">脚本已注入</span>
            </div>
          </div>

          {/* 油猴脚本在页面上产生的直观效果 1：已绕过阅读遮罩 */}
          <div className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50/70 px-2.5 py-1.5 font-mono text-[9.5px] text-emerald-800">
            <span className="flex items-center gap-1.5 font-medium">
              <Check size={12} className="text-emerald-600" />
              <span>[油猴已生效] 自动解除「App 内阅读」遮罩，8,420 字已全量展开</span>
            </span>
            <span className="font-bold text-emerald-700">GM_addStyle</span>
          </div>

          {/* 油猴脚本在页面上产生的直观效果 2：广告与追踪拦截 */}
          <div className="flex items-center justify-between rounded-lg border border-dashed border-slate-200 bg-slate-50 px-2.5 py-1.2 font-mono text-[9px] text-slate-500">
            <span className="flex items-center gap-1">
              <ShieldCheck size={11} className="text-emerald-600" />
              <span>[油猴净化] 已过滤 1 处浮动推广横幅与 3 处用户追踪探针</span>
            </span>
            <span className="text-slate-400">拦截耗时 1ms</span>
          </div>

          {/* 文章标题 */}
          <h1 className="font-display text-[17px] font-bold leading-snug text-slate-900">
            {activeTabId === 'sspai'
              ? '我把整个阅读工作流换成了本地离线优先：对抗信息焦虑的实操手记'
              : '回到县城的人们：一份持续十年的中部产业转移追踪观察'}
          </h1>

          {/* 作者信息栏 */}
          <div className="flex items-center gap-2 text-[10.5px] text-slate-500">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-cinnabar/15 font-bold text-cinnabar text-[9px]">
              林
            </span>
            <span className="font-medium text-slate-700">林十安 · 签约作者</span>
            <span>·</span>
            <span className="font-mono text-[9.5px]">昨天 19:30</span>
          </div>

          {/* 文章配图（纯矢量 SVG，永不出现图片挂起破损） */}
          <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-900">
            <Cover
              seed="sspai-workflow"
              label="本地优先阅读工作流"
              aspect="video"
              className="h-full w-full"
              subtitle="1080P m3u8 内嵌讲解"
            />
            <button
              type="button"
              onClick={() => setMediaDrawerOpen(true)}
              className="absolute bottom-2 left-2 flex items-center gap-1 rounded bg-black/80 px-2 py-0.8 font-mono text-[8.5px] text-white/95 hover:bg-cinnabar transition-colors"
            >
              <Film size={10} className="text-cinnabar" />
              <span>内联讲解视频 · 04:12（点击播放）</span>
            </button>
          </div>

          {/* 正文段落（明亮对比度高、排版舒展） */}
          <div className="space-y-2.5 font-sans text-[12px] leading-relaxed text-slate-700">
            <p>
              在过去几年里，平台式的推荐信息流几乎重塑了我们的阅读习惯。每一屏看似都是“你可能感兴趣”，实则是服务端的流量分配公式在替你决定视野。
            </p>
            <p>
              当我把手机中所有的平台客户端卸载，重回 RSS 与 NewsNook
              这种完全本地优先的工具时，我第一次重新获得了对阅读节奏的绝对掌控。
            </p>
            <p>
              所有正文在端侧直接抽取，不需要任何中转服务器；即使在飞行模式或地下车库，所有翻阅过的文章依然瞬间秒开。
            </p>
          </div>

          {/* 页面底部油猴脚本审计状态 */}
          <div className="border-t border-slate-100 pt-2 font-mono text-[9px] text-slate-400 flex items-center justify-between">
            <span>沙箱隔离度：WebKit Isolated World</span>
            <span className="text-emerald-700">0 跨站数据泄露</span>
          </div>
        </div>
      </div>

      {/* ================= 浅色精致底部导航工具栏 (BrowserWorkspace Toolbar) ================= */}
      <footer className="relative z-20 shrink-0 border-t border-slate-200/90 bg-[#f8f9fa]/95 px-3 py-1.5 backdrop-blur-xl">
        <div className="flex items-center justify-between text-slate-600">
          <button
            type="button"
            aria-label="后退"
            className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-slate-200/70 hover:text-slate-900"
          >
            <ArrowLeft size={16} strokeWidth={1.8} />
          </button>

          {/* 看图模式按钮 (BrowserImagesPanel) */}
          <button
            type="button"
            onClick={() => setImagesPanelOpen(true)}
            aria-label="看图模式"
            title="提取全页高清图集"
            className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-slate-200/70 hover:text-slate-900 transition-colors"
          >
            <Images size={16} strokeWidth={1.8} />
          </button>

          {/* 油猴脚本快捷入口（高亮提示） */}
          <button
            type="button"
            onClick={() => {
              setScriptsTab('list')
              setScriptsDrawerOpen(true)
            }}
            aria-label="油猴脚本管理"
            title="用户脚本管理器"
            className="relative flex h-8 w-8 items-center justify-center rounded-full bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors"
          >
            <Code size={16} strokeWidth={1.8} />
            <span className="absolute -top-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-emerald-600 font-mono text-[8px] font-bold text-white">
              {activeScriptCount}
            </span>
          </button>

          {/* 多标签切换器徽章 */}
          <button
            type="button"
            onClick={() => setTabsOpen(!tabsOpen)}
            aria-label="标签页管理"
            className={`flex h-6 w-6 items-center justify-center rounded-md border font-mono text-[11px] font-bold transition-colors ${
              tabsOpen ? 'border-cinnabar bg-cinnabar/10 text-cinnabar' : 'border-slate-300 text-slate-700 hover:bg-slate-200/70'
            }`}
          >
            2
          </button>

          {/* 更多菜单 */}
          <button
            type="button"
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label="更多设置"
            className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-slate-200/70 hover:text-slate-900 transition-colors"
          >
            <MoreHorizontal size={18} strokeWidth={1.8} />
          </button>
        </div>
      </footer>

      {/* ================= 油猴脚本管理器完整抽屉 (Tampermonkey Script Console) ================= */}
      {scriptsDrawerOpen && (
        <div
          className="absolute inset-0 z-50 flex flex-col justify-end bg-black/60 backdrop-blur-xs"
          onClick={() => setScriptsDrawerOpen(false)}
        >
          <div
            className="max-h-[88%] w-full overflow-y-auto rounded-t-3xl border-t border-slate-200 bg-white p-4 space-y-3.5 shadow-2xl text-slate-900"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 顶栏与关闭 */}
            <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
              <div className="flex items-center gap-2">
                <span className="text-xl">🐒</span>
                <div>
                  <h3 className="font-display text-[15px] font-bold text-slate-900">
                    油猴脚本管理器 (Tampermonkey)
                  </h3>
                  <p className="mt-0.5 font-mono text-[9px] text-slate-500">
                    端侧沙箱隔离 · 规则热挂载 · {activeScriptCount}/{scripts.length} 运行中
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setScriptsDrawerOpen(false)}
                className="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X size={16} />
              </button>
            </div>

            {/* 抽屉内三段式选项卡：脚本列表 / 脚本源码 (@grant) / 实时拦截日志 */}
            <div className="flex items-center rounded-xl border border-slate-200 bg-slate-50 p-1 font-mono text-[10.5px]">
              <button
                type="button"
                onClick={() => setScriptsTab('list')}
                className={`flex-1 rounded-lg py-1 font-semibold transition-all ${
                  scriptsTab === 'list'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                已挂载脚本 ({scripts.length})
              </button>
              <button
                type="button"
                onClick={() => setScriptsTab('code')}
                className={`flex-1 rounded-lg py-1 font-semibold transition-all ${
                  scriptsTab === 'code'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                源码与 @grant
              </button>
              <button
                type="button"
                onClick={() => setScriptsTab('logs')}
                className={`flex-1 rounded-lg py-1 font-semibold transition-all ${
                  scriptsTab === 'logs'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                执行日志 (4)
              </button>
            </div>

            {/* TAB 1: 脚本列表卡片 */}
            {scriptsTab === 'list' && (
              <div className="space-y-2">
                {scripts.map((script) => (
                  <div
                    key={script.id}
                    className={`rounded-xl border p-2.5 transition-all ${
                      script.enabled
                        ? 'border-emerald-200 bg-emerald-50/40 shadow-xs'
                        : 'border-slate-200 bg-slate-50/60 opacity-60'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate font-display text-[12.5px] font-semibold text-slate-900">
                            {script.name}
                          </span>
                          <span className="rounded bg-slate-200/80 px-1 py-0.2 font-mono text-[8px] text-slate-600">
                            v{script.version}
                          </span>
                        </div>
                        <div className="mt-1 flex items-center gap-2 font-mono text-[9px] text-slate-500">
                          <span className="text-emerald-700 font-semibold">{script.match}</span>
                          <span>·</span>
                          <span>{script.runAt}</span>
                        </div>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {script.grants.map((g) => (
                            <span
                              key={g}
                              className="rounded bg-slate-200/60 px-1.5 py-0.2 font-mono text-[8px] text-slate-700"
                            >
                              @{g}
                            </span>
                          ))}
                        </div>
                      </div>

                      {/* 启用/停用 Switch */}
                      <button
                        type="button"
                        onClick={() => toggleScript(script.id)}
                        className={`flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors ${
                          script.enabled ? 'bg-emerald-600 justify-end' : 'bg-slate-300 justify-start'
                        }`}
                      >
                        <span className="h-4 w-4 rounded-full bg-white shadow-xs" />
                      </button>
                    </div>

                    <div className="mt-2 flex items-center justify-between border-t border-slate-200/60 pt-1.5 font-mono text-[9px]">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedScriptId(script.id)
                          setScriptsTab('code')
                        }}
                        className="text-emerald-700 hover:underline flex items-center gap-0.5"
                      >
                        <FileCode size={10} />
                        <span>查看 .user.js 完整源码</span>
                      </button>
                      <span className="text-slate-400">沙箱内存：14 KB</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* TAB 2: 脚本源码与元数据预览 */}
            {scriptsTab === 'code' && (
              <div className="space-y-2">
                <div className="flex items-center justify-between font-mono text-[10px]">
                  <span className="font-semibold text-slate-700">{selectedScript.name}</span>
                  <button
                    type="button"
                    onClick={() => showToast('脚本源码已复制到剪贴板')}
                    className="flex items-center gap-1 text-emerald-700 hover:underline"
                  >
                    <Copy size={11} />
                    <span>复制代码</span>
                  </button>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-900 p-3 font-mono text-[9px] text-slate-200 overflow-x-auto max-h-56 leading-relaxed">
                  <pre>{selectedScript.codeSnippet}</pre>
                </div>
                <p className="font-mono text-[8.5px] text-slate-400">
                  支持 GM_addStyle, GM_xmlhttpRequest, GM_setValue, GM_getValue 与 unsafeWindow 完整权限。
                </p>
              </div>
            )}

            {/* TAB 3: 实时拦截日志 */}
            {scriptsTab === 'logs' && (
              <div className="space-y-1.5 rounded-xl border border-slate-200 bg-slate-50 p-2.5 font-mono text-[9.5px]">
                <div className="flex items-center gap-1.5 text-emerald-700 font-semibold pb-1 border-b border-slate-200">
                  <Terminal size={12} />
                  <span>油猴引擎运行审计日志 (4 条)</span>
                </div>
                <div className="space-y-1 text-slate-600 text-[8.5px]">
                  <div>[19:30:01.012] <span className="text-emerald-700">Matched</span> *://*.sspai.com/* → 注入脚本 #1</div>
                  <div>[19:30:01.015] <span className="text-sky-700">GM_addStyle</span> 覆盖 .article-mask 与高度限制</div>
                  <div>[19:30:01.018] <span className="text-amber-700">Blocked</span> 拦截来自 hm.baidu.com 的探针脚本</div>
                  <div>[19:30:01.024] <span className="text-purple-700">Sniffed</span> 成功捕获 video 节点 m3u8 流媒体资源</div>
                </div>
              </div>
            )}

            {/* 底部动作 */}
            <div className="flex items-center gap-2 pt-1 font-mono text-[11px]">
              <button
                type="button"
                onClick={() => showToast('已打开系统文件选择器：支持导入 .user.js 脚本')}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-300 py-2 text-slate-700 hover:bg-slate-50 font-medium"
              >
                <Plus size={13} />
                <span>导入 .user.js 脚本</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setScriptsDrawerOpen(false)
                  handleRefresh()
                }}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-emerald-600 py-2 font-semibold text-white shadow-xs hover:bg-emerald-700 transition-colors"
              >
                <RotateCw size={13} />
                <span>保存并即时生效</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================= 看图模式全屏画廊 (BrowserImagesPanel) ================= */}
      {imagesPanelOpen && (
        <div className="absolute inset-0 z-50 flex flex-col bg-white text-slate-900">
          <header className="flex h-11 items-center justify-between border-b border-slate-200 px-3 bg-slate-50">
            <div className="flex items-center gap-2">
              <Images size={15} className="text-cinnabar" />
              <h3 className="font-display text-[13.5px] font-bold text-slate-900">
                全页看图模式 ({GALLERY_IMAGES.length})
              </h3>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => showToast('已将全页 4 张高清插图批量保存至系统相册')}
                className="rounded-lg border border-slate-300 px-2 py-1 font-mono text-[10px] text-slate-700 hover:bg-slate-100"
              >
                批量导出
              </button>
              <button
                type="button"
                onClick={() => setImagesPanelOpen(false)}
                className="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X size={16} />
              </button>
            </div>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <div className="grid grid-cols-2 gap-2.5">
              {GALLERY_IMAGES.map((img) => (
                <div
                  key={img.id}
                  onClick={() => setSelectedGalleryImg(img.title)}
                  className="group relative cursor-pointer overflow-hidden rounded-xl border border-slate-200 bg-slate-50 transition-all hover:border-cinnabar/60"
                >
                  <div className="relative aspect-video w-full overflow-hidden bg-slate-900">
                    <Cover seed={img.id} label={img.tag} aspect="video" className="h-full w-full" />
                  </div>
                  <div className="p-2 space-y-0.5">
                    <span className="block truncate font-display text-[11.5px] font-medium text-slate-800">
                      {img.title}
                    </span>
                    <span className="block font-mono text-[8.5px] text-slate-500">{img.size}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ================= 媒体流嗅探抽屉 (Media Sniffer Drawer) ================= */}
      {mediaDrawerOpen && (
        <div
          className="absolute inset-0 z-50 flex flex-col justify-end bg-black/60 backdrop-blur-xs"
          onClick={() => setMediaDrawerOpen(false)}
        >
          <div
            className="w-full rounded-t-3xl border-t border-slate-200 bg-white p-4 space-y-3 shadow-2xl text-slate-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <div className="flex items-center gap-2">
                <Film size={16} className="text-cinnabar" />
                <h3 className="font-display text-[14px] font-bold text-slate-900">已嗅探网页媒体资源 (1)</h3>
              </div>
              <button
                type="button"
                onClick={() => setMediaDrawerOpen(false)}
                className="text-slate-400 hover:text-slate-700"
              >
                <X size={16} />
              </button>
            </div>

            <div className="rounded-xl border border-amber-300 bg-amber-50/70 p-3 space-y-1.5">
              <div className="flex items-center justify-between font-mono text-[9.5px]">
                <span className="rounded bg-amber-200/80 px-1.5 py-0.2 font-bold text-amber-900">
                  1080P m3u8 HLS 流
                </span>
                <span className="text-slate-500">24.8 MB · 04:12</span>
              </div>
              <h4 className="font-display text-[13px] font-medium text-slate-900">
                少数派_离线工作流实录_1080P.m3u8
              </h4>
              <p className="break-all font-mono text-[8.5px] text-slate-500">
                https://stream.sspai.com/vod/2026/offline-workflow/index.m3u8
              </p>
            </div>

            <div className="flex items-center gap-2 pt-1 font-mono text-[11px]">
              <button
                type="button"
                onClick={() => {
                  setMediaDrawerOpen(false)
                  showToast('已激活画中画悬浮播放窗，切页继续播放')
                }}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-300 py-2 text-slate-700 hover:bg-slate-50 font-medium"
              >
                <Maximize2 size={13} />
                <span>悬浮画中画 (PiP)</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setMediaDrawerOpen(false)
                  showToast('正在寻找局域网 DLNA / AirPlay 投屏设备…')
                }}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-cinnabar py-2 font-bold text-white shadow-xs hover:bg-cinnabar-soft transition-colors"
              >
                <Play size={13} />
                <span>原画串流播放</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================= 多标签抽屉 ================= */}
      {tabsOpen && (
        <div
          className="absolute inset-0 z-40 flex flex-col justify-end bg-black/60 backdrop-blur-xs"
          onClick={() => setTabsOpen(false)}
        >
          <div
            className="w-full rounded-t-3xl border-t border-slate-200 bg-white p-4 space-y-2.5 shadow-2xl text-slate-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <h3 className="font-display text-[14px] font-bold text-slate-900">已打开标签页 (2)</h3>
              <button type="button" onClick={() => setTabsOpen(false)} className="text-slate-400 hover:text-slate-700">
                <X size={16} />
              </button>
            </div>

            <div className="space-y-1.5">
              <button
                type="button"
                onClick={() => {
                  setActiveTabId('sspai')
                  setTabsOpen(false)
                }}
                className={`flex w-full items-center justify-between rounded-xl border p-2.5 text-left transition-colors ${
                  activeTabId === 'sspai'
                    ? 'border-cinnabar bg-rose-50/70 text-slate-900'
                    : 'border-slate-200 bg-slate-50 text-slate-600'
                }`}
              >
                <div className="min-w-0 flex-1">
                  <span className="block truncate font-display text-[12.5px] font-medium text-slate-900">
                    少数派 · 本地优先阅读手记
                  </span>
                  <span className="font-mono text-[9px] text-slate-400">sspai.com/post/87241</span>
                </div>
                {activeTabId === 'sspai' && <Check size={14} className="text-cinnabar" />}
              </button>

              <button
                type="button"
                onClick={() => {
                  setActiveTabId('thepaper')
                  setTabsOpen(false)
                }}
                className={`flex w-full items-center justify-between rounded-xl border p-2.5 text-left transition-colors ${
                  activeTabId === 'thepaper'
                    ? 'border-cinnabar bg-rose-50/70 text-slate-900'
                    : 'border-slate-200 bg-slate-50 text-slate-600'
                }`}
              >
                <div className="min-w-0 flex-1">
                  <span className="block truncate font-display text-[12.5px] font-medium text-slate-900">
                    澎湃新闻 · 回到县城的人们
                  </span>
                  <span className="font-mono text-[9px] text-slate-400">thepaper.cn/newsDetail_2789</span>
                </div>
                {activeTabId === 'thepaper' && <Check size={14} className="text-cinnabar" />}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================= 底部更多设置菜单 ================= */}
      {menuOpen && (
        <div
          className="absolute inset-0 z-40 flex flex-col justify-end bg-black/60 backdrop-blur-xs"
          onClick={() => setMenuOpen(false)}
        >
          <div
            className="w-full rounded-t-3xl border-t border-slate-200 bg-white p-4 space-y-3 shadow-2xl text-slate-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <h3 className="font-display text-[14px] font-bold text-slate-900">浏览器工具与偏好</h3>
              <button type="button" onClick={() => setMenuOpen(false)} className="text-slate-400 hover:text-slate-700">
                <X size={16} />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 text-[11.5px]">
              <button
                type="button"
                onClick={() => {
                  setIncognito(!incognito)
                  showToast(incognito ? '已退出无痕模式' : '已进入无痕隐私模式')
                }}
                className={`flex items-center gap-2 rounded-xl border p-2.5 transition-colors ${
                  incognito ? 'border-cinnabar bg-rose-50 text-cinnabar font-semibold' : 'border-slate-200 bg-slate-50 text-slate-700'
                }`}
              >
                <Shield size={14} />
                <span>无痕浏览模式</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setDesktopUA(!desktopUA)
                  showToast(desktopUA ? '已切回移动触控 UA' : '已伪装桌面 Chrome UA')
                }}
                className={`flex items-center gap-2 rounded-xl border p-2.5 transition-colors ${
                  desktopUA ? 'border-cinnabar bg-rose-50 text-cinnabar font-semibold' : 'border-slate-200 bg-slate-50 text-slate-700'
                }`}
              >
                <Code size={14} />
                <span>桌面 UA 伪装</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================= 全图 Lightbox 预览 ================= */}
      {selectedGalleryImg && (
        <div
          className="absolute inset-0 z-60 flex flex-col items-center justify-center bg-black/90 p-4"
          onClick={() => setSelectedGalleryImg(null)}
        >
          <div
            className="relative aspect-video w-full max-w-sm overflow-hidden rounded-xl border border-white/20 bg-black"
            onClick={(e) => e.stopPropagation()}
          >
            <Cover seed={selectedGalleryImg} label="原图预览" aspect="video" className="h-full w-full" />
            <button
              type="button"
              onClick={() => setSelectedGalleryImg(null)}
              className="absolute top-2 right-2 rounded-full bg-black/70 p-1 text-white hover:bg-black"
            >
              <X size={16} />
            </button>
          </div>
          <p className="mt-3 font-display text-[13px] text-white">{selectedGalleryImg}</p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => {
                showToast('原图已保存至系统相册')
                setSelectedGalleryImg(null)
              }}
              className="rounded-full bg-cinnabar px-4 py-1 text-[11px] font-bold text-white shadow-xs"
            >
              保存原图
            </button>
          </div>
        </div>
      )}

      {/* ================= 浮动轻量 Toast ================= */}
      {toastMessage && (
        <div className="absolute top-14 inset-x-0 z-50 flex justify-center px-4 pointer-events-none">
          <div className="rounded-full bg-slate-900/90 px-3.5 py-1.5 font-mono text-[10px] text-white shadow-xl border border-slate-700/50 backdrop-blur-md">
            {toastMessage}
          </div>
        </div>
      )}
    </div>
  )
}
