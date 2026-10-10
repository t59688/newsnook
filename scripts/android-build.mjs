import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

import { javaExecutable, loadAndroidEnv } from './android-env.mjs'
import { verifyApkPageAlignment } from './android-apk-pages.mjs'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const androidRoot = join(projectRoot, 'android')
const format = process.argv[2]
const flavorArgument = process.argv[3] ?? 'all'
const supportedFlavors = ['cloud', 'local']
const localAbis = ['arm64-v8a', 'armeabi-v7a', 'x86', 'x86_64']

if (format !== 'apk' && format !== 'aab') {
  throw new Error('Usage: node scripts/android-build.mjs <apk|aab> [cloud|local|all]')
}
if (flavorArgument !== 'all' && !supportedFlavors.includes(flavorArgument)) {
  throw new Error('Flavor must be cloud, local, or all.')
}
const flavors = flavorArgument === 'all' ? supportedFlavors : [flavorArgument]

const env = loadAndroidEnv(projectRoot)
const requiredSigningVariables = [
  'NEWSNOOK_KEYSTORE_FILE',
  'NEWSNOOK_KEYSTORE_PASSWORD',
  'NEWSNOOK_KEY_ALIAS',
  'NEWSNOOK_KEY_PASSWORD',
]
const missingSigningVariables = requiredSigningVariables.filter((key) => !env[key])
if (missingSigningVariables.length) {
  throw new Error(
    `Release signing is missing (${missingSigningVariables.join(', ')}). Run npm run android:keystore:init first.`,
  )
}
if (!existsSync(env.NEWSNOOK_KEYSTORE_FILE)) {
  throw new Error(`Release keystore not found: ${env.NEWSNOOK_KEYSTORE_FILE}`)
}

if (flavors.includes('local')) {
  const bergamotCmake = join(
    androidRoot,
    'app',
    'src',
    'local',
    'cpp',
    'third_party',
    'bergamot-translator',
    'CMakeLists.txt',
  )
  if (!existsSync(bergamotCmake)) {
    console.log('Local flavor requires bergamot-translator. Running bergamot:init…')
    const initResult = spawnSync(
      process.execPath,
      [join(projectRoot, 'scripts', 'bergamot-init.mjs')],
      { stdio: 'inherit' },
    )
    if (initResult.status !== 0) {
      process.exit(initResult.status ?? 1)
    }
  }
}

const gradleWrapperJar = join(androidRoot, 'gradle', 'wrapper', 'gradle-wrapper.jar')
if (format === 'apk') {
  // ABI split 是 APK 自托管分发能力。cloud 仍是单包；local 单独构建并显式开启 split，
  // 避免全局 Gradle splits 误伤 cloud、debug 或 Play AAB。
  if (flavors.includes('cloud')) {
    runGradle(['assembleCloudRelease'])
  }
  if (flavors.includes('local')) {
    runGradle(['assembleLocalRelease'], ['-PnewsnookLocalAbiSplits=true'])
  }
} else {
  const tasks = flavors.map(
    (flavor) => `bundle${flavor[0].toUpperCase()}${flavor.slice(1)}Release`,
  )
  runGradle(tasks)
}

const packageJson = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'))
const outputDirectory = join(projectRoot, 'artifacts', 'android')
mkdirSync(outputDirectory, { recursive: true })
const apksignerJar = format === 'apk' ? findApksignerJar(env.ANDROID_HOME) : null

for (const flavor of flavors) {
  if (format === 'aab') {
    const source = join(
      androidRoot,
      'app',
      'build',
      'outputs',
      'bundle',
      `${flavor}Release`,
      `app-${flavor}-release.aab`,
    )
    const destination = join(
      outputDirectory,
      `newsnook-${packageJson.version}-${flavor}-release.aab`,
    )
    copyAndVerifyAab(source, destination, flavor)
    continue
  }

  const apkDir = join(androidRoot, 'app', 'build', 'outputs', 'apk', flavor, 'release')
  const metadataPath = join(apkDir, 'output-metadata.json')
  if (!existsSync(metadataPath)) {
    throw new Error(`Gradle completed but output metadata is missing: ${metadataPath}`)
  }
  const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'))
  const elements = Array.isArray(metadata.elements) ? metadata.elements : []

  if (flavor === 'cloud') {
    const element = elements.find((item) => !Array.isArray(item.filters) || item.filters.length === 0)
    if (!element?.outputFile) {
      throw new Error('Cloud APK output metadata does not contain a universal APK.')
    }
    copyAndVerifyApk(
      join(apkDir, element.outputFile),
      join(outputDirectory, `newsnook-${packageJson.version}-cloud-release.apk`),
      'cloud',
    )
    continue
  }

  const seen = new Set()
  for (const element of elements) {
    if (!element?.outputFile) continue
    const filters = Array.isArray(element.filters) ? element.filters : []
    const abiFilter = filters.find((filter) => String(filter?.filterType).toUpperCase() === 'ABI')
    const abi = typeof abiFilter?.value === 'string' ? abiFilter.value : null
    const suffix = abi ? `local-${abi}` : 'local'
    const label = abi ? `local/${abi}` : 'local/universal'
    const destination = join(
      outputDirectory,
      `newsnook-${packageJson.version}-${suffix}-release.apk`,
    )
    copyAndVerifyApk(join(apkDir, element.outputFile), destination, label)
    seen.add(abi ?? 'universal')
  }

  for (const abi of [...localAbis, 'universal']) {
    if (!seen.has(abi)) {
      throw new Error(`Local APK build is missing expected output: ${abi}`)
    }
  }
}

function runGradle(tasks, extraArgs = []) {
  const result = spawnSync(
    javaExecutable(env.JAVA_HOME),
    [
      '-Dorg.gradle.appname=gradlew',
      '-classpath',
      '',
      '-jar',
      gradleWrapperJar,
      ...tasks,
      ...extraArgs,
      '--no-daemon',
      '--console=plain',
      '--stacktrace',
    ],
    {
      cwd: androidRoot,
      env,
      stdio: 'inherit',
    },
  )
  if (result.status !== 0) process.exit(result.status ?? 1)
}

function copyAndVerifyApk(source, destination, label) {
  if (!existsSync(source)) {
    throw new Error(`Gradle completed but the expected artifact is missing: ${source}`)
  }
  copyFileSync(source, destination)
  verifyApkPageAlignment(destination, env, apksignerJar)
  verify(
    javaExecutable(env.JAVA_HOME),
    ['-jar', apksignerJar, 'verify', '--verbose', '--print-certs', destination],
    env,
    `${label} APK signature verification failed`,
  )
  const sizeMiB = (statSync(destination).size / 1024 / 1024).toFixed(2)
  console.log(`Android ${label} APK ready: ${destination} (${sizeMiB} MiB)`)
}

function copyAndVerifyAab(source, destination, flavor) {
  if (!existsSync(source)) {
    throw new Error(`Gradle completed but the expected artifact is missing: ${source}`)
  }
  copyFileSync(source, destination)
  verify(
    javaExecutable(env.JAVA_HOME, 'jarsigner'),
    ['-verify', '-certs', destination],
    env,
    `${flavor} AAB signature verification failed`,
    true,
  )
  const sizeMiB = (statSync(destination).size / 1024 / 1024).toFixed(2)
  console.log(`Android ${flavor} AAB ready: ${destination} (${sizeMiB} MiB)`)
}

function findApksignerJar(androidHome) {
  const buildToolsRoot = join(androidHome, 'build-tools')
  const directory = readdirSync(buildToolsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .reverse()
    .find((name) =>
      existsSync(
        join(
          buildToolsRoot,
          name,
          process.platform === 'win32' ? 'apksigner.bat' : 'apksigner',
        ),
      ),
    )
  if (!directory) throw new Error(`apksigner not found under ${buildToolsRoot}`)
  return join(buildToolsRoot, directory, 'lib', 'apksigner.jar')
}

function verify(command, args, commandEnv, errorMessage, quiet = false) {
  const verification = spawnSync(command, args, {
    encoding: quiet ? 'utf8' : undefined,
    env: commandEnv,
    stdio: quiet ? 'pipe' : 'inherit',
  })
  if (verification.status !== 0) {
    if (quiet) {
      process.stderr.write(verification.stdout ?? '')
      process.stderr.write(verification.stderr ?? '')
    }
    throw new Error(errorMessage)
  }
  if (quiet) console.log('AAB signature verified.')
}
