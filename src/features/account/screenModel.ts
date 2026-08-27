/**
 * 「账户与同步」页的状态机（纯函数，便于直接断言）。
 *
 * 页面只有四种形态，任何一种都不阻断本地阅读：
 *   restoring   恢复登录中
 *   anonymous   登录 / 注册 / 找回密码
 *   first-sync  已登录但还没决定首次数据归属
 *   ready       日常态：状态、冲突、设备、绑定、退出
 */

import type { AccountStatus } from './useAccount'

export type AccountScreenView = 'restoring' | 'anonymous' | 'first-sync' | 'ready'

export type AccountScreenAction =
  | 'sign-in'
  | 'sign-up'
  | 'forgot-password'
  | 'social-sign-in'
  | 'adopt-local'
  | 'adopt-cloud'
  | 'adopt-merge'
  | 'sync-now'
  | 'resolve-conflicts'
  | 'manage-devices'
  | 'link-social'
  | 'sign-out'
  | 'rollback-snapshot'

export interface AccountScreenInput {
  accountStatus: AccountStatus
  firstSyncCompleted: boolean
  conflictCount: number
  /** 首次同步选择前留下的「同步前配置」快照是否还在 */
  hasSafetySnapshot: boolean
}

export interface AccountScreenModel {
  view: AccountScreenView
  actions: AccountScreenAction[]
}

const ANONYMOUS_ACTIONS: AccountScreenAction[] = [
  'sign-in',
  'sign-up',
  'forgot-password',
  'social-sign-in',
]

const FIRST_SYNC_ACTIONS: AccountScreenAction[] = ['adopt-local', 'adopt-cloud', 'adopt-merge']

export function accountScreenModel(input: AccountScreenInput): AccountScreenModel {
  if (input.accountStatus === 'restoring') return { view: 'restoring', actions: [] }
  if (input.accountStatus === 'anonymous') {
    return { view: 'anonymous', actions: ANONYMOUS_ACTIONS }
  }

  if (!input.firstSyncCompleted) {
    return { view: 'first-sync', actions: FIRST_SYNC_ACTIONS }
  }

  const actions: AccountScreenAction[] = ['sync-now']
  if (input.conflictCount > 0) actions.push('resolve-conflicts')
  actions.push('manage-devices', 'link-social', 'sign-out')
  if (input.hasSafetySnapshot) actions.push('rollback-snapshot')
  return { view: 'ready', actions }
}
