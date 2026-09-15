/*
 * Zhihu x-zse-96 v3 signer.
 *
 * Protocol behavior and fixed vectors are independently ported from
 * ifccod/social-media-research-cli (MIT). See NOTICE for attribution.
 * This file intentionally contains no code copied from the AGPL Zhihu++ client.
 */
import { md5Hex } from '../../lib/hash'

export const ZHIHU_X_ZSE_93 = '101_3_3.0'

const SALT = '6fpLRqJO8M/c3jnYxFkUVC4ZIG12SiH=5v0mXDazWBTsuw7QetbKdoPyAl+hN9rgE'
const FIX = [48, 53, 57, 48, 53, 51, 102, 55, 100, 49, 53, 101, 48, 49, 100, 55]
const ROUND_KEYS = [
  1170614578, 1024848638, 1413669199, -343334464, -766094290, -1373058082,
  -143119608, -297228157, 1933479194, -971186181, -406453910, 460404854,
  -547427574, -1891326262, -1679095901, 2119585428, -2029270069, 2035090028,
  -1521520070, -5587175, -77751101, -2094365853, -1243052806, 1579901135,
  1321810770, 456816404, -1391643889, -229302305, 330002838, -788960546,
  363569021, -1947871109,
]
const SBOX = [
  20,223,245,7,248,2,194,209,87,6,227,253,240,128,222,91,237,9,125,157,230,93,252,205,90,79,144,199,159,197,186,167,
  39,37,156,198,38,42,43,168,217,153,15,103,80,189,71,191,97,84,247,95,36,69,14,35,12,171,28,114,178,148,86,182,
  32,83,158,109,22,255,94,238,151,85,77,124,254,18,4,26,123,176,232,193,131,172,143,142,150,30,10,146,162,62,224,218,
  196,229,1,192,213,27,110,56,231,180,138,107,242,187,54,120,19,44,117,228,215,203,53,239,251,127,81,11,133,96,204,132,
  41,115,73,55,249,147,102,48,122,145,106,118,74,190,29,16,174,5,177,129,63,113,99,31,161,76,246,34,211,13,60,68,
  207,160,65,111,82,165,67,169,225,57,112,244,155,51,236,200,233,58,61,47,100,137,185,64,17,70,234,163,219,108,170,166,
  59,149,52,105,24,212,78,173,45,0,116,226,119,136,206,135,175,195,25,92,121,208,126,139,3,75,141,21,130,98,241,40,
  154,66,184,49,181,46,243,88,101,183,8,23,72,188,104,179,210,134,250,201,164,89,216,202,220,50,221,152,140,33,235,214,
]

function u32(value: number): number {
  return value >>> 0
}

function rotl(value: number, shift: number): number {
  const source = u32(value)
  return u32((source << shift) | (source >>> (32 - shift)))
}

function word(block: number[], offset: number): number {
  return u32(
    ((block[offset] ?? 0) << 24) |
      ((block[offset + 1] ?? 0) << 16) |
      ((block[offset + 2] ?? 0) << 8) |
      (block[offset + 3] ?? 0),
  )
}

function bytes(value: number): number[] {
  const source = u32(value)
  return [source >>> 24, (source >>> 16) & 0xff, (source >>> 8) & 0xff, source & 0xff]
}

function linearTransform(value: number): number {
  const substituted = bytes(value).map((part) => SBOX[part] ?? 0)
  const source = word(substituted, 0)
  return u32(source ^ rotl(source, 2) ^ rotl(source, 10) ^ rotl(source, 18) ^ rotl(source, 24))
}

function round(block: number[]): number[] {
  if (block.length !== 16) throw new Error('知乎签名块长度异常')
  const state = [word(block, 0), word(block, 4), word(block, 8), word(block, 12)]
  ROUND_KEYS.forEach((key, index) => {
    const mixed = u32((state[index + 1] ?? 0) ^ (state[index + 2] ?? 0) ^ (state[index + 3] ?? 0) ^ u32(key))
    state.push(u32((state[index] ?? 0) ^ linearTransform(mixed)))
  })
  return [35, 34, 33, 32].flatMap((index) => bytes(state[index] ?? 0))
}

function encryptBlocks(source: number[], key: number[]): number[] {
  const result: number[] = []
  let currentKey = key
  for (let offset = 0; offset < source.length; offset += 16) {
    const block = source.slice(offset, offset + 16)
    if (block.length !== 16) throw new Error('知乎签名载荷未按块对齐')
    currentKey = round(block.map((value, index) => value ^ (currentKey[index] ?? 0)))
    result.push(...currentKey)
  }
  return result
}

function encodeChunk(value: number): string {
  return [0, 6, 12, 18].map((shift) => SALT[(value >>> shift) & 63] ?? '').join('')
}

function randomZseByte(): number {
  const bytes = new Uint8Array(1)
  crypto.getRandomValues(bytes)
  return (bytes[0] ?? 0) % 127
}

export function encryptZhihuMd5(md5: string, randomByte = randomZseByte()): string {
  const normalized = md5.toLowerCase()
  if (!/^[0-9a-f]{32}$/.test(normalized)) throw new Error('知乎签名 MD5 输入无效')
  if (!Number.isInteger(randomByte) || randomByte < 0 || randomByte > 126) {
    throw new Error('知乎签名随机字节超出范围')
  }

  const payload = [randomByte, 0, ...[...normalized].map((character) => character.charCodeAt(0)), ...Array(15).fill(14)]
  const front = payload.slice(0, 16).map((value, index) => value ^ (FIX[index] ?? 0) ^ 42)
  const first = round(front)
  const processed = [...first, ...encryptBlocks(payload.slice(16, 48), first)]

  let current = 0
  const encoded: string[] = []
  ;[...processed].reverse().forEach((item, index) => {
    const modifier = (58 >>> (8 * (index % 4))) & 0xff
    current |= (item ^ modifier) << (8 * (index % 3))
    if (index % 3 === 2) {
      encoded.push(encodeChunk(current))
      current = 0
    }
  })
  return encoded.join('')
}

/** apiPath must be the exact encoded path + query that will be sent. */
export function buildZhihuZse96(apiPath: string, dC0: string, randomByte?: number): string {
  if (!apiPath.startsWith('/api/')) throw new Error('知乎签名只接受 /api/ 绝对路径')
  if (!dC0) throw new Error('知乎签名缺少 d_c0')
  const digest = md5Hex(`${ZHIHU_X_ZSE_93}+${apiPath}+${dC0}`)
  return `2.0_${encryptZhihuMd5(digest, randomByte)}`
}
