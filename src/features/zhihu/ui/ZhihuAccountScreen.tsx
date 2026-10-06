import { useCallback, useEffect, useState } from 'react'
import { Bookmark, ChevronRight, FilePenLine, LogIn, RefreshCw, RotateCcw, ShieldCheck, Trash2, UserRound, UserRoundPlus } from 'lucide-react'

import { ConfirmDialog } from '../../../components/ConfirmDialog'

import type { ZhihuRuntime } from '../runtime'
import type { ZhihuSessionSnapshot, ZhihuStoredAccount } from '../session/types'

interface Props {
  runtime: ZhihuRuntime
  onOpenEditor: () => void
  onOpenProfile: (urlToken: string) => void
  onOpenCollections: (urlToken: string) => void
  onResetRecommendation: () => Promise<void> | void
}

export function ZhihuAccountScreen({ runtime, onOpenEditor, onOpenProfile, onOpenCollections, onResetRecommendation }: Props) {
  const [snapshot, setSnapshot] = useState<ZhihuSessionSnapshot>(() => runtime.session.getSnapshot())
  const [accounts, setAccounts] = useState<ZhihuStoredAccount[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [confirmResetRecommendation, setConfirmResetRecommendation] = useState(false)
  const [recommendationReset, setRecommendationReset] = useState(false)

  const reloadAccounts = useCallback(async () => {
    setAccounts(await runtime.account.listAccounts())
  }, [runtime])

  useEffect(() => runtime.session.subscribe(setSnapshot), [runtime])
  useEffect(() => {
    // ZhihuWorkspace 负责整个站点生命周期内唯一一次 hydrate；账号页只读取已落盘账号。
    // 这里再次校验会和首页请求并发，网络抖动时曾把已恢复的账号误标成失效。
    let alive = true
    void reloadAccounts().catch((cause) => {
      if (alive) setError(cause instanceof Error ? cause.message : '读取知乎账号失败')
    })
    return () => { alive = false }
  }, [reloadAccounts])

  const authenticate = async () => {
    setBusy(true)
    setError(null)
    try {
      await runtime.account.authenticate()
      await reloadAccounts()
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      if (!message.includes('ZH_AUTH_CANCELLED')) setError(message)
    } finally {
      setBusy(false)
    }
  }

  const addAccount = async () => {
    setBusy(true)
    setError(null)
    try {
      await runtime.account.addAccount()
      await reloadAccounts()
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      if (!message.includes('ZH_AUTH_CANCELLED')) setError(message)
    } finally {
      setBusy(false)
    }
  }

  const switchAccount = async (accountId: string) => {
    if (accountId === snapshot.account?.id) return
    setBusy(true)
    setError(null)
    try {
      await runtime.account.switchAccount(accountId)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '账号切换失败')
    } finally {
      setBusy(false)
    }
  }

  const resetRecommendation = async () => {
    setBusy(true)
    setError(null)
    try {
      await onResetRecommendation()
      setRecommendationReset(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '重置智能推荐失败')
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    setBusy(true)
    setError(null)
    try {
      await runtime.account.removeCurrentAccount()
      await reloadAccounts()
    } finally {
      setBusy(false)
    }
  }

  const active = accounts.find((item) => item.account.id === snapshot.account?.id)
  const authenticated = snapshot.auth === 'authenticated' && Boolean(snapshot.account)
  const hasStoredAccount = Boolean(active || snapshot.account)
  const activeToken = active?.account.urlToken || snapshot.account?.urlToken || snapshot.account?.id

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pb-28 pt-5 sm:px-6">
      <section className="overflow-hidden rounded-3xl border border-haze/50 bg-gradient-to-b from-ink-raised/60 to-ink-raised/25 shadow-[0_8px_24px_-12px_rgba(0,0,0,0.5)]">
        <div className="flex items-start gap-4 p-4.5 sm:p-5">
          {active?.account.avatarUrl || snapshot.account?.avatarUrl ? (
            <img src={active?.account.avatarUrl || snapshot.account?.avatarUrl} alt="" className="size-15 rounded-2xl border border-haze/60 object-cover shadow-sm" referrerPolicy="no-referrer" />
          ) : (
            <div className="flex size-15 items-center justify-center rounded-2xl border border-haze/60 bg-ink-deep text-paper-muted"><UserRound size={25} strokeWidth={1.5} /></div>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <h1 className="truncate font-sans text-[20px] font-bold text-paper">
                {active?.account.name || snapshot.account?.name || '知乎账号'}
              </h1>
              {authenticated && <ShieldCheck size={16} strokeWidth={1.8} className="shrink-0 text-sky-500" />}
            </div>
            <p className="mt-1 text-[12px] leading-relaxed text-paper-muted">
              {snapshot.auth === 'verification-required'
                ? `${active?.account.headline || '账号资料已保存在本机'} · 需要完成知乎安全验证`
                : snapshot.auth === 'expired'
                  ? `${active?.account.headline || '账号资料已保存在本机'} · 登录会话已过期，请重新认证`
                  : authenticated
                    ? active?.account.headline || '已登录知乎'
                    : '登录与注册在知乎第一方页面完成，NewsNook 不读取密码。'}
            </p>
          </div>
        </div>

        {error && <div role="alert" className="mx-4 mb-3 rounded-xl border border-cinnabar/30 bg-cinnabar/8 px-3.5 py-2.5 text-[11.5px] leading-relaxed text-paper-muted">{error}</div>}

        <div className="border-t border-haze/45 px-3 py-2.5">
          <button
            type="button"
            disabled={busy || !runtime.account.isNativeAuthAvailable()}
            onClick={() => void authenticate()}
            className="flex min-h-11 w-full items-center gap-3 rounded-xl px-2.5 text-left transition-colors hover:bg-paper/5 active:scale-[0.99] disabled:opacity-45"
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-sky-500/12 text-sky-500">
              {busy ? <RefreshCw size={15} className="animate-spin" /> : hasStoredAccount ? <RefreshCw size={15} /> : <LogIn size={15} />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13.5px] font-semibold text-paper">{hasStoredAccount ? '重新验证知乎账号' : '登录 / 注册知乎'}</span>
              <span className="mt-0.5 block text-[11px] text-paper-faint">{hasStoredAccount ? '刷新当前会话并确认账号状态' : '使用知乎第一方登录页'}</span>
            </span>
            <ChevronRight size={15} strokeWidth={1.5} className="text-paper-faint" />
          </button>
        </div>
      </section>

      {authenticated && (
        <section className="mt-4 overflow-hidden rounded-2xl border border-haze/50 bg-ink-raised/35 shadow-[var(--shadow-lift)]">
          {[
            { label: '创作与草稿', hint: '继续草稿、写回答与发布想法', icon: <FilePenLine size={16} />, action: onOpenEditor },
            { label: '我的主页', hint: '回答、文章、动态与关注关系', icon: <UserRound size={16} />, action: () => activeToken && onOpenProfile(activeToken), disabled: !activeToken },
            { label: '我的收藏夹', hint: '查看与管理知乎收藏夹', icon: <Bookmark size={16} />, action: () => activeToken && onOpenCollections(activeToken), disabled: !activeToken },
          ].map((item, index) => (
            <button
              key={item.label}
              type="button"
              disabled={busy || item.disabled}
              onClick={item.action}
              className={`flex min-h-14 w-full items-center gap-3 px-4 text-left transition-colors hover:bg-paper/5 disabled:opacity-45 ${index > 0 ? 'border-t border-haze/55' : ''}`}
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-paper/5 text-paper-muted">{item.icon}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium text-paper">{item.label}</span>
                <span className="mt-0.5 block text-[10.5px] text-paper-faint">{item.hint}</span>
              </span>
              <ChevronRight size={15} strokeWidth={1.5} className="text-paper-faint" />
            </button>
          ))}
        </section>
      )}

      <section className="mt-4 overflow-hidden rounded-2xl border border-haze/70 bg-ink-raised/35">
        <button
          type="button"
          disabled={busy}
          onClick={() => setConfirmResetRecommendation(true)}
          className="flex min-h-14 w-full items-center gap-3 px-4 text-left transition-colors hover:bg-paper/5 disabled:opacity-45"
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-paper/5 text-paper-muted">
            <RotateCcw size={16} strokeWidth={1.6} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-medium text-paper">重置智能推荐</span>
            <span className="mt-0.5 block text-[10.5px] leading-relaxed text-paper-faint">只清除本机知乎兴趣、曝光与反馈画像，并立即重新生成推荐</span>
          </span>
          <ChevronRight size={15} strokeWidth={1.5} className="text-paper-faint" />
        </button>
      </section>
      {recommendationReset && (
        <p role="status" className="mt-2 px-1 text-[10.5px] leading-relaxed text-paper-faint">智能推荐画像已重置；知乎账号、收藏、草稿与 NewsNook 新闻阅读记录均未改变。</p>
      )}

      {accounts.length > 0 && (
        <section className="mt-4">
          <div className="mb-2 flex items-center justify-between px-1">
            <h2 className="font-display text-[15px] font-medium text-paper">账号</h2>
            {authenticated && (
              <button
                type="button"
                disabled={busy || !runtime.account.isNativeAuthAvailable()}
                onClick={() => void addAccount()}
                aria-label="添加知乎账号"
                title="添加知乎账号"
                className="flex size-9 items-center justify-center rounded-lg text-paper-faint transition-colors hover:bg-paper/5 hover:text-cinnabar-soft disabled:opacity-40"
              >
                <UserRoundPlus size={16} strokeWidth={1.6} />
              </button>
            )}
          </div>
          <div className="overflow-hidden rounded-2xl border border-haze/70 bg-ink-raised/35">
            {accounts.map((item, index) => {
              const currentAccount = item.account.id === snapshot.account?.id
              return (
                <button
                  key={item.account.id}
                  type="button"
                  disabled={busy}
                  onClick={() => void switchAccount(item.account.id)}
                  className={`flex min-h-14 w-full items-center gap-3 px-4 text-left transition-colors hover:bg-paper/5 ${index > 0 ? 'border-t border-haze/55' : ''}`}
                >
                  {item.account.avatarUrl ? <img src={item.account.avatarUrl} alt="" className="size-9 rounded-xl object-cover" /> : <span className="flex size-9 items-center justify-center rounded-xl bg-paper/5"><UserRound size={16} className="text-paper-muted" /></span>}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-medium text-paper">{item.account.name || item.account.urlToken || item.account.id}</span>
                    <span className="mt-0.5 block truncate text-[10px] text-paper-faint">{item.account.headline || item.account.urlToken || item.account.id}</span>
                  </span>
                  {currentAccount ? <span className="font-mono text-[9.5px] tracking-[0.08em] text-cinnabar-soft">当前</span> : <ChevronRight size={14} className="text-paper-faint" />}
                </button>
              )
            })}
          </div>
        </section>
      )}

      {snapshot.account && (
        <button
          type="button"
          disabled={busy}
          onClick={() => setConfirmRemove(true)}
          className="mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-haze/70 text-[11.5px] text-paper-faint transition-colors hover:border-cinnabar/30 hover:bg-cinnabar/5 hover:text-cinnabar-soft disabled:opacity-40"
        >
          <Trash2 size={14} strokeWidth={1.6} />
          <span>从本机移除当前账号</span>
        </button>
      )}

      {!runtime.account.isNativeAuthAvailable() && (
        <p className="mt-4 text-center font-mono text-[10px] leading-relaxed text-paper-faint">知乎账号登录仅在 NewsNook Android 应用中提供。</p>
      )}

      <ConfirmDialog
        open={confirmResetRecommendation}
        title="重置智能推荐"
        message="将清除当前知乎账号（未登录时为访客）的本机推荐画像，包括阅读偏好、曝光记录和“不感兴趣”反馈。不会删除知乎账号、收藏、草稿或 NewsNook 的新闻阅读数据。"
        confirmLabel="重置"
        cancelLabel="取消"
        onCancel={() => setConfirmResetRecommendation(false)}
        onConfirm={() => { setConfirmResetRecommendation(false); void resetRecommendation() }}
      />

      <ConfirmDialog
        open={confirmRemove}
        title="移除知乎账号"
        message="只会删除 NewsNook 本机保存的知乎会话，不会注销或删除知乎账号。"
        confirmLabel="移除"
        cancelLabel="取消"
        danger
        onCancel={() => setConfirmRemove(false)}
        onConfirm={() => { setConfirmRemove(false); void remove() }}
      />
    </div>
  )
}
