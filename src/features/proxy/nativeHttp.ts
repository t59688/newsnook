import { registerPlugin } from '@capacitor/core'

import type { NativeTunnelProxy } from './transport'

export type ProxiedHttpRequest = {
  url: string
  method?: string
  headers?: Record<string, string>
  data?: string
  /** 原始二进制请求体的 base64；与 data 二选一，原生层解码后再交给 OkHttp。 */
  dataBase64?: string
  /** OSS 等签名协议要求请求体存在但 Content-Type 行为空时使用；默认仍走既有 FORM fallback。 */
  omitContentType?: boolean
  proxy?: NativeTunnelProxy
  connectTimeout?: number
  readTimeout?: number
  /** 默认 false：由 JS 侧跟随重定向，与现有 CapacitorHttp 路径一致 */
  followRedirects?: boolean
}

export type ProxiedHttpResponse = {
  status: number
  headers: Record<string, string>
  /** 同名 Set-Cookie 必须逐条保留，不能用逗号拼接。旧版原生桥可能没有此字段。 */
  setCookies?: string[]
  /** base64 编码的响应体 */
  data: string
}

type ProxiedHttpPlugin = {
  request(options: ProxiedHttpRequest): Promise<ProxiedHttpResponse>
}

const ProxiedHttp = registerPlugin<ProxiedHttpPlugin>('ProxiedHttp')

export async function nativeProxiedRequest(
  options: ProxiedHttpRequest,
): Promise<ProxiedHttpResponse> {
  return ProxiedHttp.request(options)
}

export function decodeBase64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes.buffer
}
