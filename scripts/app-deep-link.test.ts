/**
 * App 唤起深链：https App Links / newsnook:// 自定义 scheme 与网页引导条链接。
 * 与 lib/shareToken 共用同一个 token，这里验证 URL ↔ token ↔ payload 的还原链路。
 */

import assert from 'node:assert/strict'

import {
  ANDROID_APP_ID,
  APP_LINK_SCHEME,
  androidIntentShareUrl,
  appSchemeShareUrl,
  isAndroidBrowser,
  preferredOpenInAppUrl,
  sharePayloadFromAppUrl,
  shareTokenFromAppUrl,
} from '../src/lib/appDeepLink'
import { encodeShareToken } from '../src/lib/shareToken'

console.log('Testing app deep links...')

const token = encodeShareToken({
  sourceId: 'sspai',
  originUrl: 'https://sspai.com/post/12345',
})

// 1. https App Links：生产短链（含逃生门 query、hash、尾斜杠）都还原出 token
assert.equal(shareTokenFromAppUrl(`https://news.aizeek.com/a/${token}`), token)
assert.equal(shareTokenFromAppUrl(`https://news.aizeek.com/a/${token}?app=1`), token)
assert.equal(shareTokenFromAppUrl(`https://news.aizeek.com/a/${token}#frag`), token)
assert.equal(shareTokenFromAppUrl(`https://news.aizeek.com/a/${token}/`), token)

// 2. 自定义 scheme：newsnook://a/<token> 同样还原，且不吞多段路径
assert.equal(shareTokenFromAppUrl(`newsnook://a/${token}`), token)
assert.equal(shareTokenFromAppUrl(`newsnook://a/${token}?from=web`), token)
assert.equal(shareTokenFromAppUrl(`newsnook://a/${token}/`), token)
assert.equal(shareTokenFromAppUrl('newsnook://a/'), null)
assert.equal(shareTokenFromAppUrl(`newsnook://a/${token}/extra`), null)

// 3. 非分享 URL 一律拒绝：其它 host、其它 scheme、其它路径、垃圾输入
assert.equal(shareTokenFromAppUrl('https://evil.example.com/a/abc'), null, '只认生产 host')
assert.equal(shareTokenFromAppUrl('https://news.aizeek.com/about'), null)
assert.equal(shareTokenFromAppUrl('capacitor://localhost/'), null)
assert.equal(shareTokenFromAppUrl('javascript:alert(1)'), null)
assert.equal(shareTokenFromAppUrl(''), null)
assert.equal(shareTokenFromAppUrl('not a url'), null)

// 4. URL → payload 一步还原；损坏 token 返回 null 由调用方弹提示
const payload = sharePayloadFromAppUrl(`https://news.aizeek.com/a/${token}`)
assert.ok(payload, '合法深链应解出 payload')
assert.equal(payload.originUrl, 'https://sspai.com/post/12345')
assert.equal(payload.sourceId, 'sspai')
assert.equal(sharePayloadFromAppUrl('https://news.aizeek.com/a/broken*token'), null)
assert.equal(
  sharePayloadFromAppUrl(`newsnook://a/${token}`)?.originUrl,
  'https://sspai.com/post/12345',
  '自定义 scheme 与 https 应解出同一 payload',
)

// 5. 引导条链接：intent:// 指定包名与 https scheme，且不带商店 fallback
const intentUrl = androidIntentShareUrl(token)
assert.ok(intentUrl.startsWith(`intent://news.aizeek.com/a/${token}#Intent;`))
assert.ok(intentUrl.includes(`package=${ANDROID_APP_ID};`))
assert.ok(intentUrl.includes('scheme=https;'))
assert.ok(!intentUrl.includes('browser_fallback_url'), '未安装时留在网页，不跳商店')
assert.ok(intentUrl.endsWith(';end'))

assert.equal(appSchemeShareUrl(token), `${APP_LINK_SCHEME}://a/${token}`)

// 6. 浏览器选择：Chromium 系用 intent://，其余退回自定义 scheme
const CHROME_ANDROID =
  'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36'
const FIREFOX_ANDROID = 'Mozilla/5.0 (Android 14; Mobile; rv:126.0) Gecko/126.0 Firefox/126.0'
assert.equal(preferredOpenInAppUrl(token, CHROME_ANDROID), intentUrl)
assert.equal(preferredOpenInAppUrl(token, FIREFOX_ANDROID), appSchemeShareUrl(token))

// 7. 引导条展示条件：只给 Android 浏览器；微信 / 企业微信内禁止唤起，不展示；iOS 无 App
assert.equal(isAndroidBrowser(CHROME_ANDROID), true)
assert.equal(isAndroidBrowser(FIREFOX_ANDROID), true)
assert.equal(
  isAndroidBrowser(
    'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126.0.0.0 Mobile Safari/537.36 XWEB/1160065 MMWEBSDK/20231202 MicroMessenger/8.0.47',
  ),
  false,
  '微信内置浏览器不展示引导条',
)
assert.equal(isAndroidBrowser('Mozilla/5.0 (Linux; Android 13) wxwork/4.1.20'), false)
assert.equal(
  isAndroidBrowser(
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1',
  ),
  false,
)
assert.equal(
  isAndroidBrowser('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0.0.0 Safari/537.36'),
  false,
)

console.log('App deep link tests: ALL PASSED')
