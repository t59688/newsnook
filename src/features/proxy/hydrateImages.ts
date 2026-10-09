import { Capacitor } from '@capacitor/core'
import { parseHTML } from 'linkedom'

import { getRuntimeProxyPrefs, nativeFetchBytes } from '../../lib/http'
import { shouldAutoLoadMedia } from '../../lib/mediaLoadPolicy'
import { getRuntimeWifiOnlyAutoLoadMedia } from '../../lib/mediaLoadRuntime'
import { getConnectionType } from '../../lib/networkStatus'
import { currentProxyRuntime } from './runtime'
import { resolveProxyTransport } from './transport'

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

async function resolveAutoLoadMedia(override?: boolean): Promise<boolean> {
  if (typeof override === 'boolean') return override
  return shouldAutoLoadMedia({
    wifiOnlyAutoLoadMedia: getRuntimeWifiOnlyAutoLoadMedia(),
    isNative: Capacitor.isNativePlatform(),
    connectionType: await getConnectionType(),
  })
}

export async function resolvePlayableImageSrc(
  url: string,
  options?: {
    /** WebView 直连失败后，强制改用 Capacitor/OkHttp 字节请求，即使当前未配置隧道代理。 */
    forceNative?: boolean
    /** 部分图片 CDN（尤其 zhimg）会校验来源；失败补救时显式发送正文来源。 */
    referer?: string
    signal?: AbortSignal
  },
): Promise<string> {
  if (!url.startsWith('http')) return url
  if (!Capacitor.isNativePlatform()) return url

  const prefs = getRuntimeProxyPrefs()
  const runtime = currentProxyRuntime()
  const transport = resolveProxyTransport(url, undefined, prefs, runtime)
  const tunnel = transport.kind === 'native-tunnel' ? transport.tunnel : undefined
  if (!options?.forceNative && !tunnel) return url
  if (transport.kind === 'unsupported') return url

  try {
    const host = new URL(url).hostname.toLowerCase()
    const referer = options?.referer ?? (host.endsWith('.zhimg.com') || host === 'zhimg.com' ? 'https://www.zhihu.com/' : undefined)
    const requestUrl = transport.kind === 'web-wrap' ? transport.requestUrl : url
    const result = await nativeFetchBytes(
      requestUrl,
      {
        'User-Agent': BROWSER_UA,
        Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        ...(referer ? { Referer: referer } : {}),
      },
      tunnel,
      options?.signal,
    )
    if (result.status < 200 || result.status >= 300) return url
    const type = result.contentType || 'image/jpeg'
    if (result.contentType && !result.contentType.toLowerCase().startsWith('image/')) return url
    const blob = new Blob([result.data], { type })
    return URL.createObjectURL(blob)
  } catch {
    return url
  }
}

export function revokeBlobUrl(url: string | null | undefined): void {
  if (url?.startsWith('blob:')) URL.revokeObjectURL(url)
}

/**
 * App 在 native-tunnel 下把需代理的 <img> 换成 blob:，
 * 因 WebView 不会走 OkHttp 用户代理。
 */
export async function hydrateNativeTunnelImages(
  html: string,
  options?: { autoLoadMedia?: boolean },
): Promise<string> {
  if (!(await resolveAutoLoadMedia(options?.autoLoadMedia))) return html
  if (!Capacitor.isNativePlatform()) return html

  const { document } = parseHTML(`<div id="newsnook-hydrate">${html}</div>`)
  const root = document.getElementById('newsnook-hydrate')
  if (!root) return html

  const images = Array.from(root.querySelectorAll('img'))
  await Promise.all(
    images.map(async (img) => {
      const src = img.getAttribute('src')
      if (!src || !src.startsWith('http')) return
      const next = await resolvePlayableImageSrc(src)
      if (next === src) return
      img.setAttribute('src', next)
      img.removeAttribute('srcset')
    }),
  )

  return root.innerHTML
}
