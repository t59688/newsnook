import { Capacitor } from '@capacitor/core'
import { BadgeCheck, Bookmark, ChevronRight, FileText, History, KeyRound, Loader2, LockKeyhole, ShieldCheck, UserRound } from 'lucide-react'
import { useState } from 'react'

import { linuxDoCapabilities } from '../capabilities'
import { linuxDoApi as api } from '../runtime'
import {
  authenticateLinuxDo,
  cancelLinuxDoAuthentication,
  clearLinuxDoBrowserSession,
  clearLinuxDoSession,
  verifyLinuxDoBrowserSession,
} from '../session/native'
import { loginLinuxDoWithPassword } from '../session/password'
import type { LinuxDoSessionSnapshot } from '../types'
import { avatar, readableError } from './utils'

export function AccountView({
  session,
  onSession,
  onBookmarks,
  onProfile,
  onTrustLevel,
}: {
  session: LinuxDoSessionSnapshot
  onSession: (next: LinuxDoSessionSnapshot) => void
  onBookmarks: () => void
  onProfile: (username: string) => void
  onTrustLevel: () => void
}) {
  const caps = linuxDoCapabilities()
  const native = Capacitor.isNativePlatform()
  const [accountError, setAccountError] = useState('')
  const [signingIn, setSigningIn] = useState(false)
  const [thirdPartySigningIn, setThirdPartySigningIn] = useState(false)

  const applySession = (next: LinuxDoSessionSnapshot) => {
    api.setSession(next)
    onSession(next)
  }

  const passwordLogin = async () => {
    if (!native || signingIn) return
    setAccountError('')
    setSigningIn(true)
    try {
      applySession(await loginLinuxDoWithPassword())
    } catch (error) {
      setAccountError(readableError(error))
    } finally {
      setSigningIn(false)
    }
  }

  const openThirdPartyLogin = async () => {
    if (!native || thirdPartySigningIn) return
    setAccountError('')
    setThirdPartySigningIn(true)
    try {
      applySession(await authenticateLinuxDo())
    } catch (error) {
      const code = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code?: unknown }).code ?? '') : ''
      if (code !== 'LINUXDO_USER_API_CANCELLED') setAccountError(readableError(error))
    } finally {
      setThirdPartySigningIn(false)
    }
  }

  const cancelThirdPartyLogin = async () => {
    try {
      await cancelLinuxDoAuthentication()
    } finally {
      setThirdPartySigningIn(false)
      setAccountError('')
    }
  }

  const verifyBrowser = async () => {
    setAccountError('')
    try {
      const next = await verifyLinuxDoBrowserSession('https://linux.do/')
      applySession(next)
      setAccountError(next.authenticated ? '浏览器会话已登录；阅读记录是否同步成功仍以提交结果为准。' : '浏览器会话尚未登录，请先登录 Linux.do。')
    } catch (error) {
      setAccountError(readableError(error))
    }
  }

  const logout = async () => {
    await Promise.all([clearLinuxDoSession(), clearLinuxDoBrowserSession()])
    applySession({ authenticated: false, authMode: 'none' })
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto page-x pb-4 pt-5">
      <section className="mb-4 overflow-hidden rounded-[28px] border border-haze/70 bg-ink-raised p-5 shadow-md">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-cinnabar/10 px-3 py-1 text-[10px] font-semibold text-cinnabar"><ShieldCheck size={12} />第一方安全登录</div>
            <h2 className="mt-3 text-[22px] font-bold tracking-[-0.03em] text-paper">{session.authenticated ? '欢迎回来' : '登录 Linux.do'}</h2>
            <p className="mt-1.5 max-w-sm text-[11px] leading-5 text-paper-muted">{session.authenticated ? '当前会话只保存在设备的 Linux.do 第一方会话中。' : '密码、人机验证与二次验证全部在 Linux.do 官方页面完成，NewsNook 不读取也不保存密码。'}</p>
          </div>
          <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-cinnabar/10 text-cinnabar"><LockKeyhole size={25} /></div>
        </div>
      </section>

      <section className="rounded-[24px] border border-haze/70 bg-ink-raised p-5 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full border border-haze bg-ink-deep">
            {session.authenticated ? (
              avatar(session.currentUser?.avatarTemplate, session.currentUser?.name || session.currentUser?.username)
            ) : (
              <UserRound size={26} strokeWidth={1.5} className="text-paper-muted" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[17px] font-semibold text-paper">{session.authenticated ? session.currentUser?.name || session.currentUser?.username : '未登录'}</div>
            <div className="mt-1 text-[11px] text-paper-faint">{session.authenticated ? '@' + session.currentUser?.username + ' · 第一方会话' : '使用 Linux.do 账号登录 App'}</div>
          </div>
        </div>

        {!session.authenticated ? (
          <div className="mt-5">
            <button type="button" disabled={!native || signingIn} onClick={() => void passwordLogin()} className="linuxdo-control inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-cinnabar px-4 py-3 text-[12.5px] font-semibold text-white shadow-lg disabled:opacity-45">{signingIn ? <Loader2 size={15} className="animate-spin" /> : <KeyRound size={15} />}{signingIn ? '等待官方页面登录完成…' : native ? '账号密码登录（Linux.do 官方页面）' : '请在 App 中登录'}</button>
            <p className="mt-2 text-[9.5px] leading-4 text-paper-faint">支持 Cloudflare、人机验证、动态验证码、备用码与 Passkey。登录成功后点官方页面上方的“完成”。</p>

            <div className="my-5 flex items-center gap-3"><span className="h-px flex-1 bg-haze" /><span className="text-[9.5px] text-paper-faint">第三方账号</span><span className="h-px flex-1 bg-haze" /></div>
            <button type="button" disabled={!native || thirdPartySigningIn} onClick={() => void openThirdPartyLogin()} className="linuxdo-control min-h-11 w-full rounded-xl border border-haze bg-ink-raised px-4 text-[11.5px] font-medium text-paper-muted disabled:opacity-45">{thirdPartySigningIn ? '等待 Linux.do 授权完成…' : 'GitHub / Google 等第三方登录（系统浏览器）'}</button>
            <p className="mt-2 text-[9.5px] leading-4 text-paper-faint">系统浏览器完成 Linux.do 官方授权后会自动返回 NewsNook，并用一次性凭据建立第一方会话；浏览器 Cookie 不会被读取。</p>
            {thirdPartySigningIn ? <div className="mt-2 rounded-xl bg-ink-deep px-3 py-2"><p className="text-[9.5px] leading-4 text-paper-muted">登录后请继续确认“授权 NewsNook”。返回 App 后会自动完成安全会话兑换。</p><button type="button" onClick={() => void cancelThirdPartyLogin()} className="linuxdo-control mt-2 text-[9.5px] font-medium text-cinnabar">取消第三方登录</button></div> : null}
          </div>
        ) : (
          <div className="mt-5">
            <button type="button" onClick={() => void logout()} className="linuxdo-control min-h-11 w-full rounded-xl border border-haze px-4 text-[11.5px] text-paper-muted">退出账号</button>
          </div>
        )}

        <div className="mt-4 border-t border-haze/70 pt-3">
          <button type="button" onClick={() => void verifyBrowser()} className="linuxdo-control text-[9.5px] text-paper-faint underline decoration-haze underline-offset-4">打开 Linux.do 登录页面</button>
          <span className="mx-2 text-paper-faint">·</span>
          <button type="button" onClick={async () => { await clearLinuxDoBrowserSession(); setAccountError('') }} className="linuxdo-control text-[9.5px] text-paper-faint underline decoration-haze underline-offset-4">清除验证数据</button>
        </div>
        {accountError ? <button type="button" onClick={() => setAccountError('')} className="mt-3 w-full rounded-xl border border-cinnabar/20 bg-cinnabar/[0.06] px-3 py-2 text-left text-[10.5px] leading-5 text-cinnabar">{accountError} · 点击关闭</button> : null}
      </section>

      <div className="mt-4 grid grid-cols-2 gap-2.5">
        <button type="button" disabled={!session.authenticated} onClick={onTrustLevel} className="linuxdo-control col-span-2 flex items-center gap-3 rounded-[20px] border border-[#20c36b]/20 bg-[#20c36b]/[0.055] px-4 py-3.5 text-left shadow-sm transition-colors hover:bg-[#20c36b]/[0.085] disabled:opacity-45">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#20c36b]/12 text-[#20c36b]"><BadgeCheck size={18} /></span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2"><span className="text-[11.5px] font-semibold text-paper">信任等级</span>{session.currentUser?.trustLevel !== undefined ? <span className="rounded-full bg-paper/[0.05] px-2 py-0.5 font-mono text-[8.5px] font-semibold text-paper-faint">TL{session.currentUser.trustLevel}</span> : null}</span>
            <span className="mt-1 block truncate text-[9.5px] text-paper-faint">查看升级要求与当前达成情况</span>
          </span>
          <ChevronRight size={15} className="shrink-0 text-paper-faint" />
        </button>
        <button type="button" onClick={onBookmarks} className="linuxdo-control rounded-[20px] border border-haze/70 bg-ink-raised px-3.5 py-3.5 text-left shadow-sm"><Bookmark size={18} className="mb-2 text-[#f5b326]" /><div className="text-[11.5px] font-semibold text-paper">书签</div><div className="mt-1 text-[9.5px] text-paper-faint">{caps.bookmarks ? '查看收藏的楼层与主题' : '不可用'}</div></button>
        <button type="button" disabled={!session.currentUser?.username} onClick={() => session.currentUser?.username && onProfile(session.currentUser.username)} className="linuxdo-control rounded-[20px] border border-haze/70 bg-ink-raised px-3.5 py-3.5 text-left shadow-sm disabled:opacity-50"><UserRound size={18} className="mb-2 text-cinnabar" /><div className="text-[11.5px] font-semibold text-paper">个人主页</div><div className="mt-1 text-[9.5px] text-paper-faint">主题、活动、Boost 与统计</div></button>
        <div className="rounded-[20px] border border-haze/70 bg-ink-raised px-3.5 py-3.5 shadow-sm"><FileText size={18} className="mb-2 text-[#7b61ff]" /><div className="text-[11.5px] font-semibold text-paper">草稿</div><div className="mt-1 text-[9.5px] text-paper-faint">{caps.drafts ? '自动保存与恢复已启用' : '不可用'}</div></div>
        <div className="rounded-[20px] border border-haze/70 bg-ink-raised px-3.5 py-3.5 shadow-sm"><History size={18} className="mb-2 text-[#2ab66f]" /><div className="text-[11.5px] font-semibold text-paper">媒体与附件</div><div className="mt-1 text-[9.5px] text-paper-faint">{caps.uploads ? '原生上传与图片预览已启用' : '不可用'}</div></div>
      </div>
      {!caps.boost.available ? <p className="mt-4 rounded-[18px] border border-haze/50 bg-ink-raised px-4 py-3 text-[10.5px] leading-5 text-paper-faint">{caps.boost.reason}</p> : null}
    </div>
  )
}
