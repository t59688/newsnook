import { Capacitor } from '@capacitor/core'
import {
  BadgeCheck,
  Bookmark,
  FileText,
  KeyRound,
  Loader2,
  LockKeyhole,
  Mail,
  ShieldCheck,
  UserRound,
} from 'lucide-react'
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
import type { LinuxDoSessionSnapshot, LinuxDoTopicSummary } from '../types'
import { readableError } from './utils'
import { UserProfileView, type UserProfileTab } from './UserProfileView'
import type { LinuxDoProfileDraft } from '../people/sections'
import type { LinuxDoVerify } from './VerificationAction'

export function AccountView({
  session,
  onSession,
  onBookmarks,
  onProfile,
  onTrustLevel,
  onPrivateMessages,
  onOpenTopic,
  onOpenUser,
  onResumeDraft,
  onVerify,
}: {
  session: LinuxDoSessionSnapshot
  onSession: (next: LinuxDoSessionSnapshot) => void
  onBookmarks: () => void
  onProfile: (username: string, tab?: UserProfileTab) => void
  onTrustLevel: () => void
  onPrivateMessages?: () => void
  onOpenTopic?: (topic: LinuxDoTopicSummary, targetPostNumber?: number) => void
  onOpenUser?: (username: string) => void
  onResumeDraft?: (draft: LinuxDoProfileDraft) => Promise<void>
  onVerify?: LinuxDoVerify
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

  // 已登录状态：直接呈现融合了快捷工具与安全运维的完整个人社区中心
  if (session.authenticated && session.currentUser?.username) {
    return (
      <UserProfileView
        username={session.currentUser.username}
        session={session}
        accountControls={{
          onPrivateMessages: onPrivateMessages || (() => {}),
          onBookmarks,
          onTrustLevel,
          onLogout: logout,
          onVerifyBrowser: verifyBrowser,
          onClearBrowserSession: async () => {
            await clearLinuxDoBrowserSession()
            setAccountError('')
          },
          accountError,
          onClearAccountError: () => setAccountError(''),
          capabilities: caps,
        }}
        onOpenTopic={onOpenTopic || (() => {})}
        onOpenUser={onOpenUser || ((u) => onProfile(u))}
        onResumeDraft={onResumeDraft}
        onVerify={onVerify}
      />
    )
  }

  // 未登录状态：高质感原生社区迎新与安全登录中心
  return (
    <div className="min-h-0 flex-1 overflow-y-auto page-x pb-6 pt-5">
      <section className="mb-4 overflow-hidden rounded-[24px] border border-haze/60 bg-gradient-to-br from-ink-raised via-ink-deep to-ink p-5 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="inline-flex items-center gap-1.5 rounded-full border border-cinnabar/20 bg-cinnabar/10 px-3 py-1 text-[10.5px] font-semibold text-cinnabar">
              <ShieldCheck size={13} />
              <span>第一方安全登录</span>
            </div>
            <h2 className="mt-3 text-[22px] font-bold tracking-tight text-paper sm:text-[24px]">探索 Linux.do 社区</h2>
            <p className="mt-1.5 max-w-sm text-[11.5px] leading-relaxed text-paper-muted">
              连接技术真知与热忱讨论。登录后可畅享私信互动、信任等级追踪、草稿多端续写与专属收藏。
            </p>
          </div>
          <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-cinnabar/10 text-cinnabar">
            <LockKeyhole size={26} />
          </div>
        </div>
      </section>

      <section className="rounded-[24px] border border-haze/60 bg-ink-raised/85 p-5 shadow-sm backdrop-blur-xl">
        <div className="flex items-center gap-3.5">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full border border-haze bg-ink-deep">
            <UserRound size={26} strokeWidth={1.5} className="text-paper-muted" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[17px] font-bold text-paper">Linux.do 访客</div>
            <div className="mt-0.5 text-[11.5px] text-paper-faint">登录以解锁完整社区能力与专属互动</div>
          </div>
        </div>

        <div className="mt-5 space-y-3">
          <button
            type="button"
            disabled={!native || signingIn}
            onClick={() => void passwordLogin()}
            className="linuxdo-control inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-cinnabar px-4 py-3 text-[13px] font-bold text-white shadow-md transition-all hover:bg-cinnabar/90 active:scale-[0.99] disabled:opacity-45"
          >
            {signingIn ? <Loader2 size={16} className="animate-spin" /> : <KeyRound size={16} />}
            <span>{signingIn ? '等待官方页面登录完成…' : native ? '账号密码登录（Linux.do 官方页面）' : '请在 App 中登录'}</span>
          </button>
          <p className="text-[10px] leading-relaxed text-paper-faint">
            官方原生页面承接：支持 Cloudflare 人机验证、动态二次验证码、备用码与 Passkey。登录成功后点官方页面上方的“完成”。
          </p>

          <div className="my-4 flex items-center gap-3">
            <span className="h-px flex-1 bg-haze/60" />
            <span className="text-[10px] font-medium text-paper-faint">第三方授权</span>
            <span className="h-px flex-1 bg-haze/60" />
          </div>

          <button
            type="button"
            disabled={!native || thirdPartySigningIn}
            onClick={() => void openThirdPartyLogin()}
            className="linuxdo-control min-h-11 w-full rounded-xl border border-haze/80 bg-ink-raised px-4 text-[12px] font-medium text-paper-muted transition-colors hover:bg-paper/5 hover:text-paper active:scale-[0.99] disabled:opacity-45"
          >
            {thirdPartySigningIn ? '等待 Linux.do 授权完成…' : 'GitHub / Google 等第三方登录（系统浏览器）'}
          </button>
          <p className="text-[10px] leading-relaxed text-paper-faint">
            系统浏览器完成 Linux.do 官方授权后自动返回，用一次性安全凭据建立第一方会话；浏览器 Cookie 不会被读取。
          </p>

          {thirdPartySigningIn ? (
            <div className="mt-2.5 rounded-xl border border-cinnabar/20 bg-cinnabar/5 p-3">
              <p className="text-[10px] leading-relaxed text-paper-muted">登录后请继续确认“授权 NewsNook”。返回 App 后将自动完成安全会话兑换。</p>
              <button
                type="button"
                onClick={() => void cancelThirdPartyLogin()}
                className="linuxdo-control mt-2 text-[10px] font-semibold text-cinnabar hover:underline"
              >
                取消第三方登录
              </button>
            </div>
          ) : null}
        </div>

        <div className="mt-5 flex items-center justify-between border-t border-haze/60 pt-3.5 text-[10.5px]">
          <button
            type="button"
            onClick={() => void verifyBrowser()}
            className="linuxdo-control text-paper-faint hover:text-paper underline decoration-haze underline-offset-4"
          >
            打开 Linux.do 登录页面
          </button>
          <span className="text-haze">·</span>
          <button
            type="button"
            onClick={async () => {
              await clearLinuxDoBrowserSession()
              setAccountError('')
            }}
            className="linuxdo-control text-paper-faint hover:text-paper underline decoration-haze underline-offset-4"
          >
            清除验证数据
          </button>
        </div>

        {accountError ? (
          <button
            type="button"
            onClick={() => setAccountError('')}
            className="mt-3.5 w-full rounded-xl border border-cinnabar/20 bg-cinnabar/[0.06] p-3 text-left text-[11px] leading-5 text-cinnabar"
          >
            {accountError} · 点击关闭
          </button>
        ) : null}
      </section>

      <section className="mt-4 grid grid-cols-2 gap-2.5">
        <div className="rounded-2xl border border-haze/50 bg-ink-raised/50 p-3.5 shadow-sm">
          <Mail size={16} className="mb-2 text-cinnabar" />
          <div className="text-[12px] font-bold text-paper">个人私信</div>
          <div className="mt-1 text-[10px] leading-relaxed text-paper-faint">登录后即可收发社区私信与归档会话</div>
        </div>
        <button
          type="button"
          onClick={onTrustLevel}
          className="linuxdo-control rounded-2xl border border-[#20c36b]/20 bg-[#20c36b]/[0.05] p-3.5 text-left shadow-sm transition-all hover:bg-[#20c36b]/[0.08]"
        >
          <BadgeCheck size={16} className="mb-2 text-[#20c36b]" />
          <div className="text-[12px] font-bold text-paper">信任等级</div>
          <div className="mt-1 text-[10px] leading-relaxed text-paper-faint">实时追踪 TL 等级升级要求与达成进度</div>
        </button>
        <button
          type="button"
          onClick={onBookmarks}
          className="linuxdo-control rounded-2xl border border-haze/50 bg-ink-raised/50 p-3.5 text-left shadow-sm transition-all hover:bg-ink-raised/70"
        >
          <Bookmark size={16} className="mb-2 text-[#f5b326]" />
          <div className="text-[12px] font-bold text-paper">书签收藏</div>
          <div className="mt-1 text-[10px] leading-relaxed text-paper-faint">收藏精选楼层与深度主题，随时温故</div>
        </button>
        <div className="rounded-2xl border border-haze/50 bg-ink-raised/50 p-3.5 shadow-sm">
          <FileText size={16} className="mb-2 text-[#7b61ff]" />
          <div className="text-[12px] font-bold text-paper">草稿续写</div>
          <div className="mt-1 text-[10px] leading-relaxed text-paper-faint">未完成的灵感自动留存，随时恢复编辑</div>
        </div>
      </section>
    </div>
  )
}
