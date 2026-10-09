/*
 * Deterministic implementation of Zhihu's current ZSE v4 block transform.
 * Kept local so signed Web API requests do not depend on a WebView or Node crypto.
 */

const ZK = new Uint32Array([
  1170614578, 1024848638, 1413669199, 3951632832, 3528873006, 2921909214, 4151847688, 3997739139,
  1933479194, 3323781115, 3888513386, 460404854, 3747539722, 2403641034, 2615871395, 2119585428,
  2265697227, 2035090028, 2773447226, 4289380121, 4217216195, 2200601443, 3051914490, 1579901135,
  1321810770, 456816404, 2903323407, 4065664991, 330002838, 3506006750, 363569021, 2347096187,
])

const ZB = new Uint8Array([
  20, 223, 245, 7, 248, 2, 194, 209, 87, 6, 227, 253, 240, 128, 222, 91, 237, 9, 125, 157, 230,
  93, 252, 205, 90, 79, 144, 199, 159, 197, 186, 167, 39, 37, 156, 198, 38, 42, 43, 168, 217,
  153, 15, 103, 80, 189, 71, 191, 97, 84, 247, 95, 36, 69, 14, 35, 12, 171, 28, 114, 178, 148,
  86, 182, 32, 83, 158, 109, 22, 255, 94, 238, 151, 85, 77, 124, 254, 18, 4, 26, 123, 176, 232,
  193, 131, 172, 143, 142, 150, 30, 10, 146, 162, 62, 224, 218, 196, 229, 1, 192, 213, 27, 110,
  56, 231, 180, 138, 107, 242, 187, 54, 120, 19, 44, 117, 228, 215, 203, 53, 239, 251, 127, 81,
  11, 133, 96, 204, 132, 41, 115, 73, 55, 249, 147, 102, 48, 122, 145, 106, 118, 74, 190, 29, 16,
  174, 5, 177, 129, 63, 113, 99, 31, 161, 76, 246, 34, 211, 13, 60, 68, 207, 160, 65, 111, 82,
  165, 67, 169, 225, 57, 112, 244, 155, 51, 236, 200, 233, 58, 61, 47, 100, 137, 185, 64, 17, 70,
  234, 163, 219, 108, 170, 166, 59, 149, 52, 105, 24, 212, 78, 173, 45, 0, 116, 226, 119, 136,
  206, 135, 175, 195, 25, 92, 121, 208, 126, 139, 3, 75, 141, 21, 130, 98, 241, 40, 154, 66, 184,
  49, 181, 46, 243, 88, 101, 183, 8, 23, 72, 188, 104, 179, 210, 134, 250, 201, 164, 89, 216,
  202, 220, 50, 221, 152, 140, 33, 235, 214,
])

const ALPHABET = '6fpLRqJO8M/c3jnYxFkUVC4ZIG12SiH=5v0mXDazWBTsuw7QetbKdoPyAl+hN9rgE'
const KEY16 = new TextEncoder().encode('059053f7d15e01d7')
const textEncoder = new TextEncoder()

function rotateLeft(value: number, bits: number): number {
  return ((value << bits) | (value >>> (32 - bits))) >>> 0
}

function readU32Be(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] ?? 0) << 24)
    | ((bytes[offset + 1] ?? 0) << 16)
    | ((bytes[offset + 2] ?? 0) << 8)
    | (bytes[offset + 3] ?? 0)
  ) >>> 0
}

function writeU32Be(value: number, output: Uint8Array, offset: number): void {
  output[offset] = value >>> 24
  output[offset + 1] = value >>> 16
  output[offset + 2] = value >>> 8
  output[offset + 3] = value
}

function gTransform(value: number): number {
  const substituted = (
    ((ZB[(value >>> 24) & 0xff] ?? 0) << 24)
    | ((ZB[(value >>> 16) & 0xff] ?? 0) << 16)
    | ((ZB[(value >>> 8) & 0xff] ?? 0) << 8)
    | (ZB[value & 0xff] ?? 0)
  ) >>> 0
  return (
    substituted
    ^ rotateLeft(substituted, 2)
    ^ rotateLeft(substituted, 10)
    ^ rotateLeft(substituted, 18)
    ^ rotateLeft(substituted, 24)
  ) >>> 0
}

function rBlock(input: Uint8Array): Uint8Array {
  const words = new Uint32Array(36)
  words[0] = readU32Be(input, 0)
  words[1] = readU32Be(input, 4)
  words[2] = readU32Be(input, 8)
  words[3] = readU32Be(input, 12)

  for (let i = 0; i < 32; i += 1) {
    const mixed = ((words[i + 1] ?? 0) ^ (words[i + 2] ?? 0) ^ (words[i + 3] ?? 0) ^ (ZK[i] ?? 0)) >>> 0
    words[i + 4] = ((words[i] ?? 0) ^ gTransform(mixed)) >>> 0
  }

  const output = new Uint8Array(16)
  writeU32Be(words[35] ?? 0, output, 0)
  writeU32Be(words[34] ?? 0, output, 4)
  writeU32Be(words[33] ?? 0, output, 8)
  writeU32Be(words[32] ?? 0, output, 12)
  return output
}

function xBlocks(data: Uint8Array, initialIv: Uint8Array): Uint8Array {
  let iv = initialIv
  const output = new Uint8Array(data.length)
  for (let offset = 0; offset < data.length; offset += 16) {
    const mixed = new Uint8Array(16)
    for (let i = 0; i < 16; i += 1) mixed[i] = (data[offset + i] ?? 0) ^ (iv[i] ?? 0)
    iv = rBlock(mixed)
    output.set(iv, offset)
  }
  return output
}

function customEncode(input: Uint8Array): string {
  const paddedLength = Math.ceil(input.length / 3) * 3
  const bytes = new Uint8Array(paddedLength)
  bytes.set(input)
  let out = ''
  let index = 0

  for (let p = bytes.length - 1; p >= 0; p -= 3) {
    let value = 0
    for (let byteIndex = 0; byteIndex < 3; byteIndex += 1) {
      const byte = bytes[p - byteIndex] ?? 0
      const mask = (58 >>> (8 * (index % 4))) & 0xff
      index += 1
      value |= ((byte ^ mask) & 0xff) << (8 * byteIndex)
    }
    out += ALPHABET[value & 63]
    out += ALPHABET[(value >>> 6) & 63]
    out += ALPHABET[(value >>> 12) & 63]
    out += ALPHABET[(value >>> 18) & 63]
  }
  return out
}

/**
 * Encrypt the 32-character MD5 hex digest used by x-zse-96.
 * The leading marker and CBC-like transform intentionally match the current
 * first-party-compatible signer used by our verified Zhihu reference client.
 */
export function encryptZhihuZseV4(input: string): string {
  const body = textEncoder.encode(input)
  const unpaddedLength = 2 + body.length
  const paddingLength = 16 - (unpaddedLength % 16)
  const plain = new Uint8Array(unpaddedLength + paddingLength)
  plain[0] = 210
  plain[1] = 0
  plain.set(body, 2)
  plain.fill(paddingLength, unpaddedLength)

  const first = new Uint8Array(16)
  for (let i = 0; i < 16; i += 1) first[i] = (plain[i] ?? 0) ^ (KEY16[i] ?? 0) ^ 42

  const firstCipher = rBlock(first)
  const cipher = new Uint8Array(plain.length)
  cipher.set(firstCipher, 0)
  if (plain.length > 16) cipher.set(xBlocks(plain.subarray(16), firstCipher), 16)
  return customEncode(cipher)
}
