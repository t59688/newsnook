/**
 * 本地推荐排序：只用本机信号（已读 id 集、稍后读、正文缓存里的阅读历史元数据）
 * 对用户已订阅源的本地列表条目做 content-based 重排。零网络、零上传、零服务端画像，
 * 与「热度榜 / 协同过滤」类平台化推荐无关。
 *
 * 打分 = 内容相似 + 信源亲和 + 新鲜度 的可解释加权：
 * - 内容相似：中文按字符 bigram、英文按小写单词切词；画像与候选各自成 TF 向量，
 *   候选侧乘候选池 IDF 压掉「的一 / 报道」这类高频词面，再做向量归一。
 * - 信源亲和：已读 / 稍后读落在哪些源，按最大值归一到 0..1。
 * - 新鲜度：按发布时间指数衰减。
 * 冷启动（画像为空）时退化为按时间排序；有画像时输出经信源打散，避免单源刷屏。
 *
 * 「推荐」不是常驻分类：每个预设的候选池是该预设启用的全部信源，
 * 池内阅读量达到 recommendationReadiness 的阈值后，推荐栏才在该预设里出现；
 * 偏好里的 recommendEnabled 总开关（sources/preferences）可整体关闭该栏位。
 */

import { sourceIdOfArticleId } from './articleId'
import type { Article } from './types'

/** 推荐列表条数上限：手机上翻不完，且压住重排开销 */
export const RECOMMEND_LIMIT = 120

/**
 * 推荐分类起亮阈值：预设候选池内累计的已读 + 稍后读文档数达到该值，
 * 画像才有起码的词面与信源信号，「推荐」栏才在该预设里出现。
 *
 * 取 5 的理由：每篇标题贡献约 10~20 个 bigram 词面，5 篇是画像不被单篇偶读
 * 主导的下限，同时一次阅读会话内即可解锁，功能可被自然发现；再调低会放大
 * 噪声，调高只是推迟出现——排序本身有冷启动时间序兜底，低阈值的下行有限。
 *
 * 阈值只存在于本模块：UI 经 recommendationReadiness 拿到「已读 X / 需 Y」，
 * 不自行硬编码数值；导出仅供测试与文档。
 */
export const RECOMMEND_MIN_SCOPED_DOCS = 5

/** 画像最多吸收的文档数（稍后读优先，其次已读） */
const PROFILE_DOC_CAP = 200
/** 稍后读是显式意图，画像权重高于普通已读 */
const LATER_DOC_WEIGHT = 1.5
/** 标题词面比摘要更能代表兴趣 */
const TITLE_TERM_WEIGHT = 2
/** 摘要只取开头，避免长文摘要拖慢切词 */
const SUMMARY_CLIP = 240

const CONTENT_WEIGHT = 0.55
const SOURCE_WEIGHT = 0.2
const FRESHNESS_WEIGHT = 0.25
/** 新鲜度指数衰减时间常数（毫秒）：约 36 小时衰减到 1/e */
const FRESHNESS_TAU_MS = 36 * 60 * 60 * 1000
/** 同一信源每多选中一条，后续条目分值乘以该系数（信源打散） */
const SOURCE_DAMPEN = 0.82

const CJK_RUN = /[\u3400-\u9fff]+/g
const ASCII_WORD = /[a-z][a-z0-9]+/g

export interface RecommendSignals {
  /** 已读文章的元数据（readIds 与本机各池 join 的结果） */
  readArticles: Article[]
  /** 稍后读列表 */
  laterArticles: Article[]
}

/** 判定推荐是否可用的轻量输入：已读只需要 id 集合，无需先 join 元数据 */
export interface ReadingActivity {
  readIds: Iterable<string>
  laterArticles: Article[]
}

export interface RecommendationReadiness {
  ready: boolean
  /** 已计入的池内阅读条数；达到 requiredDocs 后停止累计，最大即 requiredDocs */
  scopedDocs: number
  /** 起亮所需条数（即 RECOMMEND_MIN_SCOPED_DOCS），随结果一起给出便于 UI 展示 */
  requiredDocs: number
}

/**
 * 预设阅读积累的可解释判定：只统计能归属到候选池信源的去重条目
 * （条目 id 首段即信源 id，见 lib/articleId），除布尔结果外给出
 * 「已读 X / 需 Y」进度，供设置页向用户解释推荐栏何时出现。
 * 计数达到阈值即提前停止，保持 O(阅读量) 上限；X 因此封顶为 Y，
 * 不代表池内阅读总量。每个预设按自己的候选池独立判定，互不串味。
 */
export function recommendationReadiness(
  activity: ReadingActivity,
  scopeSourceIds: ReadonlySet<string>,
): RecommendationReadiness {
  const requiredDocs = RECOMMEND_MIN_SCOPED_DOCS
  if (!scopeSourceIds.size) return { ready: false, scopedDocs: 0, requiredDocs }
  const counted = new Set<string>()
  const count = (id: string, sourceId: string): boolean => {
    if (!id || counted.has(id) || !scopeSourceIds.has(sourceId)) return false
    counted.add(id)
    return counted.size >= requiredDocs
  }
  for (const article of activity.laterArticles) {
    if (count(article.id, article.sourceId)) {
      return { ready: true, scopedDocs: counted.size, requiredDocs }
    }
  }
  for (const id of activity.readIds) {
    if (count(id, sourceIdOfArticleId(id))) {
      return { ready: true, scopedDocs: counted.size, requiredDocs }
    }
  }
  return { ready: false, scopedDocs: counted.size, requiredDocs }
}

/** 就绪判定的布尔捷径：语义与 recommendationReadiness().ready 完全一致 */
export function isRecommendationReady(
  activity: ReadingActivity,
  scopeSourceIds: ReadonlySet<string>,
): boolean {
  return recommendationReadiness(activity, scopeSourceIds).ready
}

/** 只保留落在候选池信源内的信号：预设各自的画像不吸收池外阅读记录 */
export function scopeSignalsToSources(
  signals: RecommendSignals,
  scopeSourceIds: ReadonlySet<string>,
): RecommendSignals {
  const inScope = (article: Article) => scopeSourceIds.has(article.sourceId)
  return {
    readArticles: signals.readArticles.filter(inScope),
    laterArticles: signals.laterArticles.filter(inScope),
  }
}

export interface ReadingProfile {
  termWeights: Map<string, number>
  /** sourceId → 0..1 亲和度 */
  sourceAffinity: Map<string, number>
  /** 画像文档数：0 表示冷启动 */
  docCount: number
}

export interface RankOptions {
  /** 已读 / 已收藏等不再出现在推荐里的条目 id */
  excludeIds?: Set<string>
  now?: number
  limit?: number
}

/** 中文无词边界：用字符 bigram 近似词面；英文取小写单词（≥2 字符） */
export function tokenize(text: string): string[] {
  if (!text) return []
  const lower = text.toLowerCase()
  const tokens: string[] = []
  const words = lower.match(ASCII_WORD)
  if (words) {
    for (const word of words) tokens.push(word.slice(0, 24))
  }
  const runs = lower.match(CJK_RUN)
  if (runs) {
    for (const run of runs) {
      if (run.length === 1) {
        tokens.push(run)
        continue
      }
      for (let i = 0; i < run.length - 1; i += 1) tokens.push(run.slice(i, i + 2))
    }
  }
  return tokens
}

function termCounts(article: Article): Map<string, number> {
  const counts = new Map<string, number>()
  for (const token of tokenize(article.title ?? '')) {
    counts.set(token, (counts.get(token) ?? 0) + TITLE_TERM_WEIGHT)
  }
  for (const token of tokenize((article.summary ?? '').slice(0, SUMMARY_CLIP))) {
    counts.set(token, (counts.get(token) ?? 0) + 1)
  }
  return counts
}

/**
 * 已读 id 只是集合，元数据要从本机各池（稍后读 / 正文缓存历史 / 列表缓存）join。
 * pools 按可信度从高到低传入，同 id 取先出现的元数据。
 */
export function collectReadArticles(readIds: Set<string>, pools: Article[][]): Article[] {
  const byId = new Map<string, Article>()
  for (const pool of pools) {
    for (const article of pool) {
      if (!article?.id || !readIds.has(article.id) || byId.has(article.id)) continue
      byId.set(article.id, article)
    }
  }
  return [...byId.values()]
}

export function buildReadingProfile(signals: RecommendSignals): ReadingProfile {
  const docs: { article: Article; weight: number }[] = []
  const seen = new Set<string>()
  const absorb = (articles: Article[], weight: number) => {
    for (const article of articles) {
      if (!article?.id || seen.has(article.id)) continue
      seen.add(article.id)
      docs.push({ article, weight })
    }
  }
  absorb(signals.laterArticles, LATER_DOC_WEIGHT)
  absorb(signals.readArticles, 1)

  const termWeights = new Map<string, number>()
  const sourceAffinity = new Map<string, number>()
  const capped = docs.slice(0, PROFILE_DOC_CAP)

  for (const { article, weight } of capped) {
    sourceAffinity.set(article.sourceId, (sourceAffinity.get(article.sourceId) ?? 0) + weight)
    const counts = termCounts(article)
    let docTotal = 0
    counts.forEach((count) => {
      docTotal += count
    })
    if (!docTotal) continue
    // 每篇按自身词量归一，长摘要不会挤占整个画像
    counts.forEach((count, term) => {
      termWeights.set(term, (termWeights.get(term) ?? 0) + (weight * count) / docTotal)
    })
  }

  let maxAffinity = 0
  sourceAffinity.forEach((value) => {
    if (value > maxAffinity) maxAffinity = value
  })
  if (maxAffinity > 0) {
    sourceAffinity.forEach((value, sourceId) => {
      sourceAffinity.set(sourceId, value / maxAffinity)
    })
  }

  return { termWeights, sourceAffinity, docCount: capped.length }
}

function freshnessOf(article: Article, now: number): number {
  const age = now - (article.publishedAt ?? now)
  if (age <= 0) return 1
  return Math.exp(-age / FRESHNESS_TAU_MS)
}

interface ScoredArticle {
  article: Article
  score: number
}

/**
 * 对候选条目按画像重排。冷启动（画像为空）时退化为按发布时间降序；
 * 有画像时按加权分排序并做信源打散，输出截断到 limit。
 */
export function rankRecommendations(
  candidates: Article[],
  profile: ReadingProfile,
  options?: RankOptions,
): Article[] {
  const now = options?.now ?? Date.now()
  const limit = options?.limit ?? RECOMMEND_LIMIT
  const excludeIds = options?.excludeIds

  const pool: Article[] = []
  const seen = new Set<string>()
  for (const article of candidates) {
    if (!article?.id || seen.has(article.id)) continue
    if (excludeIds?.has(article.id)) continue
    seen.add(article.id)
    pool.push(article)
  }
  if (!pool.length) return []

  if (profile.docCount === 0) {
    return [...pool]
      .sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0))
      .slice(0, limit)
  }

  // 候选池 IDF：只在当前候选内统计，词面越常见贡献越低
  const termsOf = pool.map((article) => termCounts(article))
  const documentFrequency = new Map<string, number>()
  for (const counts of termsOf) {
    counts.forEach((_count, term) => {
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1)
    })
  }
  const idfOf = (term: string) =>
    Math.log(1 + pool.length / (1 + (documentFrequency.get(term) ?? 0)))

  let maxContent = 0
  const contentRaw = pool.map((_article, index) => {
    const counts = termsOf[index]
    let dot = 0
    let normSq = 0
    counts.forEach((count, term) => {
      const weighted = count * idfOf(term)
      normSq += weighted * weighted
      const profileWeight = profile.termWeights.get(term)
      if (profileWeight) dot += profileWeight * weighted
    })
    const value = normSq > 0 ? dot / Math.sqrt(normSq) : 0
    if (value > maxContent) maxContent = value
    return value
  })

  const bySource = new Map<string, ScoredArticle[]>()
  pool.forEach((article, index) => {
    const content = maxContent > 0 ? contentRaw[index] / maxContent : 0
    const source = profile.sourceAffinity.get(article.sourceId) ?? 0
    const score =
      CONTENT_WEIGHT * content +
      SOURCE_WEIGHT * source +
      FRESHNESS_WEIGHT * freshnessOf(article, now)
    const group = bySource.get(article.sourceId)
    if (group) group.push({ article, score })
    else bySource.set(article.sourceId, [{ article, score }])
  })

  const groups = [...bySource.values()]
  for (const group of groups) {
    group.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      return (b.article.publishedAt ?? 0) - (a.article.publishedAt ?? 0)
    })
  }

  // 贪心选取：同源每多选一条，后续条目分值按 SOURCE_DAMPEN 衰减，避免单源刷屏
  const cursors = groups.map(() => 0)
  const pickedCounts = groups.map(() => 0)
  const picked: Article[] = []
  const total = Math.min(limit, pool.length)
  while (picked.length < total) {
    let bestIndex = -1
    let bestValue = -Infinity
    for (let i = 0; i < groups.length; i += 1) {
      const cursor = cursors[i]
      if (cursor >= groups[i].length) continue
      const value = groups[i][cursor].score * Math.pow(SOURCE_DAMPEN, pickedCounts[i])
      if (value > bestValue) {
        bestValue = value
        bestIndex = i
      }
    }
    if (bestIndex < 0) break
    picked.push(groups[bestIndex][cursors[bestIndex]].article)
    cursors[bestIndex] += 1
    pickedCounts[bestIndex] += 1
  }

  return picked
}
