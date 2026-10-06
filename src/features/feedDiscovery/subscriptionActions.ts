import { SOURCES, type NewsSource, type SourceDiscoveryMetadata } from '../../sources/registry'
import type { Preferences } from '../../sources/preferences'

export type SubscriptionDuplicateKind = 'builtin' | 'custom' | 'generator-route'

export interface SubscriptionDuplicate {
  kind: SubscriptionDuplicateKind
  source: NewsSource
}

export function normalizeFeedSubscriptionUrl(raw: string): string {
  const value = raw.trim()
  if (!value) return ''
  try {
    const parsed = new URL(value)
    parsed.hash = ''
    parsed.hostname = parsed.hostname.toLowerCase()
    // URL normalizes the default port while preserving path case and query order.
    return parsed.toString()
  } catch {
    return value
  }
}

function stableParams(
  params: SourceDiscoveryMetadata['params'] | undefined,
): string {
  if (!params) return ''
  return JSON.stringify(Object.keys(params).sort().map((key) => [key, params[key]]))
}

function sameGeneratorRoute(
  left: SourceDiscoveryMetadata | undefined,
  right: SourceDiscoveryMetadata | undefined,
): boolean {
  if (!left || !right) return false
  if (left.generator !== right.generator) return false
  if (!left.routeKey || !right.routeKey || left.routeKey !== right.routeKey) return false
  return stableParams(left.params) === stableParams(right.params)
}

export function findSubscriptionDuplicate(
  prefs: Preferences,
  input: {
    url: string
    discovery?: SourceDiscoveryMetadata
    excludeSourceId?: string
  },
): SubscriptionDuplicate | null {
  const normalized = normalizeFeedSubscriptionUrl(input.url)
  for (const source of SOURCES) {
    if (source.id === input.excludeSourceId) continue
    if (normalizeFeedSubscriptionUrl(source.url) === normalized) {
      return { kind: 'builtin', source }
    }
  }
  for (const source of prefs.customSources ?? []) {
    if (source.id === input.excludeSourceId) continue
    if (normalizeFeedSubscriptionUrl(source.url) === normalized) {
      return { kind: 'custom', source }
    }
    if (sameGeneratorRoute(source.discovery, input.discovery)) {
      return { kind: 'generator-route', source }
    }
  }
  return null
}

export function setCustomSourcePaused(
  prefs: Preferences,
  sourceId: string,
  paused: boolean,
): Preferences {
  const sources = prefs.customSources ?? []
  const index = sources.findIndex((source) => source.id === sourceId)
  if (index < 0 || sources[index].paused === paused) return prefs
  const nextSources = [...sources]
  nextSources[index] = { ...sources[index], paused }
  return { ...prefs, customSources: nextSources }
}

export function replaceCustomSourceInstance(
  prefs: Preferences,
  sourceId: string,
  url: string,
  discovery: SourceDiscoveryMetadata,
): Preferences {
  const sources = prefs.customSources ?? []
  const index = sources.findIndex((source) => source.id === sourceId)
  if (index < 0) return prefs
  const current = sources[index]
  const nextSources = [...sources]
  nextSources[index] = {
    ...current,
    url: url.trim(),
    discovery,
    // Deliberately preserve id/name/label/createdAt/category relationships/cache identity.
  }
  return { ...prefs, customSources: nextSources }
}
