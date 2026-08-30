/**
 * 认证边界：未登录拒绝、邮箱验证、找回密码、同邮箱不隐式合并、Android 一次性 token 交接。
 * 需要真实 PostgreSQL（TEST_DATABASE_URL）。
 */
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

import {
  authHeaders,
  createSignedInUser,
  markEmailVerified,
  signIn,
  signUp,
  skipWithoutDatabase,
  startTestCloud,
  uniqueEmail,
  type TestCloud,
} from './helpers.js'

describe('auth', { skip: skipWithoutDatabase }, () => {
  let cloud: TestCloud

  before(async () => {
    cloud = await startTestCloud()
  })

  after(async () => {
    await cloud?.close()
  })

  it('rejects /api/v1/me without a session and includes a requestId', async () => {
    const response = await cloud.app.inject({ method: 'GET', url: '/api/v1/me' })
    assert.equal(response.statusCode, 401)
    const body = response.json()
    assert.equal(body.code, 'AUTH_REQUIRED')
    assert.ok(body.requestId, '错误体带 requestId 便于用户报错时对上日志')
  })

  it('sends a verification mail on sign-up and lets a verified email sign in', async () => {
    const email = uniqueEmail('verify')
    cloud.mailer.clear()
    await signUp(cloud, email)

    const mail = cloud.mailer.lastTo(email)
    assert.ok(mail, '注册后发出验证邮件')
    assert.ok(mail.url && mail.url.includes('/api/auth/verify-email'), '邮件里带验证链接')
    assert.ok(!mail.text.includes('correct-horse'), '邮件正文不含密码')

    const unverified = await signIn(cloud, email)
    assert.ok(unverified.statusCode >= 400, '未验证邮箱不能登录')

    await markEmailVerified(cloud.pools, email)
    const verified = await signIn(cloud, email)
    assert.equal(verified.statusCode, 200)
    assert.ok(verified.cookie.length > 0, 'Web 端拿到 Cookie Session')
  })

  it('exposes a bearer token for native clients after sign-in', async () => {
    const user = await createSignedInUser(cloud, 'bearer')
    assert.ok(user.bearerToken, 'Android 通过 set-auth-token 拿 bearer')

    const response = await cloud.app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { authorization: `Bearer ${user.bearerToken}` },
    })
    assert.equal(response.statusCode, 200)
    assert.equal(response.json().user.email, user.email)
  })

  it('emits a reset mail whose token changes the credential', async () => {
    const user = await createSignedInUser(cloud, 'reset')
    cloud.mailer.clear()

    const requested = await cloud.app.inject({
      method: 'POST',
      url: '/api/auth/request-password-reset',
      payload: { email: user.email, redirectTo: 'http://127.0.0.1:5173/reset' },
      headers: { 'content-type': 'application/json' },
    })
    assert.equal(requested.statusCode, 200)

    const mail = cloud.mailer.lastTo(user.email)
    assert.ok(mail?.url, '找回密码邮件带链接')
    const token = new URL(mail.url).pathname.split('/').pop() ?? ''
    assert.ok(token.length > 8)

    const reset = await cloud.app.inject({
      method: 'POST',
      url: '/api/auth/reset-password',
      payload: { newPassword: 'brand-new-password-2026', token },
      headers: { 'content-type': 'application/json' },
    })
    assert.equal(reset.statusCode, 200)

    const oldPassword = await signIn(cloud, user.email, user.password)
    assert.ok(oldPassword.statusCode >= 400, '旧密码失效')

    const newPassword = await signIn(cloud, user.email, 'brand-new-password-2026')
    assert.equal(newPassword.statusCode, 200)
  })

  it('never links a same-email OAuth identity implicitly', async () => {
    const user = await createSignedInUser(cloud, 'link')

    // 直接模拟「另一个 provider 用同一个邮箱注册」：配置层已禁止隐式合并，
    // 这里断言配置确实生效，且不存在把两个身份并到同一 user 的路径。
    const options = cloud.app.newsnookAuth.options as {
      account?: {
        accountLinking?: {
          enabled?: boolean
          disableImplicitLinking?: boolean
          allowDifferentEmails?: boolean
          trustedProviders?: string[]
        }
      }
    }
    const linking = options.account?.accountLinking
    assert.equal(linking?.enabled, true)
    assert.equal(linking?.disableImplicitLinking, true)
    assert.equal(linking?.allowDifferentEmails, true, '显式绑定应允许各平台邮箱不一致')

    const { rows } = await cloud.pools.app.query<{ total: string }>(
      'SELECT count(*)::text AS total FROM auth."user" WHERE email = $1',
      [user.email],
    )
    assert.equal(rows[0]?.total, '1')
  })

  it('includes every enabled OAuth provider in accountLinking.trustedProviders', async () => {
    const multiCloud = await startTestCloud({
      github: { clientId: 'gh-test-id', clientSecret: 'gh-test-secret' },
      linuxdo: { clientId: 'ld-test-id', clientSecret: 'ld-test-secret' },
    })
    const linking = (
      multiCloud.app.newsnookAuth.options as {
        account?: { accountLinking?: { trustedProviders?: string[] } }
      }
    ).account?.accountLinking
    assert.deepEqual(linking?.trustedProviders, ['github', 'linuxdo'])
    await multiCloud.close()
  })

  it('lists linked providers for the authenticated user', async () => {
    const user = await createSignedInUser(cloud, 'providers')
    const response = await cloud.app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: authHeaders(user),
    })
    assert.equal(response.statusCode, 200)
    assert.deepEqual(response.json().linkedProviders, ['credential'])
  })

  it('exposes enabled social sign-in providers without a session', async () => {
    const githubCloud = await startTestCloud({
      github: { clientId: 'gh-test-id', clientSecret: 'gh-test-secret' },
    })

    const response = await githubCloud.app.inject({
      method: 'GET',
      url: '/api/v1/auth/config',
    })
    assert.equal(response.statusCode, 200)
    assert.deepEqual(response.json().socialSignIn, ['github'])
    assert.equal(response.json().emailSignUp, true)

    await githubCloud.close()
  })

  it('rejects email sign-up when EMAIL_SIGN_UP_ENABLED is false', async () => {
    const closedCloud = await startTestCloud({ emailSignUpEnabled: false })

    const configResponse = await closedCloud.app.inject({
      method: 'GET',
      url: '/api/v1/auth/config',
    })
    assert.equal(configResponse.statusCode, 200)
    assert.equal(configResponse.json().emailSignUp, false)

    const signUpResponse = await closedCloud.app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      payload: {
        email: uniqueEmail('closed-signup'),
        password: 'correct-horse-1',
        name: 'Closed',
      },
      headers: { 'content-type': 'application/json' },
    })
    assert.ok(signUpResponse.statusCode >= 400, '关闭注册后 sign-up 应被拒绝')

    await closedCloud.close()
  })

  it('starts mobile OAuth from the browser context with a state cookie', async () => {
    const githubCloud = await startTestCloud({
      github: { clientId: 'gh-test-id', clientSecret: 'gh-test-secret' },
    })

    const response = await githubCloud.app.inject({
      method: 'GET',
      url: '/api/v1/auth/mobile/start/github',
    })
    assert.equal(response.statusCode, 302)
    assert.ok(
      (response.headers.location as string).includes('github.com') ||
        (response.headers.location as string).includes('github'),
      '应重定向到 GitHub 授权页',
    )
    const cookies = response.headers['set-cookie'] as string | string[] | undefined
    assert.ok(cookies, '应在 Custom Tab 上下文写入 OAuth state Cookie')
    const stateCookie = (Array.isArray(cookies) ? cookies : [cookies]).find((entry) =>
      entry.split('=')[0]?.endsWith('.state'),
    )
    assert.ok(stateCookie)
    assert.match(
      stateCookie,
      /Max-Age=600/i,
      'state Cookie 与服务端校验行同为 10 分钟：在授权页多停留一会儿不该变成 state_mismatch',
    )

    await githubCloud.close()
  })

  it('rejects the OAuth callback when link-social was started outside the browser', async () => {
    // 复现线上故障：App 在 WebView 里 fetch link-social，state Cookie 落在 WebView，
    // 回调却发生在 Custom Tab —— 校验行还在库里，Cookie 却对不上。
    const githubCloud = await startTestCloud({
      github: { clientId: 'gh-test-id', clientSecret: 'gh-test-secret' },
    })
    const user = await createSignedInUser(githubCloud, 'link-webview')

    const started = await githubCloud.app.inject({
      method: 'POST',
      url: '/api/auth/link-social',
      payload: { provider: 'github', callbackURL: 'http://127.0.0.1:5173/', disableRedirect: true },
      headers: { 'content-type': 'application/json', authorization: `Bearer ${user.bearerToken}` },
    })
    assert.equal(started.statusCode, 200)
    const state = new URL(started.json().url).searchParams.get('state') ?? ''
    assert.ok(state.length > 8)

    const callback = await githubCloud.app.inject({
      method: 'GET',
      url: `/api/auth/callback/github?code=fake-code&state=${encodeURIComponent(state)}`,
    })
    assert.equal(callback.statusCode, 302)
    assert.match(callback.headers.location as string, /error=state_mismatch/)

    await githubCloud.close()
  })

  it('hands the link flow to the browser so the state cookie matches the callback', async () => {
    const githubCloud = await startTestCloud({
      github: { clientId: 'gh-test-id', clientSecret: 'gh-test-secret' },
    })
    const user = await createSignedInUser(githubCloud, 'link-mobile')

    const anonymous = await githubCloud.app.inject({
      method: 'POST',
      url: '/api/v1/auth/mobile/link/github',
    })
    assert.equal(anonymous.statusCode, 401, '未登录不能发起绑定')

    const unsupported = await githubCloud.app.inject({
      method: 'POST',
      url: '/api/v1/auth/mobile/link/google',
      headers: { authorization: `Bearer ${user.bearerToken}` },
    })
    assert.ok(unsupported.statusCode >= 400, '未启用的 provider 不接受')

    const started = await githubCloud.app.inject({
      method: 'POST',
      url: '/api/v1/auth/mobile/link/github',
      headers: { authorization: `Bearer ${user.bearerToken}` },
    })
    assert.equal(started.statusCode, 200)

    const startUrl = new URL(started.json().url)
    assert.equal(startUrl.pathname, '/api/v1/auth/mobile/link/github')
    const ott = startUrl.searchParams.get('ott') ?? ''
    assert.ok(ott.length > 8)
    assert.ok(
      !started.body.includes(user.bearerToken ?? 'never'),
      '交给浏览器的只有一次性 token，没有长期 Session',
    )

    const redirect = await githubCloud.app.inject({
      method: 'GET',
      url: `${startUrl.pathname}${startUrl.search}`,
    })
    assert.equal(redirect.statusCode, 302)
    const authorizeUrl = new URL(redirect.headers.location as string)
    assert.match(authorizeUrl.host, /github/)
    const state = authorizeUrl.searchParams.get('state') ?? ''
    assert.ok(state.length > 8)

    const cookies = redirect.headers['set-cookie'] as string | string[] | undefined
    const stateCookie = (Array.isArray(cookies) ? cookies : [cookies ?? '']).find((entry) =>
      entry.split('=')[0]?.endsWith('.state'),
    )
    assert.ok(stateCookie, 'state Cookie 必须写在真正会接住回调的浏览器上')
    const signed = decodeURIComponent(stateCookie.split(';')[0]?.split('=')[1] ?? '')
    assert.ok(
      signed.startsWith(`${state}.`),
      'Cookie 里的 state 与授权 URL 上的 state 一致，回调才不会 state_mismatch',
    )

    const replay = await githubCloud.app.inject({
      method: 'GET',
      url: `${startUrl.pathname}${startUrl.search}`,
    })
    assert.equal(replay.statusCode, 401, '一次性 token 用后即焚')
    assert.match(replay.body, /绑定链接已失效/)

    const missing = await githubCloud.app.inject({
      method: 'GET',
      url: '/api/v1/auth/mobile/link/github',
    })
    assert.equal(missing.statusCode, 400)

    await githubCloud.close()
  })

  it('shows a friendly page when OAuth fails and lands on /?error=', async () => {
    const response = await cloud.app.inject({
      method: 'GET',
      url: '/?error=state_mismatch',
    })
    assert.equal(response.statusCode, 400)
    assert.match(response.body as string, /登录未完成/)
    assert.match(response.body as string, /state_mismatch/)
  })

  it('hands off a single-use token to the app without exposing the session', async () => {
    const user = await createSignedInUser(cloud, 'mobile')

    const complete = await cloud.app.inject({
      method: 'GET',
      url: '/api/v1/auth/mobile/complete',
      headers: { cookie: user.cookie },
    })
    assert.equal(complete.statusCode, 302)

    const location = complete.headers.location as string
    assert.ok(location.startsWith('newsnook://auth/callback?'), '固定深链目标，不接受任意跳转')
    const ott = new URL(location).searchParams.get('ott') ?? ''
    assert.ok(ott.length > 8)
    assert.ok(!location.includes(user.cookie.split('=')[1] ?? 'never'), '深链里没有长期 Session')

    const exchanged = await cloud.app.inject({
      method: 'POST',
      url: '/api/v1/auth/mobile/exchange',
      payload: { token: ott },
      headers: { 'content-type': 'application/json' },
    })
    assert.equal(exchanged.statusCode, 200)
    const body = exchanged.json()
    assert.ok(body.sessionToken.length > 8)
    assert.equal(body.user.email, user.email)

    // 用交换来的 token 当 bearer 能访问业务 API
    const me = await cloud.app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { authorization: `Bearer ${body.sessionToken}` },
    })
    assert.equal(me.statusCode, 200)

    const replay = await cloud.app.inject({
      method: 'POST',
      url: '/api/v1/auth/mobile/exchange',
      payload: { token: ott },
      headers: { 'content-type': 'application/json' },
    })
    assert.equal(replay.statusCode, 401, '一次性 token 用后即焚')
  })

  it('refuses the mobile handoff when the browser has no session', async () => {
    const response = await cloud.app.inject({
      method: 'GET',
      url: '/api/v1/auth/mobile/complete',
    })
    assert.equal(response.statusCode, 401)
    assert.ok(!('location' in response.headers), '未登录时不跳回 App')
  })

  it('rejects a forged handoff token', async () => {
    const response = await cloud.app.inject({
      method: 'POST',
      url: '/api/v1/auth/mobile/exchange',
      payload: { token: 'totally-made-up-token' },
      headers: { 'content-type': 'application/json' },
    })
    assert.equal(response.statusCode, 401)
    assert.equal(response.json().code, 'AUTH_REQUIRED')
  })
})
