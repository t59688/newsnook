import React, { StrictMode, useContext, useEffect, useLayoutEffect, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { createRoot } from 'react-dom/client'
import { BrowserSheet } from '../src/features/browser/BrowserPrimitives'
import { BrowserSettingsPanel } from '../src/features/browser/BrowserSettingsPanel'
import { BrowserTabsPanel } from '../src/features/browser/BrowserTabsPanel'
import { BrowserWorkspace } from '../src/features/browser/BrowserWorkspace'
import { BrowserImagesPanel } from '../src/features/browser/BrowserImagesPanel'
import type { BrowserImageData, BrowserImageLoadRequest, BrowserImageSnapshot } from '../src/features/browser/browserImages'
import type { BrowserContext } from '../src/features/browser/browserPrivacy'
import { BROWSER_KEYS, DEFAULT_BROWSER_PREFERENCES, loadBrowserPreferences, saveBrowserPreferences, type BrowserSearchChoice } from '../src/features/browser/browserPreferences'
import { useBrowserDialogFocus } from '../src/features/browser/useBrowserDialogFocus'
import { InkVideoPlayer } from '../src/components/InkVideoPlayer'
import { FloatingVideoProvider } from '../src/features/floatingVideo/FloatingVideoProvider'
import { VideoSessionManagerContext } from '../src/features/floatingVideo/context'
import type { VideoSessionManager } from '../src/features/floatingVideo/session'
import { ScriptManager } from '../src/features/browser/ScriptManager'
import { installUserScript, saveUserScripts } from '../src/features/browser/scripts'

declare global {
  interface Window {
    __focusFixtureReady: boolean
    __dismissDialog: () => void
    __desktopChanges: number
    __videoManager: VideoSessionManager | null
    __openCastForTest: () => void
  }
}

const scenario = new URLSearchParams(location.search).get('case') || 'sheet'
const source = '// ==UserScript==\n// @name Keyboard specimen\n// @version 1.0\n// @match https://example.com/*\n// ==/UserScript==\nvoid 0'
if (scenario === 'scripts') saveUserScripts([installUserScript(source)])
if (scenario === 'workspace') {
  localStorage.clear()
  const entries = [{ url: 'https://example.org/retained', title: '保留的文章', time: Date.now() }]
  localStorage.setItem(BROWSER_KEYS.history, JSON.stringify(entries))
  localStorage.setItem(BROWSER_KEYS.bookmarks, JSON.stringify(entries))
}
if (scenario.startsWith('theme-')) {
  localStorage.clear()
  const entries = [
    { url: 'https://example.org/field-notes', title: '山野行记：在湖边停留的一个下午', time: Date.now() },
    { url: 'https://example.com/architecture', title: '建筑与城市之间的日常观察', time: Date.now() - 60_000 },
    { url: 'https://example.net/reading', title: '关于阅读、记录与发现', time: Date.now() - 120_000 },
  ]
  localStorage.setItem(BROWSER_KEYS.history, JSON.stringify(entries))
  localStorage.setItem(BROWSER_KEYS.bookmarks, JSON.stringify(entries.slice(0, 2)))
  localStorage.setItem(BROWSER_KEYS.shortcuts, JSON.stringify([
    { name: '维基百科', url: 'https://zh.wikipedia.org/' },
    { name: '少数派', url: 'https://sspai.com/' },
    { name: 'Linux Do', url: 'https://linux.do/' },
    { name: '开发者文档', url: 'https://developer.mozilla.org/' },
  ]))
  localStorage.setItem(BROWSER_KEYS.search, 'bing')
  localStorage.setItem(BROWSER_KEYS.addressPosition, 'bottom')
  saveBrowserPreferences({ ...DEFAULT_BROWSER_PREFERENCES })
}
window.__desktopChanges = 0
const sampleVideo = scenario.startsWith('player-') ? await createSampleVideo() : ''

async function createSampleVideo(): Promise<string> {
  const canvas = document.createElement('canvas')
  canvas.width = 160
  canvas.height = 90
  const context = canvas.getContext('2d')!
  context.fillStyle = '#668844'
  context.fillRect(0, 0, canvas.width, canvas.height)
  const stream = canvas.captureStream(15)
  const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' })
  const chunks: BlobPart[] = []
  const result = new Promise<string>(resolve => {
    recorder.ondataavailable = event => chunks.push(event.data)
    recorder.onstop = () => {
      stream.getTracks().forEach(track => track.stop())
      resolve(URL.createObjectURL(new Blob(chunks, { type: 'video/webm' })))
    }
  })
  recorder.start()
  window.setTimeout(() => recorder.stop(), 300)
  return result
}

function PlayerFixture({onClose}: {onClose: () => void}) {
  const owned = scenario !== 'player-default'
  const owner = useBrowserDialogFocus<HTMLDivElement>(owned)
  const [container, setContainer] = useState<HTMLElement | null>(null)
  const manager = useContext(VideoSessionManagerContext)
  useLayoutEffect(() => { setContainer(owner.current) }, [owner])
  useEffect(() => {
    if (!owned) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, owned])
  useEffect(() => {
    window.__videoManager = manager
    window.__openCastForTest = () => {
      // Exercise the real picker in Chrome without invoking native device discovery.
      const platform = Capacitor.getPlatform
      const available = Capacitor.isPluginAvailable
      Capacitor.getPlatform = () => 'android'
      Capacitor.isPluginAvailable = name => name === 'DlnaCast'
      try { document.querySelector<HTMLButtonElement>('[aria-label="投屏"]')?.click() }
      finally { Capacitor.getPlatform = platform; Capacitor.isPluginAvailable = available }
    }
  }, [manager])
  return <div ref={owner} tabIndex={-1} data-test-player-owner
    className="fixed inset-0 flex flex-col bg-ink text-paper outline-none">
    <button id="player-back" className="min-h-11" onClick={onClose}>退出播放器</button>
    <div className="flex min-h-0 flex-1 items-center">
      <div className="w-full min-w-0">
        {container && <InkVideoPlayer src={sampleVideo} title="键盘测试视频" mediaPageHost={false}
          overlayContainer={owned ? container : undefined} suppressResourceFab={scenario === 'player-browser'} />}
      </div>
    </div>
  </div>
}

function ThemeSettingsFixture() {
  const [preferences, setPreferences] = useState(loadBrowserPreferences)
  const [search, setSearch] = useState<BrowserSearchChoice>('bing')
  const [bottomAddress, setBottomAddress] = useState(true)
  const [privateMode, setPrivateMode] = useState(false)
  const [historyCount, setHistoryCount] = useState(3)
  const [hasPage, setHasPage] = useState(true)
  return <BrowserSettingsPanel search={search} bottomAddress={bottomAddress}
    desktop={preferences.userAgentMode === 'desktop'} hasPage={hasPage} historyCount={historyCount}
    preferences={preferences} privateMode={privateMode} currentSite="https://example.org/field-notes"
    onBack={() => {}} onPrivateModeChange={setPrivateMode}
    onSearchChange={next => {
      localStorage.setItem(BROWSER_KEYS.search, next)
      setSearch(next)
    }}
    onAddressPositionChange={next => {
      localStorage.setItem(BROWSER_KEYS.addressPosition, next ? 'bottom' : 'top')
      setBottomAddress(next)
    }}
    onPreferencesChange={async next => {
      const saved = privateMode ? { ...next } : saveBrowserPreferences(next)
      setPreferences(saved)
      return true
    }}
    onDesktopChange={() => {
      const saved = saveBrowserPreferences({ ...preferences, userAgentMode: preferences.userAgentMode === 'desktop' ? 'system' : 'desktop' })
      setPreferences(saved)
    }}
    onClearHistory={() => { localStorage.removeItem(BROWSER_KEYS.history); setHistoryCount(0) }}
    onClearSiteData={() => setHasPage(false)}
  />
}

// Deterministic in-memory raster specimens exercise the real bounded image loader.
// They never depend on third-party hosts or export an image outside this fixture.
const imageSpecimens = [
  { title: '湖畔晨光', width: 1440, height: 960, colors: ['#e8dbc4', '#d5a36e', '#809990', '#3e6467'] },
  { title: '城市与街巷', width: 1080, height: 1440, colors: ['#ddd5c9', '#d59a7c', '#777f8a', '#3d4859'] },
  { title: '植物的纹理', width: 1200, height: 1200, colors: ['#e2e5cd', '#d5ba74', '#92a076', '#536b50'] },
  { title: '暮色山脊', width: 1600, height: 900, colors: ['#ded5e3', '#dea99b', '#9798af', '#565977'] },
  { title: '海岸与风', width: 1440, height: 1080, colors: ['#d6e5e5', '#ead6a6', '#84afb4', '#4f7e90'] },
  { title: '旅途中的一页', width: 1000, height: 1400, colors: ['#e9dfcf', '#c9ab7f', '#ac947c', '#745e57'] },
  { title: '网页背景纹样', width: 900, height: 600, colors: ['#e7ddd0', '#cda66b', '#91a29d', '#5a7d76'] },
  { title: '站点标记', width: 192, height: 192, colors: ['#dce0e6', '#bbc5d1', '#8a9bb1', '#4e6381'] },
]
const imageSnapshot: BrowserImageSnapshot = {
  tabId: 7, documentId: 'visual-document', requestId: 'visual-scan',
  pageUrl: 'https://example.org/visual-journal', truncated: false, inaccessibleFrames: 1,
  items: imageSpecimens.map((specimen, index) => ({
    id: 'specimen-' + index, sourceUrl: 'https://example.org/image-' + index + '.png',
    pageUrl: 'https://example.org/visual-journal', alt: specimen.title,
    width: specimen.width, height: specimen.height, kinds: [index === 6 ? 'background' : 'img'],
    content: index < 6, transport: 'http',
  })),
}
const specimenData = new Map<string, Omit<BrowserImageData, 'tabId' | 'documentId' | 'requestId' | 'imageId'>>()
if (scenario.includes('images')) {
  imageSpecimens.forEach((specimen, index) => {
    const canvas = document.createElement('canvas')
    canvas.width = Math.min(specimen.width, 720)
    canvas.height = Math.round(canvas.width * specimen.height / specimen.width)
    const context = canvas.getContext('2d')!
    const width = canvas.width, height = canvas.height
    context.fillStyle = specimen.colors[0]
    context.fillRect(0, 0, width, height)
    context.fillStyle = specimen.colors[1]
    context.beginPath()
    context.arc(width * .72, height * .25, width * .12, 0, Math.PI * 2)
    context.fill()
    for (const layer of [2, 3]) {
      context.fillStyle = specimen.colors[layer]
      context.beginPath()
      context.moveTo(0, height * (.49 + layer * .055))
      for (let peak = 0; peak <= 6; peak++) {
        const x = width * peak / 6
        const y = height * (.44 + layer * .09 + Math.sin(peak * 1.6 + index + layer) * .12)
        context.lineTo(x, y)
      }
      context.lineTo(width, height)
      context.lineTo(0, height)
      context.closePath()
      context.fill()
    }
    context.globalAlpha = .28
    context.strokeStyle = specimen.colors[0]
    context.lineWidth = 2
    for (let line = 0; line < 7; line++) {
      const y = height * (.77 + line * .025)
      context.beginPath()
      context.moveTo(width * .12, y)
      context.lineTo(width * (.54 + line * .04), y)
      context.stroke()
    }
    const dataUrl = canvas.toDataURL('image/png')
    specimenData.set('specimen-' + index, { dataUrl, mimeType: 'image/png',
      byteLength: atob(dataUrl.split(',')[1]).length, width, height, reduced: true })
  })
}
async function loadSpecimenImage(request: BrowserImageLoadRequest): Promise<BrowserImageData> {
  const data = specimenData.get(request.imageId)
  if (!data) throw new Error('找不到测试图片')
  return { ...data, tabId: request.tabId, documentId: request.documentId,
    requestId: request.requestId, imageId: request.imageId }
}
function ThemeImagesFixture() {
  const [snapshot, setSnapshot] = useState(imageSnapshot)
  return <BrowserImagesPanel snapshot={snapshot} scanning={false} error={null}
    privateMode={scenario === 'theme-private-images'}
    onScan={() => setSnapshot({ ...imageSnapshot, requestId: 'visual-rescan-' + Date.now() })}
    onClose={() => {}} loadImage={loadSpecimenImage} cancelImageRequests={async () => {}}
  />
}
const privateContext: BrowserContext = {
  privateMode: true, settings: { ...DEFAULT_BROWSER_PREFERENCES },
  ui: { search: 'bing', bottomAddress: true },
  privacyCapabilities: { privateMode: true, clearSiteData: false },
}

export function Fixture() {
  const [open, setOpen] = useState(false)
  const [confirm, setConfirm] = useState(false)
  useEffect(() => {
    window.__focusFixtureReady = true
    window.__dismissDialog = () => { setConfirm(false); setOpen(false) }
  }, [])

  if (scenario.startsWith('player-')) return <FloatingVideoProvider>
    <button id="opener" onClick={() => setOpen(true)}>打开测试播放器</button>
    <button id="background">背景操作</button>
    {open && <PlayerFixture onClose={() => setOpen(false)} />}
  </FloatingVideoProvider>

  if (scenario.startsWith('theme-')) return <>
    <div className="bg-cinnabar/10" data-outside-browser>
      <svg className="lucide" fill="none"><circle cx="8" cy="8" r="6" /></svg>
    </div>
    <div className="browser-workspace fixed inset-0 bg-ink text-paper">
      {scenario === 'theme-settings' ? <ThemeSettingsFixture />
        : scenario === 'theme-home' || scenario === 'theme-private-home'
          ? <BrowserWorkspace onExit={() => {}} privateContext={scenario === 'theme-private-home' ? privateContext : undefined}/>
          : scenario === 'theme-images' || scenario === 'theme-private-images'
            ? <ThemeImagesFixture />
            : <BrowserTabsPanel
              tabs={[
                { index: 0, id: 1, title: '山野行记：在湖边停留的一个下午', url: 'https://example.org/field-notes', active: false, loading: false },
                { index: 1, id: 2, title: '建筑与城市之间的日常观察', url: 'https://example.com/architecture', active: true, loading: false },
              ]}
              pending={false} onBack={() => {}} onSelect={() => {}} onRemove={() => {}} onNew={() => {}}
            />}
    </div>
  </>

  return <>
    <button id="opener" onClick={() => setOpen(true)}>打开测试弹层</button>
    <button id="background">背景操作</button>
    {scenario === 'settings' && <BrowserSettingsPanel
      search="bing" bottomAddress={false} desktop={false} hasPage pending historyCount={0}
      onBack={() => {}} onSearchChange={() => {}} onAddressPositionChange={() => {}}
      onDesktopChange={() => { window.__desktopChanges++ }} onClearHistory={() => {}}
    />}
    {open && scenario === 'workspace' && <BrowserWorkspace onExit={() => setOpen(false)} />}
    {open && scenario === 'scripts' && <ScriptManager onClose={() => setOpen(false)} onChanged={() => {}} />}
    {open && scenario !== 'scripts' && scenario !== 'settings' && scenario !== 'workspace' && <BrowserSheet title="测试弹层" onClose={() => setOpen(false)}>
      <button id="first">第一个操作</button>
      <button id="disabled" disabled>禁用操作</button>
      <button id="hidden" hidden>隐藏操作</button>
      {scenario === 'autofocus' && <input id="autofocus" aria-label="自动聚焦输入框" autoFocus />}
      <button id="last" onClick={() => setConfirm(true)}>打开确认</button>
    </BrowserSheet>}
    {open && confirm && <BrowserSheet title="叠加确认" onClose={() => setConfirm(false)}>
      <button id="cancel" onClick={() => setConfirm(false)}>取消确认</button>
      <button id="confirm" onClick={() => setConfirm(false)}>确认操作</button>
    </BrowserSheet>}
  </>
}

createRoot(document.getElementById('root')!).render(<StrictMode><Fixture /></StrictMode>)
