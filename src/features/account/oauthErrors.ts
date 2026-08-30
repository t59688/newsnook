import type { SocialProvider } from './types'

/** Better Auth OAuth 回调 `?error=` 码 → 面向用户的中文说明 */
const OAUTH_CALLBACK_MESSAGES: Record<string, string> = {
  state_mismatch: '授权状态对不上，请回到应用重新发起绑定',
  email_does_not_match: '第三方账号邮箱与当前账户不一致，暂时无法绑定',
  unable_to_link_account: '暂时无法绑定该第三方账号，请确认已在授权页完成登录',
  account_already_linked_to_different_user: '该第三方账号已绑定到其他用户',
  email_not_verified: '第三方账号邮箱尚未验证，请先在对应平台完成验证',
  email_not_found: '第三方未返回邮箱，无法完成绑定',
  oauth_provider_not_found: '该登录方式暂未启用',
}

const PROVIDER_LABEL: Record<SocialProvider, string> = {
  google: 'Google',
  github: 'GitHub',
  linuxdo: 'Linux DO',
}

export function describeOAuthCallbackError(code: string): string {
  return OAUTH_CALLBACK_MESSAGES[code] ?? '第三方账号授权没能完成，请重试'
}

export function describeLinkedProvider(provider: string): string {
  if (provider in PROVIDER_LABEL) {
    return `已绑定 ${PROVIDER_LABEL[provider as SocialProvider]}`
  }
  return '已绑定新的登录方式'
}
