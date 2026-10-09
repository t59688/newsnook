import { tokenize } from '../../../lib/recommend'
import type {
  ZhihuContentSummary,
  ZhihuEntityKind,
  ZhihuRecommendationMode,
} from '../types'

const PROFILE_VERSION = 3
const PROFILE_PREFIX = 'newsnook:zhihu:local-recommendation:v1:'
const MODE_KEY = 'newsnook:zhihu:recommendation-mode:v1'
const MAX_SEEN = 500
const MAX_IMPRESSIONS = 1000
const MAX_TERMS = 360
const MAX_DISLIKES = 500
const IMPRESSION_INCREMENT_GAP_MS = 15 * 60 * 1000

export const ZHIHU_RECOMMENDATION_MODES: ReadonlyArray<{
  id: ZhihuRecommendationMode
  label: string
  description: string
}> = [
  { id: 'smart', label: '智能', description: '多路召回、曝光去重与本地个性化重排' },
  { id: 'web', label: 'Web', description: '知乎网页端推荐流（诊断模式）' },
  { id: 'android', label: 'Android', description: '知乎 Android 协议推荐流（诊断模式）' },
  { id: 'mixed', label: '混合', description: 'Web 与 Android 两路独立翻页并在本机去重合并' },
  { id: 'local', label: '本地', description: '抓取公开候选后只在本机按你的阅读/互动信号排序' },
]

export type ZhihuRecommendationAction =
  | 'open'
  | 'vote-up'
  | 'collect'
  | 'follow-author'
  | 'not-interested'
  | 'less-author'

export type ZhihuRecommendationSignalItem = Pick<ZhihuContentSummary, 'ref'>
  & Partial<Pick<ZhihuContentSummary, 'author' | 'title' | 'excerpt'>>

interface ZhihuRecommendationImpression {
  count: number
  lastAt: number
}

export interface ZhihuRecommendationProfile {
  version: number
  updatedAt: number
  totalSignals: number
  kindScores: Partial<Record<ZhihuEntityKind, number>>
  authorScores: Record<string, number>
  /** 内容主题词的有符号兴趣分：正数偏好，负数代表主动减少类似内容。 */
  termScores: Record<string, number>
  /** entity key -> last opened unix ms */
  seen: Record<string, number>
  /** entity key -> explicit not-interested unix ms */
  dislikes: Record<string, number>
  /** entity key -> bounded exposure fatigue */
  impressions: Record<string, ZhihuRecommendationImpression>
}

export function loadZhihuRecommendationMode(
  storage: ZhihuRecommendationStorage | null = browserStorage(),
): ZhihuRecommendationMode {
  try {
    const value = storage?.getItem(MODE_KEY)
    return value === 'smart' || value === 'web' || value === 'android' || value === 'mixed' || value === 'local'
      ? value
      : 'smart'
  } catch {
    return 'smart'
  }
}

export function saveZhihuRecommendationMode(
  mode: ZhihuRecommendationMode,
  storage: ZhihuRecommendationStorage | null = browserStorage(),
): void {
  try {
    storage?.setItem(MODE_KEY, mode)
  } catch {
    // 偏好保存失败不影响当前会话切换。
  }
}

export interface ZhihuRecommendationStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

function browserStorage(): ZhihuRecommendationStorage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function scopeId(accountId?: string | null): string {
  return (accountId?.trim() || 'guest').replace(/[^a-zA-Z0-9._-]/g, '_')
}

function profileKey(accountId?: string | null): string {
  return `${PROFILE_PREFIX}${scopeId(accountId)}`
}

function emptyProfile(): ZhihuRecommendationProfile {
  return {
    version: PROFILE_VERSION,
    updatedAt: Date.now(),
    totalSignals: 0,
    kindScores: {},
    authorScores: {},
    termScores: {},
    seen: {},
    dislikes: {},
    impressions: {},
  }
}

function finiteScore(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function loadZhihuRecommendationProfile(
  accountId?: string | null,
  storage: ZhihuRecommendationStorage | null = browserStorage(),
): ZhihuRecommendationProfile {
  if (!storage) return emptyProfile()
  try {
    const raw = storage.getItem(profileKey(accountId))
    if (!raw) return emptyProfile()
    const value = JSON.parse(raw) as Partial<ZhihuRecommendationProfile>
    if (value.version !== 1 && value.version !== 2 && value.version !== PROFILE_VERSION) return emptyProfile()

    const profile = emptyProfile()
    profile.updatedAt = finiteScore(value.updatedAt) ?? profile.updatedAt
    profile.totalSignals = Math.max(0, finiteScore(value.totalSignals) ?? 0)

    if (value.kindScores && typeof value.kindScores === 'object') {
      for (const [kind, score] of Object.entries(value.kindScores)) {
        const normalized = finiteScore(score)
        if (normalized !== undefined) profile.kindScores[kind as ZhihuEntityKind] = normalized
      }
    }
    if (value.authorScores && typeof value.authorScores === 'object') {
      for (const [author, score] of Object.entries(value.authorScores)) {
        const normalized = finiteScore(score)
        if (normalized !== undefined && author) profile.authorScores[author] = normalized
      }
    }
    if (value.termScores && typeof value.termScores === 'object') {
      const entries = Object.entries(value.termScores)
        .map(([term, score]) => [term, finiteScore(score)] as const)
        .filter((entry): entry is readonly [string, number] => Boolean(entry[0]) && entry[1] !== undefined)
        .sort((left, right) => Math.abs(right[1]) - Math.abs(left[1]))
        .slice(0, MAX_TERMS)
      profile.termScores = Object.fromEntries(entries)
    }
    if (value.seen && typeof value.seen === 'object') {
      const seenEntries = Object.entries(value.seen)
        .map(([key, timestamp]) => [key, finiteScore(timestamp)] as const)
        .filter((entry): entry is readonly [string, number] => entry[1] !== undefined)
        .sort((left, right) => right[1] - left[1])
        .slice(0, MAX_SEEN)
      profile.seen = Object.fromEntries(seenEntries)
    }
    if (value.dislikes && typeof value.dislikes === 'object') {
      const disliked = Object.entries(value.dislikes)
        .map(([key, timestamp]) => [key, finiteScore(timestamp)] as const)
        .filter((entry): entry is readonly [string, number] => entry[1] !== undefined)
        .sort((left, right) => right[1] - left[1])
        .slice(0, MAX_DISLIKES)
      profile.dislikes = Object.fromEntries(disliked)
    }
    if (value.impressions && typeof value.impressions === 'object') {
      const entries = Object.entries(value.impressions)
        .map(([key, impression]) => {
          if (!impression || typeof impression !== 'object') return null
          const candidate = impression as Partial<ZhihuRecommendationImpression>
          const count = finiteScore(candidate.count)
          const lastAt = finiteScore(candidate.lastAt)
          if (count === undefined || lastAt === undefined) return null
          return [key, { count: Math.max(1, Math.floor(count)), lastAt }] as const
        })
        .filter((entry): entry is readonly [string, ZhihuRecommendationImpression] => entry !== null)
        .sort((left, right) => right[1].lastAt - left[1].lastAt)
        .slice(0, MAX_IMPRESSIONS)
      profile.impressions = Object.fromEntries(entries)
    }
    return profile
  } catch {
    return emptyProfile()
  }
}

function saveProfile(
  accountId: string | null | undefined,
  profile: ZhihuRecommendationProfile,
  storage: ZhihuRecommendationStorage | null,
): void {
  if (!storage) return
  try {
    storage.setItem(profileKey(accountId), JSON.stringify(profile))
  } catch {
    // 推荐画像属于增强功能；存储配额或隐私模式不能阻断阅读。
  }
}

function entityKey(item: Pick<ZhihuContentSummary, 'ref'>): string {
  return `${item.ref.kind}:${item.ref.id}`
}

const ACTION_WEIGHT: Record<ZhihuRecommendationAction, number> = {
  open: 1,
  'vote-up': 3,
  collect: 4,
  'follow-author': 5,
  'not-interested': -4,
  'less-author': -7,
}

function recommendationTerms(item: ZhihuRecommendationSignalItem): string[] {
  const title = tokenize(item.title ?? '')
  const excerpt = tokenize((item.excerpt ?? '').slice(0, 180))
  return [...new Set([...title.slice(0, 32), ...excerpt.slice(0, 32)])].slice(0, 48)
}

function trimSignedScores(scores: Record<string, number>, limit: number): Record<string, number> {
  return Object.fromEntries(
    Object.entries(scores)
      .filter((entry) => Number.isFinite(entry[1]) && Math.abs(entry[1]) >= 0.05)
      .sort((left, right) => Math.abs(right[1]) - Math.abs(left[1]))
      .slice(0, limit),
  )
}

export function recordZhihuRecommendationSignal(
  accountId: string | null | undefined,
  item: ZhihuRecommendationSignalItem,
  action: ZhihuRecommendationAction,
  storage: ZhihuRecommendationStorage | null = browserStorage(),
  now = Date.now(),
): void {
  if (!storage) return
  const profile = loadZhihuRecommendationProfile(accountId, storage)
  const weight = ACTION_WEIGHT[action]
  profile.totalSignals += 1
  profile.updatedAt = now

  const authorId = item.author?.token ?? item.author?.id
  if (action === 'less-author') {
    if (authorId) profile.authorScores[authorId] = (profile.authorScores[authorId] ?? 0) + weight
  } else {
    const kindWeight = action === 'not-interested' ? -1 : weight
    profile.kindScores[item.ref.kind] = (profile.kindScores[item.ref.kind] ?? 0) + kindWeight
    if (authorId) {
      const authorWeight = action === 'not-interested' ? -0.8 : weight
      profile.authorScores[authorId] = (profile.authorScores[authorId] ?? 0) + authorWeight
    }

    if (action !== 'follow-author') {
      const termWeight = action === 'open' ? 0.8 : weight
      for (const term of recommendationTerms(item)) {
        profile.termScores[term] = (profile.termScores[term] ?? 0) + termWeight
      }
      profile.termScores = trimSignedScores(profile.termScores, MAX_TERMS)
    }
  }

  if (action === 'open') profile.seen[entityKey(item)] = now
  if (action === 'not-interested') profile.dislikes[entityKey(item)] = now

  profile.seen = Object.fromEntries(
    Object.entries(profile.seen)
      .sort((left, right) => right[1] - left[1])
      .slice(0, MAX_SEEN),
  )
  profile.dislikes = Object.fromEntries(
    Object.entries(profile.dislikes)
      .sort((left, right) => right[1] - left[1])
      .slice(0, MAX_DISLIKES),
  )
  profile.authorScores = trimSignedScores(profile.authorScores, 240)
  saveProfile(accountId, profile, storage)
}

export function recordZhihuRecommendationImpression(
  accountId: string | null | undefined,
  item: Pick<ZhihuContentSummary, 'ref'>,
  storage: ZhihuRecommendationStorage | null = browserStorage(),
  now = Date.now(),
): void {
  if (!storage) return
  const profile = loadZhihuRecommendationProfile(accountId, storage)
  const key = entityKey(item)
  const previous = profile.impressions[key]
  profile.impressions[key] = {
    count: previous && now - previous.lastAt < IMPRESSION_INCREMENT_GAP_MS
      ? previous.count
      : (previous?.count ?? 0) + 1,
    lastAt: now,
  }
  profile.updatedAt = now
  profile.impressions = Object.fromEntries(
    Object.entries(profile.impressions)
      .sort((left, right) => right[1].lastAt - left[1].lastAt)
      .slice(0, MAX_IMPRESSIONS),
  )
  saveProfile(accountId, profile, storage)
}

export function clearZhihuRecommendationProfile(
  accountId?: string | null,
  storage: ZhihuRecommendationStorage | null = browserStorage(),
): void {
  try {
    storage?.removeItem(profileKey(accountId))
  } catch {
    // 同上：画像清理失败不阻断其它站点能力。
  }
}

function freshnessScore(createdAt: number | undefined, nowSeconds: number): number {
  if (!createdAt) return 1
  const ageHours = Math.max(0, nowSeconds - createdAt) / 3600
  if (ageHours < 12) return 1.10
  if (ageHours < 48) return 1.03
  if (ageHours < 168) return 0.92
  return 0.78
}

function kindLabel(kind: ZhihuEntityKind): string {
  switch (kind) {
    case 'answer': return '回答'
    case 'article': return '文章'
    case 'pin': return '想法'
    case 'question': return '问题'
    default: return '这类内容'
  }
}

function exposurePenalty(
  impression: ZhihuRecommendationImpression | undefined,
  now: number,
): number {
  if (!impression) return 1
  const age = now - impression.lastAt
  let recency = 1
  if (age < 6 * 60 * 60 * 1000) recency = 0.12
  else if (age < 24 * 60 * 60 * 1000) recency = 0.28
  else if (age < 3 * 24 * 60 * 60 * 1000) recency = 0.55
  else if (age < 7 * 24 * 60 * 60 * 1000) recency = 0.82
  const repetition = Math.max(0.58, 1 - Math.min(6, Math.max(0, impression.count - 1)) * 0.07)
  return recency * repetition
}

function explicitDislikePenalty(dislikedAt: number | undefined, now: number): number {
  if (!dislikedAt) return 1
  const age = now - dislikedAt
  if (age < 90 * 24 * 60 * 60 * 1000) return 0.18
  return 0.6
}

function maxAbsScore(values: readonly number[]): number {
  return Math.max(1, ...values.map((value) => Math.abs(value)))
}

function topicAffinity(
  item: ZhihuContentSummary,
  profile: ZhihuRecommendationProfile,
  maxTerm: number,
): number {
  const terms = recommendationTerms(item)
  if (terms.length === 0) return 0
  const raw = terms.reduce((sum, term) => sum + (profile.termScores[term] ?? 0), 0)
  if (raw === 0) return 0
  // 用候选自身全部主题词作分母：只偶然命中一个“怎么/讨论”之类泛词不能拿满分。
  return Math.max(-1, Math.min(1, raw / terms.length / maxTerm))
}

function sourcePrior(item: ZhihuContentSummary): number {
  switch (item.recommendationSource) {
    case 'following': return 1.08
    case 'android': return 1.03
    case 'web': return 1
    case 'hot': return 0.91
    default: return 1
  }
}

function stableNoise(key: string): number {
  let hash = 2166136261
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return ((hash >>> 0) % 10000) / 10000
}

function clusterKey(item: ZhihuContentSummary): string {
  if (item.ref.kind === 'question') return `question:${item.ref.id}`
  const matched = /\/question\/(\d+)/.exec(item.url)
  return matched?.[1] ? `question:${matched[1]}` : entityKey(item)
}

interface RankedCandidate {
  item: ZhihuContentSummary
  score: number
  familiarity: number
  authorId?: string
  cluster: string
  source: string
  index: number
}

function scoreCandidates(
  candidates: readonly ZhihuContentSummary[],
  profile: ZhihuRecommendationProfile,
  now: number,
): RankedCandidate[] {
  const maxKind = maxAbsScore(
    Object.values(profile.kindScores).filter((value): value is number => typeof value === 'number'),
  )
  const maxAuthor = maxAbsScore(Object.values(profile.authorScores))
  const maxTerm = maxAbsScore(Object.values(profile.termScores))
  const nowSeconds = now / 1000
  const deduped = new Map<string, ZhihuContentSummary>()
  for (const item of candidates) if (!deduped.has(entityKey(item))) deduped.set(entityKey(item), item)
  const eligible = [...deduped.values()].filter((item) => {
    const dislikedAt = profile.dislikes[entityKey(item)]
    return !dislikedAt || now - dislikedAt >= 30 * 24 * 60 * 60 * 1000
  })

  return eligible.map((item, index) => {
    const kindAffinity = (profile.kindScores[item.ref.kind] ?? 0) / maxKind
    const authorId = item.author?.token ?? item.author?.id
    const authorAffinity = authorId ? (profile.authorScores[authorId] ?? 0) / maxAuthor : 0
    const topic = topicAffinity(item, profile, maxTerm)
    const popularity = Math.min(1.4, Math.log10(Math.max(0, item.voteupCount ?? 0) + 1) / 3)
    const key = entityKey(item)
    const openedAt = profile.seen[key]
    const openPenalty = openedAt
      ? now - openedAt < 24 * 60 * 60 * 1000
        ? 0.28
        : now - openedAt < 7 * 24 * 60 * 60 * 1000
          ? 0.72
          : 0.92
      : 1
    const exposure = exposurePenalty(profile.impressions[key], now)
    const explicitDislike = explicitDislikePenalty(profile.dislikes[key], now)
    const freshness = freshnessScore(item.createdAt, nowSeconds)
    const upstreamPrior = Math.max(0.82, 1 - index * 0.0015)
    const jitter = 0.985 + stableNoise(key) * 0.03
    const familiarity = Math.max(0, Math.min(1, kindAffinity * 0.2 + authorAffinity * 0.4 + topic * 0.4))
    const preference = Math.max(
      0.16,
      1
      + kindAffinity * 0.28
      + authorAffinity * 0.55
      + topic * 0.72
      + popularity * 0.12,
    )
    const score = preference
      * freshness
      * openPenalty
      * exposure
      * explicitDislike
      * sourcePrior(item)
      * upstreamPrior
      * jitter

    return {
      item,
      score,
      familiarity,
      authorId,
      cluster: clusterKey(item),
      source: item.recommendationSource ?? 'unknown',
      index,
    }
  })
}

function localReason(item: ZhihuContentSummary, profile: ZhihuRecommendationProfile): string {
  const maxKind = maxAbsScore(
    Object.values(profile.kindScores).filter((value): value is number => typeof value === 'number'),
  )
  const maxAuthor = maxAbsScore(Object.values(profile.authorScores))
  const maxTerm = maxAbsScore(Object.values(profile.termScores))
  const kindAffinity = (profile.kindScores[item.ref.kind] ?? 0) / maxKind
  const authorId = item.author?.token ?? item.author?.id
  const authorAffinity = authorId ? (profile.authorScores[authorId] ?? 0) / maxAuthor : 0
  const topic = topicAffinity(item, profile, maxTerm)
  const popularity = Math.min(1.5, Math.log10(Math.max(0, item.voteupCount ?? 0) + 1) / 3)
  return authorAffinity >= 0.35 && item.author?.name
    ? `本地推荐 · 你常读 ${item.author.name} 的内容`
    : topic >= 0.22
      ? '本地推荐 · 与你近期关注的主题相近'
      : kindAffinity >= 0.3
        ? `本地推荐 · 你近期更常读${kindLabel(item.ref.kind)}`
        : popularity >= 0.65
          ? '本地推荐 · 候选中讨论度较高'
          : '本地推荐 · 来自公开候选并在本机排序'
}

export function rankZhihuLocalRecommendations(
  candidates: readonly ZhihuContentSummary[],
  accountId?: string | null,
  storage: ZhihuRecommendationStorage | null = browserStorage(),
  now = Date.now(),
): ZhihuContentSummary[] {
  const profile = loadZhihuRecommendationProfile(accountId, storage)
  return scoreCandidates(candidates, profile, now)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(({ item }) => ({
      ...item,
      recommendationSource: 'local' as const,
      recommendationReason: localReason(item, profile),
    }))
}

export function rankZhihuSmartRecommendations(
  candidates: readonly ZhihuContentSummary[],
  accountId?: string | null,
  storage: ZhihuRecommendationStorage | null = browserStorage(),
  now = Date.now(),
): ZhihuContentSummary[] {
  const profile = loadZhihuRecommendationProfile(accountId, storage)
  const remaining = scoreCandidates(candidates, profile, now)
    .sort((left, right) => right.score - left.score || left.index - right.index)
  const selected: RankedCandidate[] = []

  while (remaining.length > 0) {
    const position = selected.length
    const windowSize = Math.min(18, remaining.length)
    const window = remaining.slice(0, windowSize)
    const recent = selected.slice(-6)
    let bestIndex = 0
    let bestScore = Number.NEGATIVE_INFINITY

    for (let index = 0; index < window.length; index += 1) {
      const candidate = window[index]!
      let adjusted = candidate.score

      if (candidate.authorId && recent.slice(-3).some((item) => item.authorId === candidate.authorId)) {
        adjusted *= 0.42
      }
      if (recent.some((item) => item.cluster === candidate.cluster)) {
        adjusted *= 0.30
      }
      if (recent.slice(-2).every((item) => item.item.ref.kind === candidate.item.ref.kind)) {
        adjusted *= 0.78
      }
      if (recent.slice(-3).every((item) => item.source === candidate.source)) {
        adjusted *= 0.88
      }

      // 每 8 个位置给画像外候选一个温和的确定性探索机会，避免越看越窄。
      if ((position + 1) % 8 === 0) {
        adjusted *= 1 + (1 - candidate.familiarity) * 0.18
      }

      if (adjusted > bestScore) {
        bestScore = adjusted
        bestIndex = index
      }
    }

    const [picked] = remaining.splice(bestIndex, 1)
    if (picked) selected.push(picked)
  }

  return selected.map(({ item, familiarity }) => ({
    ...item,
    recommendationReason: item.recommendationReason ?? (
      item.recommendationSource === 'following'
        ? '智能推荐 · 来自你的关注动态'
        : familiarity >= 0.35
          ? '智能推荐 · 更贴近你的近期阅读'
          : '智能推荐 · 为你扩展一些新内容'
    ),
  }))
}
