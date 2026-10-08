import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { pipeline } from 'node:stream/promises'
import { createGunzip, createGzip } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { compareReleaseVersions, parseReleaseVersion } from './release-contract.mjs'
import { javaExecutable, loadAndroidEnv } from './android-env.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// Pure manifest/unit-test helpers should never require an Android SDK at import time.
let tools
function androidTools() {
  if (!tools) {
    const env = loadAndroidEnv(root)
    tools = { env, java: javaExecutable(env.JAVA_HOME) }
  }
  return tools
}
const variants = ['cloud', 'local', 'local-arm64-v8a', 'local-armeabi-v7a', 'local-x86', 'local-x86_64']
const algorithm = 'gdiff-gzip-v1'
export const UPDATE_DELTA_ALGORITHM = algorithm
export const UPDATE_DELTA_VARIANTS = variants

export function deltaFileName(fromSha256, toSha256) {
  if (!/^[a-f0-9]{64}$/.test(fromSha256) || !/^[a-f0-9]{64}$/.test(toSha256)) {
    throw new Error('Delta identity must contain exact lowercase SHA-256 digests.')
  }
  return 'delta-' + fromSha256 + '-' + toSha256 + '.gdiff.gz'
}

export function selectHistory(releases, version, track, limit = 3) {
  return releases
    .filter((release) => {
      if (!release || release.draft === true) return false
      const parsed = parseReleaseVersion(String(release.tag_name ?? ''))
      return parsed?.track === track
        && (release.prerelease === true) === (track === 'beta')
        && compareReleaseVersions(parsed.version, version) < 0
    })
    .sort((a, b) => compareReleaseVersions(
      String(b.tag_name).replace(/^v/i, ''), String(a.tag_name).replace(/^v/i, '')
    ))
    .slice(0, limit)
}

export async function sha256File(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

function execute(binary, args, options = {}) {
  const result = spawnSync(binary, args, {
    encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'], ...options,
  })
  if (result.error || result.status !== 0) {
    throw new Error(binary + ' ' + (args[0] ?? '') + ' failed: ' + (result.error?.message ?? '')
      + '\n' + (result.stderr ?? '') + '\n' + (result.stdout ?? ''))
  }
  return result.stdout ?? ''
}

function signerDigest(apk) {
  const { env, java } = androidTools()
  const jar = join(env.ANDROID_HOME, 'build-tools', '36.0.0', 'lib', 'apksigner.jar')
  const output = execute(java, ['-jar', jar, 'verify', '--print-certs', apk], { env })
  const match = /Signer #1 certificate SHA-256 digest:\s*([0-9a-f]{64})/i.exec(output)
  if (!match) throw new Error('Cannot determine signing certificate: ' + apk)
  return match[1].toLowerCase()
}

function runDeltaTool(action, source, targetOrPatch, output) {
  const { env, java } = androidTools()
  const task = action === 'generate' ? 'generateUpdateDelta' : 'applyUpdateDelta'
  const args = ['-jar', join(root, 'android', 'gradle', 'wrapper', 'gradle-wrapper.jar'),
    ':app:' + task, '-PdeltaSource=' + source,
    '-P' + (action === 'generate' ? 'deltaTarget' : 'deltaPatch') + '=' + targetOrPatch,
    '-PdeltaOutput=' + output, '--console=plain', '--no-daemon']
  execute(java, args, { cwd: join(root, 'android'), env })
}

function checkReleaseAsset(file, asset) {
  if (typeof asset.size === 'number' && asset.size > 0 && statSync(file).size !== asset.size) {
    throw new Error('Historic asset size mismatch: ' + asset.name)
  }
}

export async function createPair(source, target, outputDir, sourceSha256, targetSha256, sourceVersion, track) {
  const fileName = deltaFileName(sourceSha256, targetSha256)
  const destination = join(outputDir, fileName)
  const scratch = mkdtempSync(join(tmpdir(), 'newsnook-gdiff-'))
  try {
    const raw = join(scratch, 'patch.gdiff')
    const transported = join(scratch, 'transported.gdiff')
    const reconstructed = join(scratch, 'reconstructed.apk')
    runDeltaTool('generate', source, target, raw)
    await pipeline(createReadStream(raw), createGzip({ level: 9 }), createWriteStream(destination))
    // Test the actual transport bytes, not the uncompressed temporary generator output.
    await pipeline(createReadStream(destination), createGunzip(), createWriteStream(transported))
    runDeltaTool('apply', source, transported, reconstructed)
    if (statSync(reconstructed).size !== statSync(target).size
        || await sha256File(reconstructed) !== targetSha256) {
      throw new Error('Delta reconstruction differs from signed target: ' + fileName)
    }
    if (signerDigest(reconstructed) !== signerDigest(target)) {
      throw new Error('Reconstructed APK signing certificate mismatch: ' + fileName)
    }
    return {
      algorithm,
      fromVersion: sourceVersion,
      fromSha256: sourceSha256,
      fileName,
      url: 'https://news-update.aizeek.com/newsnook/' + track + '/deltas/' + fileName,
      sha256: await sha256File(destination),
      size: statSync(destination).size,
    }
  } catch (error) {
    rmSync(destination, { force: true })
    throw error
  } finally {
    rmSync(scratch, { force: true, recursive: true })
  }
}

async function main() {
  const [version, track, outputDirArg] = process.argv.slice(2)
  if (!parseReleaseVersion(version) || !['beta', 'stable'].includes(track)
      || parseReleaseVersion(version).track !== track || !outputDirArg) {
    throw new Error('Usage: node scripts/android-delta-release.mjs <version> <beta|stable> <output-dir>')
  }
  const repository = process.env.GITHUB_REPOSITORY ?? 't59688/newsnook'
  const outputDir = resolve(outputDirArg)
  const patchDir = join(outputDir, 'deltas')
  mkdirSync(patchDir, { recursive: true })
  const releases = JSON.parse(execute('gh', ['api', 'repos/' + repository + '/releases?per_page=100']))
  const history = selectHistory(releases, version, track)
  const index = Object.fromEntries(variants.map((variant) => [variant, []]))
  const currentDir = join(root, 'artifacts', 'android')
  const scratch = mkdtempSync(join(tmpdir(), 'newsnook-old-apks-'))
  try {
    for (const variant of variants) {
      const target = join(currentDir, 'newsnook-' + version + '-' + variant + '-release.apk')
      if (!existsSync(target)) throw new Error('Target APK missing: ' + target)
      const targetSha = await sha256File(target)
      const cert = signerDigest(target)
      for (const release of history) {
        const sourceVersion = parseReleaseVersion(release.tag_name)?.version
        const sourceName = 'newsnook-' + sourceVersion + '-' + variant + '-release.apk'
        const asset = (release.assets ?? []).find((candidate) => candidate.name === sourceName)
        if (!asset) continue // Earlier releases might predate per-ABI packages.
        const sourceDir = join(scratch, String(sourceVersion))
        mkdirSync(sourceDir, { recursive: true })
        const source = join(sourceDir, sourceName)
        execute('gh', ['release', 'download', release.tag_name,
          '--repo', repository, '--pattern', sourceName, '--dir', sourceDir])
        checkReleaseAsset(source, asset)
        const sourceSha = await sha256File(source)
        const advertisedDigest = /^sha256:([a-f0-9]{64})$/i.exec(String(asset.digest ?? ''))
        if (advertisedDigest && advertisedDigest[1].toLowerCase() !== sourceSha) {
          throw new Error('Historic asset SHA-256 mismatch: ' + sourceName)
        }
        if (sourceSha !== targetSha && signerDigest(source) === cert) {
          const entry = await createPair(
            source, target, patchDir, sourceSha, targetSha, sourceVersion, track,
          )
          index[variant].push(entry)
          console.log(sourceName + ' -> ' + basename(target) + ': ' + entry.size + ' bytes')
        }
        rmSync(source, { force: true })
      }
    }
  } finally {
    rmSync(scratch, { force: true, recursive: true })
  }
  const indexFile = join(outputDir, 'delta-index.json')
  writeFileSync(indexFile, JSON.stringify(index, null, 2) + '\n')
  console.log('Delta index ready: ' + indexFile)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error); process.exitCode = 1 })
}
