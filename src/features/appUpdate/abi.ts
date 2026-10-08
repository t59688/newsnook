import type { AndroidAbi } from './types'

export const ANDROID_ABIS: readonly AndroidAbi[] = [
  'arm64-v8a',
  'armeabi-v7a',
  'x86_64',
  'x86',
]

export function normalizeAndroidAbi(value: unknown): AndroidAbi | null {
  return typeof value === 'string' && (ANDROID_ABIS as readonly string[]).includes(value)
    ? (value as AndroidAbi)
    : null
}

export function normalizeSupportedAbis(values: unknown): AndroidAbi[] {
  if (!Array.isArray(values)) return []
  const seen = new Set<AndroidAbi>()
  const result: AndroidAbi[] = []
  for (const value of values) {
    const abi = normalizeAndroidAbi(value)
    if (!abi || seen.has(abi)) continue
    seen.add(abi)
    result.push(abi)
  }
  return result
}

export function selectPreferredAbi(
  supportedAbis: readonly AndroidAbi[],
  availableAbis: Iterable<AndroidAbi>,
): AndroidAbi | undefined {
  const available = new Set(availableAbis)
  return supportedAbis.find((abi) => available.has(abi))
}
