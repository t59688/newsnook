import assert from 'node:assert/strict'
import { assertElfPageAlignment } from './android-apk-pages.mjs'

function elf(loadAlignment, relroEnd) {
  const data = Buffer.alloc(176)
  data.writeUInt32LE(0x464c457f, 0); data[4] = 2; data[5] = 1
  data.writeBigUInt64LE(64n, 32); data.writeUInt16LE(56, 54); data.writeUInt16LE(2, 56)
  data.writeUInt32LE(1, 64); data.writeBigUInt64LE(BigInt(loadAlignment), 112)
  data.writeUInt32LE(0x6474e552, 120)
  data.writeBigUInt64LE(16384n, 136); data.writeBigUInt64LE(BigInt(relroEnd - 16384), 160)
  return data
}
assert.doesNotThrow(() => assertElfPageAlignment(elf(16384, 32768), 'aligned.so'))
assert.throws(() => assertElfPageAlignment(elf(4096, 32768), 'old-jni.so'), /LOAD/)
assert.throws(() => assertElfPageAlignment(elf(16384, 20480), 'old-libc++.so'), /RELRO/)
const suffix = elf(16384, 20480)
suffix.writeUInt32LE(6, 68); suffix.writeBigUInt64LE(16384n, 80); suffix.writeBigUInt64LE(4096n, 104)
assert.doesNotThrow(() => assertElfPageAlignment(suffix, 'suffix-relro.so'))
const unsafe = Buffer.from(suffix)
unsafe.writeBigUInt64LE(8192n, 104)
assert.throws(() => assertElfPageAlignment(unsafe, 'writable-tail.so'), /RELRO/)
assert.throws(() => assertElfPageAlignment(Buffer.alloc(8), 'invalid.so'), /ELF/)
console.log('Android ELF page alignment regression tests passed')
