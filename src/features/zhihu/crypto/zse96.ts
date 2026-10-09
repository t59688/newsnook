import { md5Hex } from '../../../lib/hash'
import { encryptZhihuZseV4 } from './zseV4'
export { encryptZhihuZseV4 } from './zseV4'

export const ZHIHU_WEB_ZSE93 = '101_3_3.0'

function utf8AsLatin1(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let out = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    out += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return out
}

function md5Utf8(value: string): string {
  return md5Hex(utf8AsLatin1(value))
}

export function zhihuSigningPath(rawUrl: string): string {
  const url = new URL(rawUrl)
  return `${url.pathname}${url.search}`
}

/**
 * Current Web fetch signing source: zse93 + pathname/query + d_c0 + optional body.
 * The request method is not part of this signature version. JSON bodies must be
 * signed byte-for-byte exactly as they are sent.
 */
export function zhihuSignSource(
  rawUrl: string,
  dc0: string,
  body?: string,
  zse93 = ZHIHU_WEB_ZSE93,
): string {
  const parts = [zse93, zhihuSigningPath(rawUrl), dc0]
  if (body !== undefined) parts.push(body)
  return parts.join('+')
}

export function createZhihuZse96(
  rawUrl: string,
  dc0: string,
  body?: string,
  zse93 = ZHIHU_WEB_ZSE93,
): string {
  const digest = md5Utf8(zhihuSignSource(rawUrl, dc0, body, zse93))
  return `2.0_${encryptZhihuZseV4(digest)}`
}

export function buildZhihuZseHeaders(
  rawUrl: string,
  dc0: string,
  body?: string,
): Record<string, string> {
  return {
    'x-zse-93': ZHIHU_WEB_ZSE93,
    'x-zse-96': createZhihuZse96(rawUrl, dc0, body),
    'x-requested-with': 'fetch',
  }
}
