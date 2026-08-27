import { useCallback, useEffect, useMemo, useState } from 'react'
import type { DeviceSummary, SyncBootstrapResponse } from '@newsnook/contracts'
import {
  CloudDownload,
  CloudUpload,
  GitMerge,
  LoaderCircle,
  Monitor,
  RefreshCw,
  Smartphone,
} from 'lucide-react'

import { SettingsHint, SettingsSection, SettingsShell } from '../../components/SettingsShell'
import { accountScreenModel } from '../../features/account/screenModel'
import type { AccountApi } from '../../features/account/useAccount'
import type { SocialProvider } from '../../features/account/types'
import { describeDevice, listDevices, revokeDevice } from '../../features/sync/devices'
import {
  countProjection,
  decideFirstSync,
  describeCounts,
  type FirstSyncChoice,
  type FirstSyncDecision,
} from '../../features/sync/firstSync'
import type { LocalRuntimeState } from '../../features/sync/merge'
import { relativeTime, describeSyncError, syncStatusCaption } from '../../features/sync/notifier'
import { projectLocalState } from '../../features/sync/projection'
import { readSyncState, rotateDeviceId } from '../../features/sync/state'
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

const CONFLICT_REASON_LABEL: Record<string, string> = {
  delete_vs_update: '这台设备删掉了它，另一台改了它',
  update_vs_delete: '这台设备改了它，另一台已经删掉',
  stale_structural_update: '两台设备改了同一处结构',
  category_stale_mutation: '分类在别处已被改动',
}

const ENTITY_LABEL: Record<string, string> = {
  subscription: '订阅源',
  category: '分类',
  setting: '设置',
  secret: '密钥',
}

const PRIMARY_BUTTON =
  'rounded-full border border-cinnabar/70 bg-cinnabar/15 px-4 py-2 font-mono text-[11px] font-medium text-cinnabar-soft transition-colors hover:bg-cinnabar/25 disabled:opacity-40'
const SECONDARY_BUTTON =
  'rounded-full border border-haze px-4 py-2 font-mono text-[11px] text-paper-muted transition-colors hover:text-paper disabled:opacity-40'
const FIELD_CLASS =
  'w-full rounded-xl border border-haze bg-ink px-3 py-2.5 text-[13px] text-paper outline-none placeholder:text-paper-faint focus:border-paper-faint'

type AuthMode = 'sign-in' | 'sign-up' | 'forgot'

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="page-x">
      <div className="rounded-2xl border border-haze bg-ink-raised p-4 shadow-[var(--shadow-lift)]">
        {children}
      </div>
    </div>
  )
}

/**
 * 账户与同步。
 *
 * 三个状态：未登录（登录/注册/找回）、首次同步待决策（本机 / 云端 / 合并）、
 * 已登录日常态（状态、立即同步、冲突、设备、绑定方式、退出）。
 * 任何一屏都不阻断本地阅读，云端不可达时只是这一页显示错误。
 */
export function AccountSyncScreen({ account, sync, runtime, onBack }: Props) {
  const [mode, setMode] = useState<AuthMode>('sign-in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [bootstrap, setBootstrap] = useState<SyncBootstrapResponse | null>(null)
  const [bootstrapError, setBootstrapError] = useState<string | null>(null)
  const [choosing, setChoosing] = useState<FirstSyncChoice | null>(null)
  const [devices, setDevices] = useState<DeviceSummary[] | null>(null)
  const [deviceError, setDeviceError] = useState<string | null>(null)
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

  const decision: FirstSyncDecision | null = useMemo(() => {
    if (!bootstrap) return null
    return decideFirstSync(projectLocalState(runtime), bootstrap)
  }, [bootstrap, runtime])

  const localCounts = useMemo(() => countProjection(projectLocalState(runtime)), [runtime])

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
      if (ok) setMode('sign-in')
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

  const rollback = async () => {
    const result = await restoreSyncSafetySnapshot()
    if (result) window.location.reload()
  }

  const social = (provider: SocialProvider, label: string) => (
    <button
      key={provider}
      type="button"
      disabled={account.busy}
      onClick={() => void account.signInWithSocial(provider)}
      className={SECONDARY_BUTTON}
    >
      {label}
    </button>
  )

  return (
    <SettingsShell title="账户与同步" caption={caption} onBack={onBack}>
      {account.error && (
        <div className="page-x pt-4">
          <p className="rounded-xl border border-cinnabar/40 bg-cinnabar/10 px-3 py-2 text-[12px] text-cinnabar-soft">
            {account.error}
          </p>
        </div>
      )}
      {account.notice && (
        <div className="page-x pt-4">
          <p className="rounded-xl border border-haze bg-ink-raised px-3 py-2 text-[12px] text-paper-muted">
            {account.notice}
          </p>
        </div>
      )}

      {view === 'restoring' && (
        <SettingsSection title="账户">
          <Card>
            <p className="flex items-center gap-2 text-[13px] text-paper-muted">
              <LoaderCircle size={14} className="animate-spin" />
              正在恢复登录状态…
            </p>
          </Card>
        </SettingsSection>
      )}

      {view === 'anonymous' && (
        <>
          <SettingsSection title={mode === 'sign-up' ? '注册' : mode === 'forgot' ? '找回密码' : '登录'}>
            <Card>
              <div className="space-y-3">
                <input
                  className={FIELD_CLASS}
                  type="email"
                  autoComplete="email"
                  inputMode="email"
                  placeholder="邮箱"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
                {mode !== 'forgot' && (
                  <input
                    className={FIELD_CLASS}
                    type="password"
                    autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'}
                    placeholder="密码（至少 8 位）"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={account.busy || !email}
                    onClick={() => void submitAuth()}
                    className={PRIMARY_BUTTON}
                  >
                    {mode === 'sign-in' ? '登录' : mode === 'sign-up' ? '注册' : '发送重置邮件'}
                  </button>
                  {mode !== 'sign-in' && (
                    <button type="button" onClick={() => setMode('sign-in')} className={SECONDARY_BUTTON}>
                      返回登录
                    </button>
                  )}
                  {mode === 'sign-in' && (
                    <>
                      <button type="button" onClick={() => setMode('sign-up')} className={SECONDARY_BUTTON}>
                        注册
                      </button>
                      <button type="button" onClick={() => setMode('forgot')} className={SECONDARY_BUTTON}>
                        忘记密码
                      </button>
                    </>
                  )}
                </div>
              </div>
            </Card>
          </SettingsSection>

          <SettingsSection title="第三方登录">
            <Card>
              <div className="flex flex-wrap gap-2">
                {social('google', '用 Google 登录')}
                {social('github', '用 GitHub 登录')}
                {social('linuxdo', '用 Linux DO 登录')}
              </div>
              <p className="mt-3 text-[11.5px] leading-relaxed text-paper-faint">
                同邮箱的不同登录方式不会被自动合并成一个账户。登录后可以在这里显式绑定另一种方式。
              </p>
            </Card>
          </SettingsSection>

          <SettingsHint>
            不登录也能完整使用「有所闻」：订阅、正文抽取、离线缓存与全部本地设置都不依赖账户。
            登录只同步订阅源、分类排序、应用配置与密钥；正文、缓存、稍后读、已读、阅读位置永远只留在本机。
          </SettingsHint>
        </>
      )}

      {needsFirstSync && (
        <SettingsSection title="首次同步">
          <Card>
            {bootstrapError && (
              <p className="mb-3 text-[12px] text-cinnabar-soft">{bootstrapError}</p>
            )}
            {!decision && !bootstrapError && (
              <p className="flex items-center gap-2 text-[13px] text-paper-muted">
                <LoaderCircle size={14} className="animate-spin" />
                正在读取云端摘要…
              </p>
            )}
            {decision && (
              <>
                <p className="text-[13px] leading-relaxed text-paper">
                  这台设备与云端都有配置，先决定以哪一份为准。选择只影响同步范围，不会动正文缓存与阅读记录。
                </p>
                <dl className="mt-3 grid gap-2 text-[11.5px] text-paper-muted sm:grid-cols-2">
                  <div className="rounded-xl border border-haze p-3">
                    <dt className="font-mono text-[10px] tracking-[0.2em] text-paper-faint">本机</dt>
                    <dd className="mt-1 text-paper">{describeCounts(decision.local)}</dd>
                  </div>
                  <div className="rounded-xl border border-haze p-3">
                    <dt className="font-mono text-[10px] tracking-[0.2em] text-paper-faint">云端</dt>
                    <dd className="mt-1 text-paper">{describeCounts(decision.cloud)}</dd>
                    {decision.cloudLastUpdatedAt && (
                      <dd className="mt-0.5 font-mono text-[10px] text-paper-faint">
                        更新于 {relativeTime(decision.cloudLastUpdatedAt)}
                      </dd>
                    )}
                  </div>
                </dl>

                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={choosing !== null}
                    onClick={() => void chooseFirstSync('local')}
                    className={PRIMARY_BUTTON}
                  >
                    <CloudUpload size={12} className="mr-1 inline" />
                    使用本机
                  </button>
                  <button
                    type="button"
                    disabled={choosing !== null}
                    onClick={() => void chooseFirstSync('cloud')}
                    className={SECONDARY_BUTTON}
                  >
                    <CloudDownload size={12} className="mr-1 inline" />
                    使用云端
                  </button>
                  <button
                    type="button"
                    disabled={choosing !== null}
                    onClick={() => void chooseFirstSync('merge')}
                    className={SECONDARY_BUTTON}
                  >
                    <GitMerge size={12} className="mr-1 inline" />
                    合并
                  </button>
                </div>
                <p className="mt-3 text-[11.5px] leading-relaxed text-paper-faint">
                  选择前会自动留一份「同步前配置」快照，随时可以整包退回。
                </p>
              </>
            )}
          </Card>
        </SettingsSection>
      )}

      {view === 'ready' && (
        <>
          <SettingsSection title="同步状态">
            <Card>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-[14px] text-paper">
                    {account.session?.user.name?.trim() || account.session?.user.email}
                  </p>
                  {account.session?.user.name?.trim() && account.session.user.email && (
                    <p className="mt-0.5 truncate font-mono text-[10.5px] text-paper-faint">
                      {account.session.user.email}
                    </p>
                  )}
                  <p className="mt-1 font-mono text-[10.5px] text-paper-faint">{caption}</p>
                </div>
                <button
                  type="button"
                  disabled={status.phase === 'syncing'}
                  onClick={() => void sync.syncNow()}
                  className={SECONDARY_BUTTON}
                >
                  <RefreshCw
                    size={12}
                    className={`mr-1 inline ${status.phase === 'syncing' ? 'animate-spin' : ''}`}
                  />
                  立即同步
                </button>
              </div>
              <p className="mt-3 font-mono text-[10.5px] text-paper-faint">
                本机 {describeCounts(localCounts)}
              </p>
            </Card>
          </SettingsSection>

          {sync.conflicts.length > 0 && (
            <SettingsSection title="需要你决定">
              <div className="page-x space-y-2">
                {sync.conflicts.map((conflict) => (
                  <div
                    key={conflict.id}
                    className="rounded-2xl border border-cinnabar/40 bg-ink-raised p-4"
                  >
                    <p className="text-[13px] text-paper">
                      {ENTITY_LABEL[conflict.entityType] ?? conflict.entityType} ·{' '}
                      {conflict.entityType === 'secret' ? '（密钥内容不展示）' : conflict.entityId}
                    </p>
                    <p className="mt-1 text-[11.5px] text-paper-faint">
                      {CONFLICT_REASON_LABEL[conflict.reason] ?? '两处改动无法自动合并'}
                    </p>
                    <div className="mt-3 flex gap-2">
                      <button
                        type="button"
                        onClick={() => void sync.resolveConflict(conflict.id, 'accept_local')}
                        className={PRIMARY_BUTTON}
                      >
                        用本机的
                      </button>
                      <button
                        type="button"
                        onClick={() => void sync.resolveConflict(conflict.id, 'accept_server')}
                        className={SECONDARY_BUTTON}
                      >
                        用云端的
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </SettingsSection>
          )}

          <SettingsSection title="设备">
            <Card>
              {deviceError && <p className="mb-2 text-[12px] text-cinnabar-soft">{deviceError}</p>}
              {!devices && !deviceError && (
                <p className="text-[12.5px] text-paper-faint">正在读取设备列表…</p>
              )}
              <ul className="space-y-2">
                {devices?.map((device) => (
                  <li key={device.id} className="flex items-center justify-between gap-3">
                    <span className="flex min-w-0 items-center gap-2">
                      {device.platform === 'android' ? (
                        <Smartphone size={14} className="shrink-0 text-paper-muted" />
                      ) : (
                        <Monitor size={14} className="shrink-0 text-paper-muted" />
                      )}
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] text-paper">
                          {device.name ?? '未命名设备'}
                          {device.current ? ' · 当前设备' : ''}
                        </span>
                        <span className="block font-mono text-[10px] text-paper-faint">
                          {describeDevice(device)}
                        </span>
                      </span>
                    </span>
                    {!device.current && !device.revokedAt && (
                      <button
                        type="button"
                        onClick={() =>
                          void revokeDevice(account.adapter.fetchCloud, device.id).then(loadDevices)
                        }
                        className={SECONDARY_BUTTON}
                      >
                        撤销
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-[11.5px] leading-relaxed text-paper-faint">
                撤销只让那台设备停止云端同步，它本机已有的订阅与配置照旧可用。
              </p>
            </Card>
          </SettingsSection>

          <SettingsSection title="登录方式">
            <Card>
              <p className="text-[12.5px] text-paper-muted">
                已绑定：
                {(account.session?.linkedProviders ?? [])
                  .map((provider) => PROVIDER_LABEL[provider] ?? provider)
                  .join(' · ') || '无'}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={account.busy}
                  onClick={() => void account.linkSocial('google')}
                  className={SECONDARY_BUTTON}
                >
                  绑定 Google
                </button>
                <button
                  type="button"
                  disabled={account.busy}
                  onClick={() => void account.linkSocial('github')}
                  className={SECONDARY_BUTTON}
                >
                  绑定 GitHub
                </button>
                <button
                  type="button"
                  disabled={account.busy}
                  onClick={() => void account.linkSocial('linuxdo')}
                  className={SECONDARY_BUTTON}
                >
                  绑定 Linux DO
                </button>
              </div>
            </Card>
          </SettingsSection>

          <SettingsSection title="退出与回滚">
            <Card>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={account.busy}
                  onClick={() => {
                    void account.signOut().then(() => sync.engine?.reset())
                  }}
                  className={SECONDARY_BUTTON}
                >
                  退出登录
                </button>
                {snapshotAt && (
                  <button type="button" onClick={() => void rollback()} className={SECONDARY_BUTTON}>
                    恢复同步前配置（{relativeTime(snapshotAt)}）
                  </button>
                )}
              </div>
              <p className="mt-3 text-[11.5px] leading-relaxed text-paper-faint">
                退出只清掉这台设备的云端凭证并停止同步，本机订阅、配置与密钥都会留下。
              </p>
            </Card>
          </SettingsSection>
        </>
      )}
    </SettingsShell>
  )
}
