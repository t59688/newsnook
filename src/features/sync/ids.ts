/**
 * 同步专用 id。设备、mutation、conflict 用 UUID；业务实体一律复用 NewsNook 既有 id。
 *
 * 不直接依赖 `crypto.randomUUID`：旧 Android WebView 与非安全上下文里可能没有。
 */

const HEX = '0123456789abcdef'

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length)
  const webCrypto = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined
  if (webCrypto?.getRandomValues) {
    webCrypto.getRandomValues(bytes)
    return bytes
  }
  for (let index = 0; index < length; index += 1) bytes[index] = Math.floor(Math.random() * 256)
  return bytes
}

/** RFC 4122 v4；服务端 `uuidSchema` 会校验版本位与变体位 */
export function randomUuid(): string {
  const bytes = randomBytes(16)
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80

  let out = ''
  for (let index = 0; index < 16; index += 1) {
    if (index === 4 || index === 6 || index === 8 || index === 10) out += '-'
    const byte = bytes[index]!
    out += HEX[byte >> 4]! + HEX[byte & 0x0f]!
  }
  return out
}
