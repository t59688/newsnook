import { useEffect, useState } from 'react'
import { App as CapacitorApp } from '@capacitor/app'
import { Shield } from 'lucide-react'
import { BrowserWorkspace } from './BrowserWorkspace'
import { getBrowserContext, closePrivateBrowser } from './useBrowserSession'
import { applyBrowserAppearance, type BrowserContext } from './browserPrivacy'
import { dismissTopHardwareBackLayer } from '../../lib/hardwareBackStack'
import { applyNativeChrome } from '../../lib/nativeChrome'
import { FloatingVideoProvider } from '../floatingVideo/FloatingVideoProvider'

let contextRequest: Promise<BrowserContext> | undefined
function readContext() { return contextRequest ??= getBrowserContext() }
function removeStartupCover() {
  document.getElementById('boot-splash')?.remove()
  delete document.documentElement.dataset.boot
  delete document.documentElement.dataset.bootSplash
}

/** Private activity boot must never hydrate ordinary preferences, accounts or recovery data. */
export function PrivateBrowserRoot() {
  const [context, setContext] = useState<BrowserContext | null>(null)
  const [error, setError] = useState('')
  const [closing, setClosing] = useState(false)
  const finish = () => {
    setClosing(true)
    void closePrivateBrowser().catch(() => {setClosing(false); setError('关闭失败，请重试')})
  }
  useEffect(() => {
    let live = true
    void readContext().then(result => {
      if (!live) return
      if (!result.privateMode) throw new Error('未建立隔离会话，请返回后重新开启隐私模式')
      applyBrowserAppearance(result.appearance)
      document.documentElement.dataset.browserPrivate = 'true'
      removeStartupCover()
      void applyNativeChrome(result.appearance?.theme ?? 'dark')
      setContext(result)
    }).catch(failure => {
      if (!live) return
      removeStartupCover()
      setError(failure instanceof Error ? failure.message : '无法开启隐私会话')
    })
    const handler = CapacitorApp.addListener('backButton', () => {
      if (!dismissTopHardwareBackLayer()) finish()
    })
    return () => {live = false; void handler.then(handle => handle.remove())}
  }, [])
  if (error || closing || !context) return <main className="fixed inset-0 flex flex-col items-center justify-center bg-ink px-7 text-center text-paper">
    <Shield size={34} strokeWidth={1.5} className="text-paper-muted"/>
    <h1 className="mt-5 text-[20px] font-semibold">{closing ? '正在关闭隐私会话' : '隐私浏览'}</h1>
    {error && <p role="alert" className="mt-3 text-[14px] leading-relaxed text-paper-muted">{error}</p>}
    {error && <button type="button" onClick={finish} className="mt-6 min-h-12 rounded-xl bg-paper px-7 text-[15px] font-medium text-ink">返回浏览器</button>}
  </main>
  return <FloatingVideoProvider><BrowserWorkspace privateContext={context} onExit={finish}/></FloatingVideoProvider>
}
