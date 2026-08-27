/**
 * 账户适配器：认证深链只认 auth/callback、Web 不落任何长期凭证、
 * Android 的 bearer 只进 SecureStore、退出登录清干净本机凭证。
 * 用法：npx tsx scripts/account-auth.test.ts
 */
import assert from 'node:assert/strict'

import { shareTokenFromAppUrl } from '../src/lib/appDeepLink'
import { createAccountAdapter } from '../src/features/account/authClient'
import { isAuthCallbackUrl, oneTimeTokenFromAppUrl } from '../src/features/account/mobileCallback'
import {
  SECURE_KEYS,
  createMemorySecureStore,
  readStoredSession,
  secureSecretKey,
  writeStoredSession,
} from '../src/features/account/secureStore'
import { AccountError } from '../src/features/account/types'

console.log('Testing account adapters...')

const BASE_URL = 'https://cloud.example.test'

interface RecordedRequest {
  url: string
  method: string
  headers: Record<string, string>
  body: unknown
  credentials: string
}

interface StubResponse {
  status?: number
  body?: unknown
  headers?: Record<string, string>
}

function createFetchStub(routes: Record<string, StubResponse | (() => StubResponse)>) {
  const requests: RecordedRequest[] = []

  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const path = url.slice(BASE_URL.length)
    const headers: Record<string, string> = {}
    for (const [key, value] of Object.entries((init?.headers ?? {}) as Record<string, string>)) {
      headers[key.toLowerCase()] = value
    }
    requests.push({
      url,
      method: init?.method ?? 'GET',
      headers,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
      credentials: String(init?.credentials ?? ''),
    })

    const route = routes[path]
    const stub = typeof route === 'function' ? route() : route
    if (!stub) return new Response('not found', { status: 404 })
    return new Response(stub.body === undefined ? '' : JSON.stringify(stub.body), {
      status: stub.status ?? 200,
      headers: { 'content-type': 'application/json', ...stub.headers },
    })
  }) as typeof fetch

  return { fetchImpl, requests }
}

function meBody(email = 'reader@example.test') {
  return {
    user: { id: 'user-1', email, name: null, emailVerified: true, image: null },
    linkedProviders: ['credential'],
    device: null,
  }
}

// --- 深链解析 ---------------------------------------------------------------

assert.equal(
  oneTimeTokenFromAppUrl('newsnook://auth/callback?ott=abc123'),
  'abc123',
  '认证深链取出一次性 token',
)
assert.equal(
  oneTimeTokenFromAppUrl('NEWSNOOK://AUTH/CALLBACK?ott=Case-Kept'),
  'Case-Kept',
  'scheme 大小写不敏感，token 原样保留',
)
assert.equal(
  oneTimeTokenFromAppUrl('newsnook://auth/callback?state=x&ott=with%20space#done'),
  'with space',
  'token 做一次 URL 解码，锚点不参与',
)
assert.equal(oneTimeTokenFromAppUrl('newsnook://auth/callback'), null, '缺少 ott 不算认证回流')
assert.equal(
  oneTimeTokenFromAppUrl('newsnook://a/eyJ2IjoyfQ?ott=nope'),
  null,
  '分享深链绝不能被当成认证深链',
)
assert.equal(
  oneTimeTokenFromAppUrl('newsnook://auth/callbackevil?ott=abc'),
  null,
  '前缀相同但路径不同的 URL 不接受',
)
assert.equal(
  oneTimeTokenFromAppUrl('https://cloud.example.test/auth/callback?ott=abc'),
  null,
  '只认自定义 scheme',
)

assert.ok(isAuthCallbackUrl('newsnook://auth/callback?ott=x'))
assert.ok(!isAuthCallbackUrl('newsnook://a/token'))
assert.equal(
  shareTokenFromAppUrl('newsnook://auth/callback?ott=abc123'),
  null,
  '分享解析器同样不吃认证深链',
)

// --- SecureStore ------------------------------------------------------------

{
  const store = createMemorySecureStore()
  await writeStoredSession(store, { token: 'tok', userId: 'user-1', expiresAt: 0 })
  const restored = await readStoredSession(store)
  assert.equal(restored?.token, 'tok')

  await writeStoredSession(store, { token: 'old', userId: 'user-1', expiresAt: Date.now() - 1000 })
  assert.equal(await readStoredSession(store), null, '过期会话不再使用')

  await store.set(SECURE_KEYS.session, 'not json')
  assert.equal(await readStoredSession(store), null, '损坏的会话记录当作未登录')
  assert.equal(secureSecretKey('proxy.url'), 'secret.proxy.url')
}

// --- Web：Cookie Session，不保管长期凭证 ------------------------------------

{
  const { fetchImpl, requests } = createFetchStub({
    '/api/auth/sign-in/email': { body: { user: { id: 'user-1' } } },
    '/api/v1/me': { body: meBody() },
  })
  const store = createMemorySecureStore()
  const opened: string[] = []
  const adapter = createAccountAdapter({
    platform: 'web',
    baseUrl: BASE_URL,
    secureStore: store,
    fetchImpl,
    openExternal: (url) => {
      opened.push(url)
    },
    webCallbackUrl: () => 'https://news.example.test/',
  })

  const session = await adapter.signIn('reader@example.test', 'correct-horse')
  assert.equal(session.user.email, 'reader@example.test')
  assert.deepEqual(session.linkedProviders, ['credential'])

  const signInRequest = requests[0]!
  assert.equal(signInRequest.credentials, 'include', 'Web 靠 Cookie 认证')
  assert.ok(!('authorization' in signInRequest.headers), 'Web 不发 bearer')
  assert.equal(await store.get(SECURE_KEYS.session), null, 'Web 不保存任何长期凭证')
  assert.equal(opened.length, 0)
}

// --- Web 社交登录：当前页跳转 ------------------------------------------------

{
  const { fetchImpl, requests } = createFetchStub({
    '/api/auth/sign-in/social': { body: { url: 'https://accounts.google.test/o/oauth2', redirect: true } },
  })
  const opened: string[] = []
  const adapter = createAccountAdapter({
    platform: 'web',
    baseUrl: BASE_URL,
    secureStore: createMemorySecureStore(),
    fetchImpl,
    openExternal: (url) => {
      opened.push(url)
    },
    webCallbackUrl: () => 'https://news.example.test/',
  })

  assert.equal(await adapter.startSocialSignIn('google'), 'redirect')
  assert.equal(opened[0], 'https://accounts.google.test/o/oauth2')
  assert.equal(requests[0]!.body && (requests[0]!.body as { callbackURL: string }).callbackURL,
    'https://news.example.test/',
    'Web 回跳到自己的页面')
}

// --- Android：bearer 只落 SecureStore ---------------------------------------

{
  const { fetchImpl, requests } = createFetchStub({
    '/api/auth/sign-in/email': {
      body: { user: { id: 'user-1' } },
      headers: { 'set-auth-token': 'long-lived-token' },
    },
    '/api/v1/me': { body: meBody() },
  })
  const store = createMemorySecureStore()
  const adapter = createAccountAdapter({
    platform: 'android',
    baseUrl: BASE_URL,
    secureStore: store,
    fetchImpl,
    openExternal: () => {},
  })

  await adapter.signIn('reader@example.test', 'correct-horse')

  const stored = await readStoredSession(store)
  assert.equal(stored?.token, 'long-lived-token', 'Android 的长期 token 存进 SecureStore')
  assert.equal(stored?.userId, 'user-1')

  const meRequest = requests.find((request) => request.url.endsWith('/api/v1/me'))!
  assert.equal(meRequest.headers.authorization, 'Bearer long-lived-token')
  assert.equal(meRequest.credentials, 'omit', 'Android 不依赖 WebView Cookie')

  // 同步引擎共用同一个出口，凭证由适配器负责挂上
  const cloudResponse = await adapter.fetchCloud('/api/v1/me')
  assert.equal(cloudResponse.status, 200)
}

// --- Android：SecureStore 里没有 token 时不算已登录 --------------------------

{
  const { fetchImpl, requests } = createFetchStub({ '/api/v1/me': { body: meBody() } })
  const adapter = createAccountAdapter({
    platform: 'android',
    baseUrl: BASE_URL,
    secureStore: createMemorySecureStore(),
    fetchImpl,
    openExternal: () => {},
  })

  assert.equal(await adapter.restore(), null, '没有安全存储凭证就是未登录')
  assert.equal(requests.length, 0, '不发无意义的请求')
}

// --- Android：恢复已存的会话 -------------------------------------------------

{
  const { fetchImpl } = createFetchStub({ '/api/v1/me': { body: meBody() } })
  const store = createMemorySecureStore()
  await writeStoredSession(store, { token: 'restored-token', userId: 'user-1', expiresAt: 0 })

  const adapter = createAccountAdapter({
    platform: 'android',
    baseUrl: BASE_URL,
    secureStore: store,
    fetchImpl,
    openExternal: () => {},
  })

  const session = await adapter.restore()
  assert.equal(session?.user.id, 'user-1', '进程被杀后仍能从 SecureStore 恢复')
}

// --- Android：一次性 token 交换 ---------------------------------------------

{
  const exchanged: unknown[] = []
  const { fetchImpl, requests } = createFetchStub({
    '/api/v1/auth/mobile/exchange': {
      body: {
        sessionToken: 'session-from-ott',
        expiresAt: Date.now() + 86_400_000,
        user: { id: 'user-9', email: 'social@example.test', name: null },
      },
    },
    '/api/v1/me': { body: meBody('social@example.test') },
  })
  const store = createMemorySecureStore()
  const adapter = createAccountAdapter({
    platform: 'android',
    baseUrl: BASE_URL,
    secureStore: store,
    fetchImpl,
    openExternal: () => {},
  })

  assert.equal(
    await adapter.handleAuthDeepLink('newsnook://a/share-token'),
    null,
    '分享深链交给分享逻辑处理',
  )
  assert.equal(requests.length, 0)

  const session = await adapter.handleAuthDeepLink('newsnook://auth/callback?ott=one-time')
  assert.equal(session?.user.email, 'social@example.test')
  exchanged.push(requests[0]!.body)
  assert.deepEqual(exchanged[0], { token: 'one-time' })

  const stored = await readStoredSession(store)
  assert.equal(stored?.token, 'session-from-ott')
  assert.ok(stored!.expiresAt > Date.now(), '记住过期时间')
}

// --- Android 社交登录：系统浏览器 + 固定回调 ---------------------------------

{
  const { fetchImpl, requests } = createFetchStub({
    '/api/auth/sign-in/social': { body: { url: 'https://github.test/login/oauth' } },
    '/api/auth/link-social': { body: { url: 'https://github.test/login/oauth/link' } },
  })
  const opened: string[] = []
  const adapter = createAccountAdapter({
    platform: 'android',
    baseUrl: BASE_URL,
    secureStore: createMemorySecureStore(),
    fetchImpl,
    openExternal: (url) => {
      opened.push(url)
    },
  })

  assert.equal(await adapter.startSocialSignIn('github'), 'external')
  assert.equal(opened[0], 'https://github.test/login/oauth')
  assert.equal(
    (requests[0]!.body as { callbackURL: string }).callbackURL,
    `${BASE_URL}/api/v1/auth/mobile/complete`,
    'Android 回调固定走服务端交接页',
  )

  assert.equal(await adapter.linkSocial('github'), 'external')
  assert.equal(opened[1], 'https://github.test/login/oauth/link', '绑定走 link-social，不是重新登录')
}

// --- 退出登录：只清凭证 ------------------------------------------------------

{
  const { fetchImpl, requests } = createFetchStub({
    '/api/auth/sign-out': { body: { success: true } },
    '/api/v1/me': { body: meBody() },
  })
  const store = createMemorySecureStore()
  await writeStoredSession(store, { token: 'to-be-cleared', userId: 'user-1', expiresAt: 0 })
  await store.set(secureSecretKey('proxy.url'), 'socks5://example.test:1080')

  const adapter = createAccountAdapter({
    platform: 'android',
    baseUrl: BASE_URL,
    secureStore: store,
    fetchImpl,
    openExternal: () => {},
  })

  await adapter.signOut()
  assert.equal(await store.get(SECURE_KEYS.session), null, '本机云端凭证清空')
  assert.equal(
    await store.get(secureSecretKey('proxy.url')),
    'socks5://example.test:1080',
    '退出登录不动本机配置与 Secret',
  )
  assert.ok(requests.some((request) => request.url.endsWith('/api/auth/sign-out')))
}

// --- 云端不可达 --------------------------------------------------------------

{
  const failing = (async () => {
    throw new Error('offline')
  }) as unknown as typeof fetch

  const store = createMemorySecureStore()
  await writeStoredSession(store, { token: 'tok', userId: 'user-1', expiresAt: 0 })
  const adapter = createAccountAdapter({
    platform: 'android',
    baseUrl: BASE_URL,
    secureStore: store,
    fetchImpl: failing,
    openExternal: () => {},
  })

  assert.equal(await adapter.restore(), null, '断网时静默退回未登录视图')
  assert.ok(await store.get(SECURE_KEYS.session), '断网不清除凭证，恢复网络后还能用')

  await adapter.signOut()
  assert.equal(await store.get(SECURE_KEYS.session), null, '云端不可达也能退出本机')
}

// --- 错误映射 ----------------------------------------------------------------

{
  const { fetchImpl } = createFetchStub({
    '/api/auth/sign-in/email': {
      status: 401,
      body: { code: 'INVALID_EMAIL_OR_PASSWORD', message: 'Invalid email or password' },
    },
  })
  const adapter = createAccountAdapter({
    platform: 'web',
    baseUrl: BASE_URL,
    secureStore: createMemorySecureStore(),
    fetchImpl,
    openExternal: () => {},
  })

  await assert.rejects(
    () => adapter.signIn('reader@example.test', 'wrong'),
    (error: unknown) => {
      assert.ok(error instanceof AccountError)
      assert.equal(error.code, 'INVALID_EMAIL_OR_PASSWORD')
      assert.ok(error.authRequired)
      return true
    },
  )
}

// --- 注册需要邮箱验证 --------------------------------------------------------

{
  const { fetchImpl } = createFetchStub({
    '/api/auth/sign-up/email': { body: { user: { id: 'user-2' }, token: null } },
  })
  const adapter = createAccountAdapter({
    platform: 'web',
    baseUrl: BASE_URL,
    secureStore: createMemorySecureStore(),
    fetchImpl,
    openExternal: () => {},
  })

  const result = await adapter.signUp({ email: 'new@example.test', password: 'correct-horse-1' })
  assert.equal(result.verificationRequired, true, '未返回会话即代表要先验证邮箱')
}

console.log('All account adapter tests passed.')
