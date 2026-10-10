import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { javaExecutable } from './android-env.mjs'

export function assertElfPageAlignment(data, name) {
  if (data.length < 64 || data.readUInt32LE(0) !== 0x464c457f || data[4] !== 2 || data[5] !== 1) {
    throw new Error(`${name}: expected a 64-bit little-endian ELF`)
  }
  const offset = Number(data.readBigUInt64LE(32)), size = data.readUInt16LE(54), count = data.readUInt16LE(56)
  if (size < 56 || count === 0 || offset + size * count > data.length) throw new Error(`${name}: invalid ELF program headers`)
  let loads = 0
  const segments = Array.from({ length: count }, (_, i) => {
    const header = offset + i * size
    return { type: data.readUInt32LE(header), flags: data.readUInt32LE(header + 4), start: data.readBigUInt64LE(header + 16), end: data.readBigUInt64LE(header + 16) + data.readBigUInt64LE(header + 40) }
  })
  for (let i = 0; i < count; i++) {
    const header = offset + i * size, type = data.readUInt32LE(header)
    if (type === 1) {
      loads++
      const alignment = data.readBigUInt64LE(header + 48)
      if (alignment < 16384n || alignment % 16384n !== 0n) throw new Error(`${name}: LOAD alignment ${alignment} is incompatible with 16KB pages`)
    }
    if (type === 0x6474e552) {
      const end = data.readBigUInt64LE(header + 16) + data.readBigUInt64LE(header + 40)
      const start = data.readBigUInt64LE(header + 16)
      // A suffix covering its LOAD segment has no writable tail to over-protect.
      // Android's linker rounds that protection to a page boundary safely.
      const coversLoad = segments.some(segment => segment.type === 1 && start >= segment.start && start < segment.end && end >= segment.end)
      const pageStart = start / 16384n * 16384n, pageEnd = (end + 16383n) / 16384n * 16384n
      const protectsWritable = segments.some(segment => segment.type === 1 && (segment.flags & 2) && (
        (segment.start < start && segment.end > pageStart) || (segment.start < pageEnd && segment.end > end)
      ))
      if (protectsWritable || (end % 16384n !== 0n && !coversLoad)) throw new Error(`${name}: RELRO would protect writable data on 16KB pages`)
    }
  }
  if (loads === 0) throw new Error(`${name}: ELF has no LOAD segments`)
}

export function verifyApkPageAlignment(apk, env, apksignerJar) {
  function run(executable, args, cwd) {
    const result = spawnSync(executable, args, { env, cwd, encoding: 'utf8' })
    if (result.status !== 0) throw new Error(result.stderr || result.stdout || `Could not execute ${executable}`)
    return result.stdout
  }
  const buildTools = dirname(dirname(apksignerJar))
  run(join(buildTools, process.platform === 'win32' ? 'zipalign.exe' : 'zipalign'), ['-c', '-P', '16', '4', apk])
  const jar = javaExecutable(env.JAVA_HOME, 'jar')
  const libraries = run(jar, ['tf', apk]).split(/\r?\n/).filter(name => /^lib\/(?:arm64-v8a|x86_64)\/[\w.+-]+\.so$/.test(name))
  const directory = mkdtempSync(join(tmpdir(), 'newsnook-apk-pages-'))
  try {
    if (libraries.length) run(jar, ['xf', apk, ...libraries], directory)
    for (const name of libraries) assertElfPageAlignment(readFileSync(join(directory, name)), name)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
  console.log(`APK 16KB ZIP / ELF alignment verified (${libraries.length} native libraries).`)
}
