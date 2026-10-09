/**
 * 同步状态 → 用户可见提示的映射（纯函数，便于直接断言）。
 *
 * 分寸感是这里唯一的设计目标：
 * - 后台自动同步成功是常态，不该有任何提示
 * - 真正需要用户知道的只有三类：首次同步完成、反复失败、出现需要决策的冲突
 * - 出错时给出短编号（requestId 前 8 位）方便对日志，但绝不带 Secret 或 token
 */

import type { SyncEvent, SyncStatus } from './SyncEngine'
import { SyncTransportError } from './transport'

export type SyncToastTone = 'info' | 'success' | 'warn' | 'error'

export interface SyncToastModel {
  tone: SyncToastTone
  text: string
  /** 需要用户去处理时给一个入口，例如打开「账户与同步」 */
  action?: 'open-account-sync'
  actionLabel?: string
}

/** 连续失败到这个次数才值得打扰用户；之前的失败只在设置页里体现 */
export const NOISY_FAILURE_ATTEMPT = 3

export function shortRequestId(requestId: string | null | undefined): string | null {
  if (!requestId) return null
  return requestId.slice(0, 8)
}

const ERROR_TEXT: Record<string, string> = {
  NETWORK_ERROR: '同步暂时连不上，恢复网络后会自动重试',
  RATE_LIMITED: '同步请求过于频繁，稍后自动重试',
  SERVICE_UNAVAILABLE: '同步服务暂时不可用，稍后自动重试',
  AUTH_REQUIRED: '登录已过期，请重新登录后继续同步',
  SESSION_EXPIRED: '登录已过期，请重新登录后继续同步',
  DEVICE_REVOKED: '这台设备的同步已被撤销，本地数据不受影响',
  DEVICE_IN_USE: '这台设备已绑定到另一个账户，正在重新登记…',
  PROTOCOL_UNSUPPORTED: '同步协议版本过旧，请升级到最新版本',
  VALIDATION_FAILED: '同步请求无效，请稍后重试',
}

function syncErrorText(code: string): string {
  return ERROR_TEXT[code] ?? '同步失败，稍后会自动重试'
}

/** 把同步/设备接口错误收成中文；优先用稳定 code，避免直接展示英文 message */
export function describeSyncError(error: unknown, fallback = '操作失败，请稍后再试'): string {
  if (error instanceof SyncTransportError) {
    return ERROR_TEXT[error.code] ?? (looksEnglish(error.message) ? fallback : error.message)
  }
  if (error instanceof Error) {
    return looksEnglish(error.message) ? fallback : error.message
  }
  return fallback
}

function looksEnglish(text: string): boolean {
  const letters = text.replace(/[^A-Za-z]/g, '')
  return letters.length >= 8 && letters.length >= text.length * 0.4
}

/** 引擎事件 → 应用内 Toast；返回 null 表示这次不该打扰用户 */
export function toastForSyncEvent(event: SyncEvent): SyncToastModel | null {
  switch (event.type) {
    case 'applied':
      // 后台悄悄拉到更新是常态，只有真的改了东西才值得说一声
      return event.records > 0
        ? { tone: 'info', text: `已同步 ${event.records} 项云端更新` }
        : null

    case 'first-sync-complete':
      return { tone: 'success', text: '云端同步已开启' }

    case 'conflicts':
      return event.conflicts.length
        ? {
            tone: 'warn',
            text: `有 ${event.conflicts.length} 处改动需要你决定保留哪一份`,
            action: 'open-account-sync',
            actionLabel: '去处理',
          }
        : null

    case 'failed': {
      const fatal = event.code === 'AUTH_REQUIRED' || event.code === 'SESSION_EXPIRED' || event.code === 'DEVICE_REVOKED'
      // 偶发失败自己会退避重试，不值得每次都弹；认证类问题必须立刻告诉用户
      if (!fatal && event.attempt < NOISY_FAILURE_ATTEMPT) return null

      const id = shortRequestId(event.requestId)
      return {
        tone: 'error',
        text: id ? `${syncErrorText(event.code)}（编号 ${id}）` : syncErrorText(event.code),
        action: fatal ? 'open-account-sync' : undefined,
        actionLabel: fatal ? '去处理' : undefined,
      }
    }

    default:
      return null
  }
}

/** 设置页与「我的」里显示的一行状态说明 */
export function syncStatusCaption(
  status: SyncStatus,
  options: { authenticated: boolean; now?: number } = { authenticated: false },
): string {
  if (!options.authenticated) return '未登录 · 本地阅读不受影响'

  switch (status.phase) {
    case 'syncing':
      return '正在同步…'
    case 'offline':
      return '离线 · 恢复网络后自动同步'
    case 'paused':
      return '同步已暂停 · 需要重新登录'
    case 'needs-first-sync':
      return '待选择首次同步方式'
    case 'error': {
      const id = shortRequestId(status.lastError?.requestId)
      const base = status.lastError ? syncErrorText(status.lastError.code) : '同步失败'
      return id ? `${base}（编号 ${id}）` : base
    }
    default:
      break
  }

  if (status.conflictCount > 0) return `${status.conflictCount} 处冲突待处理`
  if (status.pendingCount > 0) return `${status.pendingCount} 项改动待上传`
  if (status.lastSyncedAt) return `上次同步 ${relativeTime(status.lastSyncedAt, options.now)}`
  return '已登录 · 等待首次同步'
}

/** 系统通知的稳定 id：同一类反复发生时覆盖而不是堆叠 */
export const SYNC_NOTIFICATION_IDS = {
  firstSync: 'sync-first-complete',
  failure: 'sync-failure',
  conflict: 'sync-conflict',
} as const

export type SyncNotificationId = (typeof SYNC_NOTIFICATION_IDS)[keyof typeof SYNC_NOTIFICATION_IDS]

export interface SyncNotificationModel {
  id: SyncNotificationId
  title: string
  body: string
  /** 点开通知时要落到的页面；目前只有「账户与同步」 */
  route: 'account-sync'
}

export type AppVisibility = 'foreground' | 'background'

/**
 * 系统通知策略。前台永远用应用内 Toast，通知栏只留给三件事：
 * 首次同步完成、反复失败、需要用户裁决的冲突。
 *
 * 普通的后台同步成功、每次本地改动、前台同步一律返回 null——
 * 同步是背景能力，不该在通知栏刷存在感。
 */
export function mapSyncEventToNotification(
  event: SyncEvent,
  visibility: AppVisibility,
): SyncNotificationModel | null {
  if (visibility === 'foreground') return null

  switch (event.type) {
    case 'first-sync-complete':
      return {
        id: SYNC_NOTIFICATION_IDS.firstSync,
        title: '云端同步已开启',
        body: '订阅、分类与应用配置会在这台设备与云端之间保持一致。',
        route: 'account-sync',
      }

    case 'conflicts':
      if (!event.conflicts.length) return null
      return {
        id: SYNC_NOTIFICATION_IDS.conflict,
        title: '有改动需要你决定',
        body: `${event.conflicts.length} 处改动在两台设备上不一致，点开选择保留哪一份。`,
        route: 'account-sync',
      }

    case 'failed': {
      const fatal =
        event.code === 'AUTH_REQUIRED' ||
        event.code === 'SESSION_EXPIRED' ||
        event.code === 'DEVICE_REVOKED'
      if (!fatal && event.attempt < NOISY_FAILURE_ATTEMPT) return null
      const id = shortRequestId(event.requestId)
      return {
        id: SYNC_NOTIFICATION_IDS.failure,
        title: '同步没能完成',
        body: id ? `${syncErrorText(event.code)}（编号 ${id}）` : syncErrorText(event.code),
        route: 'account-sync',
      }
    }

    default:
      // 'applied' / 'status'：后台同步成功是常态，绝不进通知栏
      return null
  }
}

export function relativeTime(timestamp: number, now = Date.now()): string {
  const diff = Math.max(0, now - timestamp)
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  return `${Math.floor(hours / 24)} 天前`
}
