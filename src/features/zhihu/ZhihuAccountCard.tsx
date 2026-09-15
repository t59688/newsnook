import { useCallback, useEffect, useState } from 'react'
import { LogIn, LogOut, RefreshCw, ShieldCheck } from 'lucide-react'

import { clearZhihuSession, loginZhihu, readZhihuSession } from './session'
import { fetchZhihuProfile } from './service'
import { isZhihuAuthAvailable } from './native'
import type { ZhihuProfile } from './types'

export function ZhihuAccountCard() {
  const [profile, setProfile] = useState<ZhihuProfile | undefined>()
  const [signedIn, setSignedIn] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const available = isZhihuAuthAvailable()

  const refresh = useCallback(async () => {
    const session = await readZhihuSession()
    setSignedIn(Boolean(session))
    if (!session) { setProfile(undefined); return }
    try { setProfile(await fetchZhihuProfile()) }
    catch { setProfile(undefined) }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const login = async () => {
    setBusy(true); setMessage('')
    try {
      await loginZhihu()
      await refresh()
      setMessage('登录状态已保存在本机安全存储')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '知乎登录失败')
    } finally { setBusy(false) }
  }

  const logout = async () => {
    setBusy(true)
    try {
      await clearZhihuSession(); setSignedIn(false); setProfile(undefined); setMessage('已清除本机知乎登录状态')
    } finally { setBusy(false) }
  }

  return (
    <div className="page-x lg:px-8 pt-8">
      <div className="flex items-center gap-3 pb-2">
        <span className="font-mono text-[10px] tracking-[0.28em] text-paper-faint">第三方站点</span>
        <span className="h-px flex-1 bg-haze" aria-hidden />
      </div>
      <div className="border-y border-haze bg-ink px-4 py-4 md:rounded-sm md:border">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-full border border-haze bg-ink-raised">
            <span className="font-display text-[17px] text-paper">知</span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="text-[14px] font-medium text-paper">知乎</p>
              {signedIn && <ShieldCheck size={14} className="text-cinnabar" aria-label="已安全登录" />}
            </div>
            <p className="mt-0.5 text-[11px] leading-relaxed text-paper-faint">
              {!available ? '知乎主站能力仅在 Android App 可用' : signedIn ? `${profile?.name || '已登录'}${profile?.headline ? ` · ${profile.headline}` : ''}` : '登录后可读推荐流、评论、搜索并发布或编辑回答'}
            </p>
            <p className="mt-1 font-mono text-[9px] text-paper-faint">Cookie 仅存 Android KeyStore，不参与云同步</p>
          </div>
        </div>
        {message && <p className="mt-3 rounded-sm bg-ink-raised px-3 py-2 text-[11px] text-paper-muted">{message}</p>}
        {available && (
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={login} className="inline-flex items-center gap-2 rounded-sm border border-haze bg-ink-raised px-3 py-2 text-[12px] text-paper transition hover:border-paper-faint disabled:opacity-50">
              {signedIn ? <RefreshCw size={14} /> : <LogIn size={14} />}{busy ? '处理中…' : signedIn ? '重新验证' : '登录知乎'}
            </button>
            {signedIn && <button type="button" disabled={busy} onClick={logout} className="inline-flex items-center gap-2 rounded-sm px-3 py-2 text-[12px] text-paper-muted transition hover:bg-ink-raised hover:text-paper disabled:opacity-50"><LogOut size={14} />退出</button>}
          </div>
        )}
      </div>
    </div>
  )
}
