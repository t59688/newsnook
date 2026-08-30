import { useCallback, useEffect, useMemo, useState } from 'react'
import type { DeviceSummary, SyncBootstrapResponse } from '@newsnook/contracts'
import {
  AlertTriangle,
  BadgeCheck,
  Check,
  CircleAlert,
  CloudDownload,
  CloudOff,
  CloudUpload,
  Eye,
  EyeOff,
  GitMerge,
  Info,
  LoaderCircle,
  LogOut,
  Monitor,
  RefreshCw,
  RotateCcw,
  Smartphone,
} from 'lucide-react'

import { ConfirmDialog } from '../../components/ConfirmDialog'
import { SettingsSection, SettingsShell } from '../../components/SettingsShell'
import { accountScreenModel } from '../../features/account/screenModel'
import type { AccountApi } from '../../features/account/useAccount'
import type { SocialProvider } from '../../features/account/types'
import { ConflictResolutionSheet } from '../../features/sync/ConflictResolutionSheet'
import { CONFLICT_ENTITY_LABEL, summarizeConflicts } from '../../features/sync/conflictView'
import { describeDevice, formatDeviceLabel, listDevices, revokeDevice } from '../../features/sync/devices'
import {
  countProjection,
  decideFirstSync,
  type FirstSyncChoice,
  type FirstSyncCounts,
  type FirstSyncDecision,
} from '../../features/sync/firstSync'
import type { LocalRuntimeState } from '../../features/sync/merge'
import { relativeTime, describeSyncError, syncStatusCaption } from '../../features/sync/notifier'
import { projectLocalState } from '../../features/sync/projection'
import { readSyncState, rotateDeviceId } from '../../features/sync/state'
import type { SyncStatus } from '../../features/sync/SyncEngine'
import { SyncTransportError } from '../../features/sync/transport'
import type { CloudSyncApi } from '../../features/sync/useCloudSync'
import {
  captureSyncSafetySnapshot,
  readSyncSafetySnapshot,
  restoreSyncSafetySnapshot,
} from '../../lib/backup'
import { log } from '../../lib/logger'

interface Props {
  account: AccountApi
  sync: CloudSyncApi
  runtime: LocalRuntimeState
  onBack: () => void
}

const PROVIDER_LABEL: Record<string, string> = {
  credential: '邮箱密码',
  google: 'Google',
  github: 'GitHub',
  linuxdo: 'Linux DO',
}

const SOCIAL_PROVIDERS: Array<{ id: SocialProvider; label: string; monogram: string }> = [
  { id: 'google', label: 'Google', monogram: 'G' },
  { id: 'github', label: 'GitHub', monogram: 'GH' },
  { id: 'linuxdo', label: 'Linux DO', monogram: 'LD' },
]

const PRIMARY_BUTTON =
  'rounded-full border border-cinnabar/70 bg-cinnabar/15 px-4 py-2 font-mono text-[11px] font-medium text-cinnabar-soft transition-colors hover:bg-cinnabar/25 disabled:opacity-40'
const SECONDARY_BUTTON =
  'rounded-full border border-haze px-4 py-2 font-mono text-[11px] text-paper-muted transition-colors hover:text-paper disabled:opacity-40'
/** 表单主动作：整行可点，拇指友好 */
const CTA_BUTTON =
  'flex w-full items-center justify-center gap-2 rounded-xl border border-cinnabar/70 bg-cinnabar/15 px-4 py-3 text-[13.5px] font-medium text-cinnabar-soft transition-colors hover:bg-cinnabar/25 disabled:opacity-40'
const FIELD_CLASS =
  'w-full rounded-xl border border-haze bg-ink px-3.5 py-3 text-[14px] text-paper outline-none placeholder:text-paper-faint focus:border-cinnabar/50'
const FIELD_LABEL = 'mb-1.5 block font-mono text-[10px] tracking-[0.16em] text-paper-faint'

type AuthMode = 'sign-in' | 'sign-up' | 'forgot'

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-haze bg-ink-raised p-4 shadow-[var(--shadow-lift)] ${className}`}>
      {children}
    </div>
  )
}

function StatusIcon({ status }: { status: SyncStatus }) {
  if (status.phase === 'syncing')
    return <LoaderCircle size={13} strokeWidth={1.8} className="animate-spin text-paper-muted" />
  if (status.phase === 'offline')
    return <CloudOff size={13} strokeWidth={1.8} className="text-paper-faint" />
  if (status.phase === 'paused' || status.phase === 'error')
    return <CircleAlert size={13} strokeWidth={1.8} className="text-cinnabar-soft" />
  if (status.conflictCount > 0)
    return <AlertTriangle size={13} strokeWidth={1.8} className="text-cinnabar-soft" />
  return <Check size={13} strokeWidth={1.8} className="text-paper-faint" />
}

function CountTiles({ counts }: { counts: FirstSyncCounts }) {
  const tiles: Array<[string, number]> = [
    ['订阅', counts.subscriptions],
    ['分类', counts.categories],
    ['设置', counts.settings],
  ]
  return (
    <dl className="grid grid-cols-3 gap-1.5">
      {tiles.map(([label, value]) => (
        <div key={label} className="rounded-lg border border-haze bg-ink px-1 py-1.5 text-center">
          <dd className="font-display text-[16px] leading-tight text-paper">{value}</dd>
          <dt className="mt-0.5 font-mono text-[9px] tracking-[0.2em] text-paper-faint">{label}</dt>
        </div>
      ))}
    </dl>
  )
}

/**
 * 账户与同步。
 *
 * 四个状态：恢复中、未登录（登录/注册/找回）、首次同步待决策（本机 / 云端 / 合并）、
 * 已登录日常态（身份、状态、冲突、设备、登录方式、退出与回滚）。
 * 任何一屏都不阻断本地阅读，云端不可达时只是这一页显示错误。
 */
export function AccountSyncScreen({ account, sync, runtime, onBack }: Props) {
  const [mode, setModeState] = useState<AuthMode>('sign-in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [bootstrap, setBootstrap] = useState<SyncBootstrapResponse | null>(null)
  const [bootstrapError, setBootstrapError] = useState<string | null>(null)
  const [choosing, setChoosing] = useState<FirstSyncChoice | null>(null)
  const [confirmChoice, setConfirmChoice] = useState<FirstSyncChoice | null>(null)
  const [devices, setDevices] = useState<DeviceSummary[] | null>(null)
  const [deviceError, setDeviceError] = useState<string | null>(null)
  const [showRevokedDevices, setShowRevokedDevices] = useState(false)
  const [revokeTarget, setRevokeTarget] = useState<DeviceSummary | null>(null)
  const [revoking, setRevoking] = useState(false)
  const [conflictSheetOpen, setConflictSheetOpen] = useState(false)
  const [confirmSignOut, setConfirmSignOut] = useState(false)
  const [confirmRollback, setConfirmRollback] = useState(false)
  const [snapshotAt, setSnapshotAt] = useState<number | null>(
    () => readSyncSafetySnapshot()?.createdAt ?? null,
  )

  const authenticated = account.status === 'authenticated'
  const status = sync.status
  const { view } = accountScreenModel({
    accountStatus: account.status,
    firstSyncCompleted: status.firstSyncCompleted,
    conflictCount: sync.conflicts.length,
    hasSafetySnapshot: snapshotAt !== null,
  })
  const needsFirstSync = view === 'first-sync'

  const caption = syncStatusCaption(status, { authenticated })

  const setMode = (next: AuthMode) => {
    if (next === 'sign-up' && !account.emailSignUpEnabled) return
    setModeState(next)
    account.clearMessages()
  }

  useEffect(() => {
    if (!account.emailSignUpEnabled && mode === 'sign-up') setModeState('sign-in')
  }, [account.emailSignUpEnabled, mode])

  const decision: FirstSyncDecision | null = useMemo(() => {
    if (!bootstrap) return null
    return decideFirstSync(projectLocalState(runtime), bootstrap)
  }, [bootstrap, runtime])

  const localCounts = useMemo(() => countProjection(projectLocalState(runtime)), [runtime])
  const conflictSummary = useMemo(() => summarizeConflicts(sync.conflicts), [sync.conflicts])

  useEffect(() => {
    if (!needsFirstSync || !sync.engine) return
    let disposed = false
    setBootstrapError(null)

    const load = async (allowRotate: boolean): Promise<void> => {
      try {
        const summary = await sync.engine!.bootstrapSummary()
        if (!disposed) setBootstrap(summary)
      } catch (error: unknown) {
        if (
          allowRotate &&
          error instanceof SyncTransportError &&
          error.code === 'DEVICE_IN_USE'
        ) {
          rotateDeviceId()
          await load(false)
          return
        }
        if (!disposed) setBootstrapError(describeSyncError(error, '云端摘要读取失败'))
      }
    }

    void load(true)
    return () => {
      disposed = true
    }
  }, [needsFirstSync, sync.engine])

  const loadDevices = useCallback(async () => {
    if (!authenticated) return
    setDeviceError(null)
    try {
      setDevices(await listDevices(account.adapter.fetchCloud, readSyncState().deviceId))
    } catch (error: unknown) {
      setDeviceError(describeSyncError(error, '设备列表读取失败'))
    }
  }, [account.adapter, authenticated])

  useEffect(() => {
    if (authenticated && !needsFirstSync) void loadDevices()
  }, [authenticated, needsFirstSync, loadDevices])

  const submitAuth = async () => {
    if (mode === 'sign-in') {
      await account.signIn(email, password)
      return
    }
    if (mode === 'sign-up') {
      const ok = await account.signUp({ email, password })
      if (ok) setModeState('sign-in')
      return
    }
    await account.requestPasswordReset(email)
  }

  /** 三选一都先留一份本机安全快照，选错了还能整包回滚同步域 */
  const chooseFirstSync = async (choice: FirstSyncChoice) => {
    if (!sync.engine || choosing) return
    setChoosing(choice)
    try {
      setSnapshotAt(captureSyncSafetySnapshot(__APP_VERSION__).createdAt)
      if (choice === 'local') await sync.engine.adoptLocal()
      else if (choice === 'cloud') await sync.engine.adoptCloud()
      else await sync.engine.adoptMerge()
      await sync.refreshConflicts()
      await loadDevices()
    } catch (error: unknown) {
      log.sync.warn('first sync choice failed', { choice, error })
      setBootstrapError('首次同步没能完成，稍后可以重试；本机数据没有被改动。')
    } finally {
      setChoosing(null)
    }
  }

  const confirmRevoke = async () => {
    if (!revokeTarget || revoking) return
    setRevoking(true)
    try {
      await revokeDevice(account.adapter.fetchCloud, revokeTarget.id)
      await loadDevices()
    } catch (error: unknown) {
      setDeviceError(describeSyncError(error, '撤销失败，请稍后再试'))
    } finally {
      setRevoking(false)
      setRevokeTarget(null)
    }
  }

  const rollback = async () => {
    const result = await restoreSyncSafetySnapshot()
    if (result) window.location.reload()
  }

  const openConflictSheet = () => {
    setConflictSheetOpen(true)
    void sync.refreshConflicts()
  }

  const user = account.session?.user
  const displayName = user?.name?.trim() || user?.email || ''
  const initial = (displayName[0] ?? '闻').toUpperCase()
  const linkedProviders = account.session?.linkedProviders ?? []
  const enabledSocialProviders = SOCIAL_PROVIDERS.filter((provider) =>
    account.socialSignInProviders.includes(provider.id),
  )
  const visibleSocialProviders = SOCIAL_PROVIDERS.filter(
    (provider) =>
      account.socialSignInProviders.includes(provider.id) || linkedProviders.includes(provider.id),
  )
  const socialSignInGridClass =
    enabledSocialProviders.length <= 1
      ? 'grid-cols-1'
      : enabledSocialProviders.length === 2
        ? 'grid-cols-2'
        : 'grid-cols-3'

  return (
    <SettingsShell title="账户与同步" caption={caption} onBack={onBack}>
      {account.error && (
        <div className="page-x pt-4">
          <p className="flex items-start gap-2 rounded-xl border border-cinnabar/40 bg-cinnabar/10 px-3 py-2.5 text-[12px] leading-relaxed text-cinnabar-soft">
            <CircleAlert size={14} strokeWidth={1.8} className="mt-0.5 shrink-0" />
            <span className="min-w-0">{account.error}</span>
          </p>
        </div>
      )}
      {account.notice && (
        <div className="page-x pt-4">
          <p className="flex items-start gap-2 rounded-xl border border-haze bg-ink-raised px-3 py-2.5 text-[12px] leading-relaxed text-paper-muted">
            <Info size={14} strokeWidth={1.8} className="mt-0.5 shrink-0 text-paper-faint" />
            <span className="min-w-0">{account.notice}</span>
          </p>
        </div>
      )}

      {view === 'restoring' && (
        <div className="page-x pt-6">
          <Card>
            <p className="flex items-center gap-2 text-[13px] text-paper-muted">
              <LoaderCircle size={14} className="animate-spin" />
              正在恢复登录状态…
            </p>
          </Card>
        </div>
      )}

      {view === 'anonymous' && (
        <div className="page-x pt-4">
          <div className="mx-auto w-full max-w-md">
            <div className="flex flex-col items-center gap-2.5 px-2 pt-4 pb-5 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-haze bg-ink-raised shadow-[var(--shadow-lift)]">
                <CloudUpload size={21} strokeWidth={1.5} className="text-paper-muted" />
              </span>
              <h2 className="font-display text-[19px] text-paper">同一份订阅，随处可读</h2>
              <p className="max-w-xs text-[12px] leading-relaxed text-paper-faint">
                登录后同步订阅源、分类排序、应用配置与密钥；不登录也能完整使用「有所闻」。
              </p>
            </div>

            <Card>
              {mode !== 'forgot' ? (
                <>
                  {account.emailSignUpEnabled ? (
                    <div className="flex rounded-full border border-haze bg-ink p-1" role="tablist">
                      {(
                        [
                          ['sign-in', '登录'],
                          ['sign-up', '注册'],
                        ] as Array<[AuthMode, string]>
                      ).map(([value, label]) => (
                        <button
                          key={value}
                          type="button"
                          role="tab"
                          aria-selected={mode === value}
                          onClick={() => setMode(value)}
                          className={`flex-1 rounded-full py-2 font-mono text-[11.5px] transition-colors ${
                            mode === value
                              ? 'bg-ink-raised font-medium text-paper shadow-[var(--shadow-lift)]'
                              : 'text-paper-faint hover:text-paper'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="font-mono text-[11px] tracking-[0.2em] text-paper-faint">邮箱登录</p>
                  )}

                  <form
                    className={`space-y-3.5 ${account.emailSignUpEnabled ? 'mt-4' : 'mt-3'}`}
                    onSubmit={(event) => {
                      event.preventDefault()
                      void submitAuth()
                    }}
                  >
                    <label className="block">
                      <span className={FIELD_LABEL}>邮箱</span>
                      <input
                        className={FIELD_CLASS}
                        type="email"
                        autoComplete="email"
                        inputMode="email"
                        placeholder="you@example.com"
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                      />
                    </label>
                    <label className="block">
                      <span className={FIELD_LABEL}>密码</span>
                      <span className="relative block">
                        <input
                          className={`${FIELD_CLASS} pr-11`}
                          type={showPassword ? 'text' : 'password'}
                          autoComplete={
                            mode === 'sign-up' && account.emailSignUpEnabled
                              ? 'new-password'
                              : 'current-password'
                          }
                          placeholder="至少 8 位"
                          value={password}
                          onChange={(event) => setPassword(event.target.value)}
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword((value) => !value)}
                          aria-label={showPassword ? '隐藏密码' : '显示密码'}
                          className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-paper-faint transition-colors hover:text-paper"
                        >
                          {showPassword ? (
                            <EyeOff size={16} strokeWidth={1.6} />
                          ) : (
                            <Eye size={16} strokeWidth={1.6} />
                          )}
                        </button>
                      </span>
                    </label>

                    <button
                      type="submit"
                      disabled={account.busy || !email || !password}
                      className={CTA_BUTTON}
                    >
                      {account.busy && <LoaderCircle size={15} className="animate-spin" />}
                      {mode === 'sign-in' || !account.emailSignUpEnabled ? '登录' : '注册'}
                    </button>
                  </form>

                  {mode === 'sign-in' ? (
                    <div className="mt-3 text-right">
                      <button
                        type="button"
                        onClick={() => setMode('forgot')}
                        className="text-[11.5px] text-paper-faint underline-offset-4 transition-colors hover:text-paper hover:underline"
                      >
                        忘记密码？
                      </button>
                    </div>
                  ) : account.emailSignUpEnabled ? (
                    <p className="mt-3 text-[11px] leading-relaxed text-paper-faint">
                      注册后需要点开验证邮件里的链接才能登录。
                    </p>
                  ) : null}
                </>
              ) : (
                <>
                  <h3 className="font-display text-[16px] font-medium text-paper">找回密码</h3>
                  <p className="mt-1.5 text-[11.5px] leading-relaxed text-paper-faint">
                    输入注册邮箱，我们会发送一封重置密码的邮件。
                  </p>
                  <form
                    className="mt-4 space-y-3.5"
                    onSubmit={(event) => {
                      event.preventDefault()
                      void submitAuth()
                    }}
                  >
                    <label className="block">
                      <span className={FIELD_LABEL}>邮箱</span>
                      <input
                        className={FIELD_CLASS}
                        type="email"
                        autoComplete="email"
                        inputMode="email"
                        placeholder="you@example.com"
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                      />
                    </label>
                    <button type="submit" disabled={account.busy || !email} className={CTA_BUTTON}>
                      {account.busy && <LoaderCircle size={15} className="animate-spin" />}
                      发送重置邮件
                    </button>
                  </form>
                  <div className="mt-3 flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => setMode('sign-in')}
                      className="text-[11.5px] text-paper-faint underline-offset-4 transition-colors hover:text-paper hover:underline"
                    >
                      返回登录
                    </button>
                    <button
                      type="button"
                      disabled={account.busy || !email}
                      onClick={() => void account.resendVerification(email)}
                      className="text-[11.5px] text-paper-faint underline-offset-4 transition-colors hover:text-paper hover:underline disabled:opacity-40"
                    >
                      重发验证邮件
                    </button>
                  </div>
                </>
              )}
            </Card>

            {enabledSocialProviders.length > 0 && (
              <>
                <div className="mt-5 flex items-center gap-3 px-1">
                  <span className="h-px flex-1 bg-haze" aria-hidden />
                  <span className="font-mono text-[10px] tracking-[0.28em] text-paper-faint">
                    第三方登录
                  </span>
                  <span className="h-px flex-1 bg-haze" aria-hidden />
                </div>

                <div className={`mt-3 grid gap-2 ${socialSignInGridClass}`}>
                  {enabledSocialProviders.map((provider) => (
                    <button
                      key={provider.id}
                      type="button"
                      disabled={account.busy}
                      onClick={() => void account.signInWithSocial(provider.id)}
                      className="flex flex-col items-center gap-1.5 rounded-2xl border border-haze bg-ink-raised px-2 py-3 transition-colors hover:border-paper-faint disabled:opacity-40"
                    >
                      <span className="flex h-8 w-8 items-center justify-center rounded-full border border-haze bg-ink font-mono text-[11px] text-paper-muted">
                        {provider.monogram}
                      </span>
                      <span className="text-[11px] text-paper-muted">{provider.label}</span>
                    </button>
                  ))}
                </div>
                <p className="mt-3 px-1 text-[10.5px] leading-relaxed text-paper-faint">
                  同邮箱的不同登录方式不会被自动合并成一个账户，登录后可以在这里显式绑定另一种方式。
                </p>
              </>
            )}

            <p className="mt-6 border-t border-haze/60 px-1 pt-4 text-[11px] leading-relaxed text-paper-faint">
              不登录也能完整使用「有所闻」：订阅、正文抽取、离线缓存与全部本地设置都不依赖账户。
              登录只同步订阅源、分类排序、应用配置与密钥；正文、缓存、稍后读、已读、阅读位置永远只留在本机。
            </p>
          </div>
        </div>
      )}

      {needsFirstSync && (
        <div className="page-x pt-6">
          <div className="mx-auto w-full max-w-md">
            <Card>
              {bootstrapError && (
                <p className="mb-3 flex items-start gap-2 rounded-xl border border-cinnabar/40 bg-cinnabar/10 px-3 py-2.5 text-[12px] leading-relaxed text-cinnabar-soft">
                  <CircleAlert size={14} strokeWidth={1.8} className="mt-0.5 shrink-0" />
                  <span className="min-w-0">{bootstrapError}</span>
                </p>
              )}
              {!decision && !bootstrapError && (
                <p className="flex items-center gap-2 py-2 text-[13px] text-paper-muted">
                  <LoaderCircle size={14} className="animate-spin" />
                  正在读取云端摘要…
                </p>
              )}
              {decision && (
                <>
                  <h3 className="font-display text-[16px] font-medium text-paper">
                    决定首次同步的方向
                  </h3>
                  <p className="mt-1.5 text-[12px] leading-relaxed text-paper-muted">
                    这台设备与云端各有一份配置。选择只影响同步范围（订阅、分类、应用配置与密钥），
                    不会动正文缓存与阅读记录。
                  </p>

                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <div className="rounded-xl border border-haze p-2.5">
                      <p className="mb-2 font-mono text-[10px] tracking-[0.2em] text-paper-faint">
                        本机
                      </p>
                      <CountTiles counts={decision.local} />
                    </div>
                    <div className="rounded-xl border border-haze p-2.5">
                      <p className="mb-2 font-mono text-[10px] tracking-[0.2em] text-paper-faint">
                        云端
                        {decision.cloudLastUpdatedAt && (
                          <span className="ml-1.5 normal-case tracking-normal">
                            {relativeTime(decision.cloudLastUpdatedAt)}更新
                          </span>
                        )}
                      </p>
                      <CountTiles counts={decision.cloud} />
                    </div>
                  </div>

                  <div className="mt-4 space-y-2">
                    <FirstSyncOption
                      icon={GitMerge}
                      title="合并两边"
                      description="两边内容都保留；无法自动合并的交给你逐项决定。"
                      recommended={decision.suggestion === 'merge'}
                      busy={choosing === 'merge'}
                      disabled={choosing !== null}
                      onClick={() => void chooseFirstSync('merge')}
                    />
                    <FirstSyncOption
                      icon={CloudUpload}
                      title="以本机为准"
                      description="把这台设备的配置上传为云端新基线，云端多出的内容会被移除。"
                      recommended={decision.suggestion === 'local'}
                      busy={choosing === 'local'}
                      disabled={choosing !== null}
                      onClick={() => setConfirmChoice('local')}
                    />
                    <FirstSyncOption
                      icon={CloudDownload}
                      title="以云端为准"
                      description="这台设备的同步范围整包换成云端内容，本机改动会被覆盖。"
                      recommended={decision.suggestion === 'cloud'}
                      busy={choosing === 'cloud'}
                      disabled={choosing !== null}
                      onClick={() => setConfirmChoice('cloud')}
                    />
                  </div>

                  <p className="mt-3.5 text-[11px] leading-relaxed text-paper-faint">
                    选择前会自动留一份「同步前配置」快照，之后随时可以在本页整包退回。
                  </p>
                </>
              )}
            </Card>
          </div>
        </div>
      )}

      {view === 'ready' && (
        <>
          <SettingsSection title="同步状态">
            <div className="page-x">
              <Card>
                <div className="flex items-center gap-3">
                  {user?.image ? (
                    <img
                      src={user.image}
                      alt=""
                      className="h-11 w-11 shrink-0 rounded-full border border-haze object-cover"
                    />
                  ) : (
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-haze bg-ink font-display text-[16px] text-paper-muted">
                      {initial}
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14.5px] font-medium text-paper">{displayName}</p>
                    {user?.name?.trim() && user.email && (
                      <p className="mt-0.5 truncate font-mono text-[10.5px] text-paper-faint">
                        {user.email}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    disabled={status.phase === 'syncing'}
                    onClick={() => void sync.syncNow()}
                    className={`${SECONDARY_BUTTON} whitespace-nowrap`}
                  >
                    <RefreshCw
                      size={12}
                      className={`mr-1 inline align-[-1.5px] ${status.phase === 'syncing' ? 'animate-spin' : ''}`}
                    />
                    立即同步
                  </button>
                </div>

                <p className="mt-3 flex items-center gap-1.5 border-t border-haze/60 pt-3 font-mono text-[10.5px] text-paper-faint">
                  <StatusIcon status={status} />
                  {caption}
                </p>

                <div className="mt-3">
                  <CountTiles counts={localCounts} />
                </div>
              </Card>
            </div>
          </SettingsSection>

          {sync.conflicts.length > 0 && (
            <SettingsSection title="需要你决定">
              <div className="page-x">
                <div className="rounded-2xl border border-cinnabar/50 bg-cinnabar/10 p-4">
                  <div className="flex items-start gap-3">
                    <AlertTriangle
                      size={17}
                      strokeWidth={1.6}
                      className="mt-0.5 shrink-0 text-cinnabar-soft"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-[13.5px] font-medium text-paper">
                        {sync.conflicts.length} 处改动在两台设备上不一致
                      </p>
                      <p className="mt-1 text-[11.5px] leading-relaxed text-paper-muted">
                        {conflictSummary.groups
                          .map(({ entityType, count }) => `${CONFLICT_ENTITY_LABEL[entityType]} ${count}`)
                          .join(' · ')}
                        ，可以按类批量处理，也可以逐项裁决；没决定的会一直保留。
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={openConflictSheet}
                      className={`${PRIMARY_BUTTON} shrink-0 whitespace-nowrap`}
                    >
                      去处理
                    </button>
                  </div>
                </div>
              </div>
            </SettingsSection>
          )}

          <SettingsSection title="设备">
            <div className="page-x">
              <Card>
                {deviceError && (
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <p className="min-w-0 text-[12px] text-cinnabar-soft">{deviceError}</p>
                    <button type="button" onClick={() => void loadDevices()} className={SECONDARY_BUTTON}>
                      重试
                    </button>
                  </div>
                )}
                {!devices && !deviceError && (
                  <p className="flex items-center gap-2 text-[12.5px] text-paper-faint">
                    <LoaderCircle size={13} className="animate-spin" />
                    正在读取设备列表…
                  </p>
                )}
                {devices && (
                  <>
                    {(() => {
                      const active = devices.filter((device) => !device.revokedAt)
                      const revoked = devices.filter((device) => device.revokedAt)
                      const visibleRevoked = showRevokedDevices ? revoked : []
                      const rows = [...active, ...visibleRevoked]
                      return (
                        <>
                          {active.length === 0 && revoked.length > 0 && !showRevokedDevices && (
                            <p className="mb-3 text-[12px] leading-relaxed text-paper-muted">
                              当前没有活跃设备。若你只在用这一台手机，展开下方已撤销条目并清理重复记录即可。
                            </p>
                          )}
                          <ul className="divide-y divide-haze/60">
                            {rows.map((device) => (
                              <li key={device.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-haze bg-ink">
                                  {device.platform === 'android' || device.platform === 'ios' ? (
                                    <Smartphone size={15} strokeWidth={1.6} className="text-paper-muted" />
                                  ) : (
                                    <Monitor size={15} strokeWidth={1.6} className="text-paper-muted" />
                                  )}
                                </span>
                                <span className="min-w-0 flex-1">
                                  <span className="flex items-center gap-1.5">
                                    <span className="truncate text-[13.5px] text-paper">
                                      {formatDeviceLabel(device)}
                                    </span>
                                    {device.current && (
                                      <span className="shrink-0 rounded-full border border-cinnabar/50 bg-cinnabar/10 px-2 py-0.5 font-mono text-[9px] tracking-[0.1em] text-cinnabar-soft">
                                        本机
                                      </span>
                                    )}
                                  </span>
                                  <span className="mt-0.5 block truncate font-mono text-[10px] text-paper-faint">
                                    {describeDevice(device)}
                                    {device.appVersion ? ` · v${device.appVersion}` : ''}
                                  </span>
                                </span>
                                {!device.current && !device.revokedAt && (
                                  <button
                                    type="button"
                                    onClick={() => setRevokeTarget(device)}
                                    className={`${SECONDARY_BUTTON} shrink-0`}
                                  >
                                    撤销
                                  </button>
                                )}
                              </li>
                            ))}
                          </ul>
                          {revoked.length > 0 && (
                            <button
                              type="button"
                              onClick={() => setShowRevokedDevices((open) => !open)}
                              className="mt-3 text-[11px] text-paper-muted underline-offset-2 hover:text-paper hover:underline"
                            >
                              {showRevokedDevices
                                ? '收起已撤销设备'
                                : `查看已撤销设备（${revoked.length}）`}
                            </button>
                          )}
                        </>
                      )
                    })()}
                  </>
                )}
                <p className="mt-3 border-t border-haze/60 pt-3 text-[11px] leading-relaxed text-paper-faint">
                  撤销只让那台设备停止云端同步，它本机已有的订阅与配置照旧可用。同一台手机若出现多条记录，通常是历史遗留，保留带「本机」的一条即可。
                </p>
              </Card>
            </div>
          </SettingsSection>

          <SettingsSection title="登录方式">
            <div className="page-x">
              <Card>
                <ul className="divide-y divide-haze/60">
                  {linkedProviders.includes('credential') && (
                    <li className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-haze bg-ink font-mono text-[10px] text-paper-muted">
                        @
                      </span>
                      <span className="min-w-0 flex-1 text-[13.5px] text-paper">
                        {PROVIDER_LABEL.credential}
                      </span>
                      <span className="flex shrink-0 items-center gap-1 font-mono text-[10.5px] text-paper-faint">
                        <BadgeCheck size={13} strokeWidth={1.8} />
                        已绑定
                      </span>
                    </li>
                  )}
                  {visibleSocialProviders.map((provider) => {
                    const linked = linkedProviders.includes(provider.id)
                    return (
                      <li key={provider.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-haze bg-ink font-mono text-[10px] text-paper-muted">
                          {provider.monogram}
                        </span>
                        <span className="min-w-0 flex-1 text-[13.5px] text-paper">{provider.label}</span>
                        {linked ? (
                          <span className="flex shrink-0 items-center gap-1 font-mono text-[10.5px] text-paper-faint">
                            <BadgeCheck size={13} strokeWidth={1.8} />
                            已绑定
                          </span>
                        ) : account.socialSignInProviders.includes(provider.id) ? (
                          <button
                            type="button"
                            disabled={account.busy}
                            onClick={() => void account.linkSocial(provider.id)}
                            className={`${SECONDARY_BUTTON} shrink-0`}
                          >
                            绑定
                          </button>
                        ) : null}
                      </li>
                    )
                  })}
                </ul>
              </Card>
            </div>
          </SettingsSection>

          <SettingsSection title="退出与回滚">
            <div className="page-x">
              <Card>
                <ul className="divide-y divide-haze/60">
                  {snapshotAt && (
                    <li className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                      <RotateCcw size={16} strokeWidth={1.6} className="shrink-0 text-paper-muted" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13.5px] text-paper">恢复同步前配置</span>
                        <span className="mt-0.5 block font-mono text-[10px] text-paper-faint">
                          快照留于 {relativeTime(snapshotAt)}
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={() => setConfirmRollback(true)}
                        className={`${SECONDARY_BUTTON} shrink-0`}
                      >
                        恢复
                      </button>
                    </li>
                  )}
                  <li className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                    <LogOut size={16} strokeWidth={1.6} className="shrink-0 text-paper-muted" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13.5px] text-paper">退出登录</span>
                      <span className="mt-0.5 block text-[11px] leading-relaxed text-paper-faint">
                        只清掉这台设备的云端凭证并停止同步，本机订阅、配置与密钥都会留下。
                      </span>
                    </span>
                    <button
                      type="button"
                      disabled={account.busy}
                      onClick={() => setConfirmSignOut(true)}
                      className={`${SECONDARY_BUTTON} shrink-0`}
                    >
                      退出
                    </button>
                  </li>
                </ul>
              </Card>
            </div>
          </SettingsSection>
        </>
      )}

      <ConflictResolutionSheet
        open={conflictSheetOpen}
        conflicts={sync.conflicts}
        onApply={(decisions, onProgress) => sync.resolveConflicts(decisions, onProgress)}
        onClose={() => setConflictSheetOpen(false)}
      />

      <ConfirmDialog
        open={confirmChoice !== null}
        title={confirmChoice === 'local' ? '以本机为准？' : '以云端为准？'}
        message={
          confirmChoice === 'local'
            ? '这台设备的订阅、分类与配置会成为云端新基线，云端多出的内容会被移除。已同步的其它设备下次同步时会跟随这份基线。'
            : '这台设备的订阅、分类与配置会整包换成云端内容，本机的相应改动会被覆盖。正文缓存与阅读记录不受影响。'
        }
        confirmLabel={confirmChoice === 'local' ? '以本机为准' : '以云端为准'}
        onConfirm={() => {
          const choice = confirmChoice
          setConfirmChoice(null)
          if (choice) void chooseFirstSync(choice)
        }}
        onCancel={() => setConfirmChoice(null)}
      />

      <ConfirmDialog
        open={revokeTarget !== null}
        title="撤销这台设备？"
        message={`「${revokeTarget ? formatDeviceLabel(revokeTarget) : '未命名设备'}」将停止云端同步，它本机已有的订阅与配置照旧可用；之后重新登录即可恢复同步。`}
        confirmLabel={revoking ? '撤销中…' : '撤销'}
        onConfirm={() => void confirmRevoke()}
        onCancel={() => {
          if (!revoking) setRevokeTarget(null)
        }}
      />

      <ConfirmDialog
        open={confirmSignOut}
        title="退出登录？"
        message="只清掉这台设备的云端凭证并停止同步，本机订阅、配置与密钥都会留下。重新登录后可以继续同步。"
        confirmLabel="退出登录"
        onConfirm={() => {
          setConfirmSignOut(false)
          void account.signOut().then(() => sync.engine?.reset())
        }}
        onCancel={() => setConfirmSignOut(false)}
      />

      <ConfirmDialog
        open={confirmRollback}
        title="恢复同步前配置？"
        message={`把同步范围内的配置整包退回到 ${
          snapshotAt ? relativeTime(snapshotAt) : ''
        }留下的快照，之后应用会重新加载。正文缓存与阅读记录不受影响。`}
        confirmLabel="恢复并重载"
        onConfirm={() => {
          setConfirmRollback(false)
          void rollback()
        }}
        onCancel={() => setConfirmRollback(false)}
      />
    </SettingsShell>
  )
}

function FirstSyncOption({
  icon: Icon,
  title,
  description,
  recommended,
  busy,
  disabled,
  onClick,
}: {
  icon: typeof GitMerge
  title: string
  description: string
  recommended: boolean
  busy: boolean
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex w-full items-start gap-3 rounded-xl border p-3.5 text-left transition-colors disabled:opacity-50 ${
        recommended
          ? 'border-cinnabar/60 bg-cinnabar/10 hover:bg-cinnabar/15'
          : 'border-haze bg-ink hover:border-paper-faint'
      }`}
    >
      <span
        className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${
          recommended ? 'border-cinnabar/50 bg-cinnabar/10' : 'border-haze bg-ink-raised'
        }`}
      >
        {busy ? (
          <LoaderCircle size={16} strokeWidth={1.8} className="animate-spin text-paper-muted" />
        ) : (
          <Icon
            size={16}
            strokeWidth={1.6}
            className={recommended ? 'text-cinnabar-soft' : 'text-paper-muted'}
          />
        )}
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-2">
          <span className="text-[13.5px] font-medium text-paper">{title}</span>
          {recommended && (
            <span className="rounded-full border border-cinnabar/50 bg-cinnabar/10 px-2 py-0.5 font-mono text-[9px] tracking-[0.1em] text-cinnabar-soft">
              推荐
            </span>
          )}
        </span>
        <span className="mt-1 block text-[11.5px] leading-relaxed text-paper-faint">
          {description}
        </span>
      </span>
    </button>
  )
}
