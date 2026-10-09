import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { createMemorySecureStore } from '../src/features/account/secureStore'
import { ZhihuApiClient } from '../src/features/zhihu/api/client'
import { ZhihuApiError } from '../src/features/zhihu/api/errors'
import { ZhihuAccountService } from '../src/features/zhihu/session/account'
import { ZhihuSessionService } from '../src/features/zhihu/session/service'
import { ZhihuCredentialStore, zhihuSecureKey } from '../src/features/zhihu/session/store'
import { assertZhihuUrl } from '../src/features/zhihu/transport/safeRead'
import { applyZhihuResponseCookies, mergeZhihuRequestCookies, shouldSignZhihuRequest } from '../src/features/zhihu/transport/android'
import type { ZhihuRequest, ZhihuResponse, ZhihuTransport } from '../src/features/zhihu/transport/types'

class DelayedTransport implements ZhihuTransport {
  calls: ZhihuRequest[] = []
  resolvers: Array<(response: ZhihuResponse) => void> = []

  request(input: ZhihuRequest): Promise<ZhihuResponse> {
    this.calls.push(input)
    return new Promise((resolve) => this.resolvers.push(resolve))
  }
}

const session = new ZhihuSessionService()
const delayed = new DelayedTransport()
const client = new ZhihuApiClient(delayed, session)

const oldRequest = client.getJson('answer.read', 'https://www.zhihu.com/api/v4/answers/1')
assert.equal(delayed.calls.length, 1)
assert.equal(delayed.calls[0]?.generation, 1)
session.switchAccount({ id: 'account-b' })
delayed.resolvers[0]?.({ status: 200, headers: {}, body: '{"id":"1","type":"answer"}' })
await assert.rejects(oldRequest, (error: unknown) => {
  assert.ok(error instanceof ZhihuApiError)
  assert.equal(error.code, 'stale-generation')
  return true
})

class FlakyTransport implements ZhihuTransport {
  calls = 0
  async request(): Promise<ZhihuResponse> {
    this.calls += 1
    if (this.calls === 1) throw new Error('temporary network error')
    return { status: 200, headers: {}, body: '{"id":"1","type":"answer"}' }
  }
}

const guestSession = new ZhihuSessionService()
const flaky = new FlakyTransport()
const retryClient = new ZhihuApiClient(flaky, guestSession)
const result = await retryClient.getJson('answer.read', 'https://www.zhihu.com/api/v4/answers/1') as { id?: string }
assert.equal(result.id, '1')
assert.equal(flaky.calls, 2, 'safe-read 遇到瞬时网络失败必须自动重试')

class RetryableHttpTransport implements ZhihuTransport {
  calls = 0
  async request(): Promise<ZhihuResponse> {
    this.calls += 1
    if (this.calls < 3) return { status: 503, headers: {}, body: '{"message":"upstream busy"}' }
    return { status: 200, headers: {}, body: '{"id":"2","type":"answer"}' }
  }
}
const retryableHttp = new RetryableHttpTransport()
const retryableHttpClient = new ZhihuApiClient(retryableHttp, new ZhihuSessionService())
const recovered = await retryableHttpClient.getJson('answer.read', 'https://www.zhihu.com/api/v4/answers/2') as { id?: string }
assert.equal(recovered.id, '2')
assert.equal(retryableHttp.calls, 3, 'safe-read 对 5xx 应进行有界退避重试')

await assert.rejects(
  retryClient.getJson('message.list', 'https://api.zhihu.com/messages'),
  (error: unknown) => error instanceof ZhihuApiError && error.code === 'auth-expired',
  '需要认证的私有数据不能在 guest transport 上请求',
)

assert.equal(zhihuSecureKey('account/a', 'cookie jar'), 'site.zhihu.account_a.cookie_jar')
assert.equal(assertZhihuUrl('https://www.zhihu.com/api/v4/questions/1').hostname, 'www.zhihu.com')
assert.throws(() => assertZhihuUrl('https://example.com/api/v4/questions/1'))
assert.throws(() => assertZhihuUrl('http://www.zhihu.com/api/v4/questions/1'))
assert.equal(shouldSignZhihuRequest(new URL('https://www.zhihu.com/api/v4/answers/1')), true)
assert.equal(shouldSignZhihuRequest(new URL('https://api.zhihu.com/people/self')), true)
assert.equal(shouldSignZhihuRequest(new URL('https://api.zhihu.com/people/self'), 'web-zse96'), true)
assert.equal(shouldSignZhihuRequest(new URL('https://www.zhihu.com/api/v4/answers/1'), 'none'), false)
assert.equal(shouldSignZhihuRequest(new URL('https://api.zhihu.com/topstory/recommend'), 'none'), false)
assert.match(
  mergeZhihuRequestCookies('shared=www; www_only=1', 'shared=api; api_only=1', 'www.zhihu.com'),
  /shared=www/,
  'www 请求遇到同名 Cookie 时必须以 www jar 为准',
)
assert.match(
  mergeZhihuRequestCookies('shared=www; www_only=1', 'shared=api; api_only=1', 'api.zhihu.com'),
  /shared=api/,
  'api 请求遇到同名 Cookie 时必须以 api jar 为准',
)

const rotatedCookies = applyZhihuResponseCookies(
  '_xsrf=old-xsrf; d_c0=dc0',
  'z_c0=token; BEC=old-bec',
  'www.zhihu.com',
  [
    'BEC=new-bec; Domain=.zhihu.com; Path=/; Secure; HttpOnly',
    '_xsrf=new-xsrf; Path=/; Secure',
  ],
)
assert.match(rotatedCookies.wwwCookie, /BEC=new-bec/, '共享域 Cookie 必须同步到 www jar')
assert.match(rotatedCookies.apiCookie, /BEC=new-bec/, '共享域 Cookie 必须同步到 api jar')
assert.match(rotatedCookies.wwwCookie, /_xsrf=new-xsrf/, 'www host-only Cookie 必须更新 www jar')
assert.doesNotMatch(rotatedCookies.apiCookie, /_xsrf=new-xsrf/, 'www host-only Cookie 不能污染 api jar')

const emptyCredentialStore = new ZhihuCredentialStore(createMemorySecureStore())
const hydrateSession = new ZhihuSessionService()
const hydrateTransport = new DelayedTransport()
const hydrateClient = new ZhihuApiClient(hydrateTransport, hydrateSession)
const accountService = new ZhihuAccountService(hydrateSession, emptyCredentialStore, hydrateClient)
const guestGeneration = hydrateSession.getSnapshot().generation
assert.equal(await accountService.hydrate(), null)
assert.equal(hydrateSession.getSnapshot().generation, guestGeneration, 'guest 冷启动 hydrate 不得无意义 bump generation')
assert.equal(hydrateTransport.calls.length, 0, '没有保存账号时 hydrate 不应发私有会话校验请求')

const credentialStore = new ZhihuCredentialStore(createMemorySecureStore())
await credentialStore.saveAccount({
  account: { id: 'u-a', name: 'A' },
  wwwCookie: 'd_c0=a; _xsrf=x-a',
  apiCookie: 'z_c0=token-a',
  updatedAt: 1,
})
await credentialStore.saveAccount({
  account: { id: 'u-b', name: 'B' },
  wwwCookie: 'd_c0=b; _xsrf=x-b',
  apiCookie: 'z_c0=token-b',
  userAgent: 'Mozilla/5.0 ZhihuSessionTest',
  updatedAt: 2,
})
await credentialStore.setActiveAccountId('u-b')
assert.deepEqual(await credentialStore.listAccountIds(), ['u-a', 'u-b'])
assert.equal((await credentialStore.loadAccount('u-b'))?.account.name, 'B')
assert.equal((await credentialStore.loadAccount('u-b'))?.userAgent, 'Mozilla/5.0 ZhihuSessionTest', '认证 UA 必须随安全会话持久化')
assert.equal(await credentialStore.getActiveAccountId(), 'u-b')

class OfflineTransport implements ZhihuTransport {
  async request(): Promise<ZhihuResponse> {
    throw new Error('connection closed')
  }
}
const resumeSession = new ZhihuSessionService()
const resumeClient = new ZhihuApiClient(new OfflineTransport(), resumeSession)
const resumeService = new ZhihuAccountService(resumeSession, credentialStore, resumeClient)
const resumed = await resumeService.hydrate()
assert.equal(resumed?.account.id, 'u-b')
assert.equal(resumeSession.getSnapshot().auth, 'authenticated', '冷启动网络抖动不能把已持久化知乎账号误判成退出登录')
assert.equal(resumeSession.getSnapshot().account?.name, 'B', '网络失败时仍应展示本机已保存的账号资料')
await assert.rejects(
  resumeClient.getJson('answer.read', 'https://www.zhihu.com/api/v4/answers/1'),
  (error: unknown) => error instanceof ZhihuApiError
    && error.code === 'network'
    && error.message.includes('网络连接被中断'),
  '底层 TLS/连接中断应转换成用户可理解的知乎网络错误',
)

await credentialStore.removeAccount('u-b')
assert.equal(await credentialStore.getActiveAccountId(), null)
assert.deepEqual(await credentialStore.listAccountIds(), ['u-a'])

class IdentityOkTransport implements ZhihuTransport {
  async request(): Promise<ZhihuResponse> {
    return { status: 200, headers: {}, body: '{"id":"u-a","name":"A"}' }
  }
}
const repairedSession = new ZhihuSessionService()
const repairedService = new ZhihuAccountService(
  repairedSession,
  credentialStore,
  new ZhihuApiClient(new IdentityOkTransport(), repairedSession),
)
assert.equal((await repairedService.hydrate())?.account.id, 'u-a', 'active 键缺失时应从已持久化账号自修复')
assert.equal(await credentialStore.getActiveAccountId(), 'u-a')

class NeedLoginTransport implements ZhihuTransport {
  async request(): Promise<ZhihuResponse> {
    return {
      status: 403,
      headers: {},
      body: '{"error":{"need_login":true,"code":40353,"message":"请您登录后查看更多专业优质内容。"}}',
    }
  }
}
const needLoginSession = new ZhihuSessionService()
needLoginSession.switchAccount({ id: 'u-a', name: 'A' }, 'authenticated')
const needLoginClient = new ZhihuApiClient(new NeedLoginTransport(), needLoginSession)
await assert.rejects(
  needLoginClient.getJson('answer.read', 'https://www.zhihu.com/api/v4/answers/1'),
  (error: unknown) => error instanceof ZhihuApiError && error.code === 'auth-expired',
  '知乎 403 need_login 必须识别为会话过期，不能伪装成普通 forbidden',
)
assert.equal(needLoginSession.getSnapshot().auth, 'expired')

class SourceBackedWriteTransport implements ZhihuTransport {
  calls = 0
  async request(): Promise<ZhihuResponse> {
    this.calls += 1
    return { status: 200, headers: {}, body: '{}' }
  }
}
const writeSession = new ZhihuSessionService()
writeSession.switchAccount({ id: 'u-a' })
const writeTransport = new SourceBackedWriteTransport()
const writeClient = new ZhihuApiClient(writeTransport, writeSession)
await writeClient.postJson('vote.set', 'https://www.zhihu.com/api/v4/answers/1/voters', { type: 'up' })
assert.equal(writeTransport.calls, 1, '已有明确 endpoint 的 source-backed 写操作应进入原生 transport')

const mainActivity = readFileSync('android/app/src/main/java/com/aizeek/newsnook/MainActivity.java', 'utf8')
const nativeSession = readFileSync('android/app/src/main/java/com/aizeek/newsnook/ZhihuSessionPlugin.java', 'utf8')
const secureStorePlugin = readFileSync('android/app/src/main/java/com/aizeek/newsnook/SecureStorePlugin.java', 'utf8')
assert.match(mainActivity, /registerPlugin\(ZhihuSessionPlugin\.class\)/)
assert.match(nativeSession, /https:\/\/www\.zhihu\.com\/api\/v4\/me/)
assert.match(nativeSession, /endsWith\("\.zhihu\.com"\)/, '认证 WebView 必须限制第一方知乎域名')
assert.match(nativeSession, /clearBrowserSession/, '必须提供知乎域作用域的浏览器会话清理能力')
assert.match(nativeSession, /setAcceptThirdPartyCookies\(webView, true\)/, '登录 WebView 需要允许知乎跨子域认证 Cookie')
assert.match(nativeSession, /new OkHttpClient\.Builder\(\)/, '登录完成必须由原生 HTTP 校验第一方会话')
assert.match(nativeSession, /result\.put\("userAgent", userAgent\)/, '认证结果必须返回登录 WebView 的真实 UA，供后续 members API 复用')
assert.doesNotMatch(nativeSession, /evaluateJavascript\(script/, '不能用 evaluateJavascript 的 async Promise 回调判断登录完成')
assert.match(nativeSession, /title\.setText\("登录知乎"\)/, '认证 WebView 必须由 NewsNook 原生 chrome 提供明确标题')
assert.doesNotMatch(nativeSession, /close\.setText\("完成"\)/, '禁止再把“完成”按钮悬浮覆盖在知乎网页上')
assert.match(nativeSession, /WindowInsetsCompat\.Type\.displayCutout\(\)/, '认证原生 chrome 必须处理状态栏与打孔安全区')
assert.match(nativeSession, /webView\.canGoBack\(\)/, '系统返回应优先回退认证 WebView 历史而不是直接取消')
assert.match(nativeSession, /Domain=\.zhihu\.com/, '账号切换前应覆盖清理共享知乎域 Cookie')
assert.doesNotMatch(nativeSession, /\.\s*removeAllCookies\s*\(/, '禁止清除整个应用 WebView Cookie，避免破坏其它站点登录态')
assert.doesNotMatch(nativeSession, /getSharedPreferences\s*\(|localStorage\s*\./, '知乎会话插件不能绕过 SecureStore 落明文')
assert.match(secureStorePlugin, /putString\(key, stored\)\.commit\(\)/, '原生会话保存必须同步刷盘后才能返回成功')
assert.match(secureStorePlugin, /remove\(key\)\.commit\(\)/, '原生会话删除也必须完成刷盘再返回')

console.log('zhihu session/transport contract ok')
