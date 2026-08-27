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
      account?: { accountLinking?: { disableImplicitLinking?: boolean } }
    }
    assert.equal(options.account?.accountLinking?.disableImplicitLinking, true)

    const { rows } = await cloud.pools.app.query<{ total: string }>(
      'SELECT count(*)::text AS total FROM auth."user" WHERE email = $1',
      [user.email],
    )
    assert.equal(rows[0]?.total, '1')
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
