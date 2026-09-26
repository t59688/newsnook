/**
 * Taxonomy v3
 *
 * Built-in categories are deliberately preset-local: every non-workspace built-in source belongs to
 * exactly one category, and every category belongs to exactly one built-in preset. This keeps the
 * official information architecture mutually exclusive while user-created layouts remain free-form.
 *
 * Zhihu community is workspaceOnly and therefore intentionally excluded from the preset taxonomy.
 */

import { SOURCES } from './registry'

export type CategoryId = string

/** Current taxonomy version stored with preferences/presets so legacy layouts can be materialized safely. */
export const CATEGORY_TAXONOMY_VERSION = 3

/** Dynamic categories are not part of the static taxonomy. */
export const FAVORITES_CATEGORY_ID: CategoryId = 'favorites'
export const RECOMMEND_CATEGORY_ID: CategoryId = 'recommend'

const SOURCE_CAPTION = new Map(
  SOURCES.map((source) => [source.id, source.label || source.name] as const),
)

export interface NewsCategory {
  id: CategoryId
  label: string
  short: string
  caption: string
  sourceIds?: string[]
  isCustom?: boolean
}

export const FAVORITES_CATEGORY: NewsCategory = {
  id: FAVORITES_CATEGORY_ID,
  label: '收藏',
  short: '收藏',
  caption: '当前预设收藏的信源',
}

export const RECOMMEND_CATEGORY: NewsCategory = {
  id: RECOMMEND_CATEGORY_ID,
  label: '推荐',
  short: '推荐',
  caption: '基于本机已读记录对预设内信源做个性化排序 · 数据不出本机',
}

export function isReservedCategoryLabel(label: string): boolean {
  const normalized = label.trim()
  return normalized === RECOMMEND_CATEGORY.label || normalized === FAVORITES_CATEGORY.label
}

function category(
  id: CategoryId,
  label: string,
  short: string,
  sourceIds: string[],
): NewsCategory {
  return {
    id,
    label,
    short,
    caption: sourceIds.map((id) => SOURCE_CAPTION.get(id) ?? id).join(' · '),
    sourceIds,
  }
}

/**
 * Static category registry.
 *
 * Invariant:
 * - sourceIds are globally unique across these categories.
 * - every non-workspace built-in source is covered exactly once.
 * - category labels are unique.
 * - "mix" is the only aggregate category and is used only by blank custom layouts.
 */
export const CATEGORIES: NewsCategory[] = [
  {
    id: 'mix',
    label: '综合',
    short: '综合',
    caption: '按「综合频道」里启用的来源混合编排',
  },

  // 中国资讯：综合新闻、公共议题、人物、观点、外部观察分层，避免人物/研究混进“政务社会”。
  category('cn-headlines', '国内要闻', '要闻', ['netease']),
  category('cn-select', '独家精选', '精选', ['netease-exclusive', 'netease-select']),
  category('cn-public', '公共议题', '公共', ['netease-gov', 'thepaper-research']),
  category('cn-dialogue', '人物访谈', '人物', ['thepaper-people', 'infzm-interview']),
  category('cn-opinion', '观点智库', '观点', ['thepaper-ideas', 'infzm-thinktank']),
  category('cn-external', '外部观察', '外部观察', ['scmp-china', 'sinocism']),

  // 全球视野：按语言 + 媒体形态拆分，避免 8~9 个来源挤在一个“大国际”栏。
  category('world-zh', '中文公共', '中文公共', ['bbc-zh', 'rfi-zh', 'dw-top', 'voa-zh']),
  category('world-zh-press', '中文报刊', '中文报刊', [
    'nytimes-zh',
    'cna-intl-zh',
    'zaobao-world',
    'theinitium',
  ]),
  category('world-news', '英文公共', '英文公共', [
    'bbc-world',
    'dw-en',
    'npr',
    'france24',
    'aljazeera',
  ]),
  category('world-news-press', '英文聚合', '英文报刊', [
    'nytimes-world',
    'wsj-world',
    'guardian-world',
    'gnews-world',
  ]),
  category('world-asia', '亚太观察', '亚太', ['nikkei-asia', 'channelnewsasia-world', 'scmp-news']),
  category('world-opinion', '国际评论', '国际评论', ['foreign-affairs', 'project-syndicate']),

  // 财经商业
  category('biz-market', '市场快讯', '市场', ['cls-telegraph', 'eastmoney-kx', 'wscn-live']),
  category('biz-finance', '财经资讯', '财经', ['eastmoney-news', 'netease-stock']),
  category('biz-company', '商业媒体', '商业', ['latepost', 'huxiu', 'tmtpost', 'netease-biz']),
  category('biz-startup', '创业创投', '创业', ['kr36', 'techcrunch']),
  category('biz-industry', '产业评论', '产业', ['jazzyear', 'stratechery', 'bloomberg-opinion']),
  category('biz-global', '全球商业', '全球商业', ['ftchinese', 'bbc-business', 'gnews-business']),

  // 科技数码：消费数码、产业科技、技术资讯分开，避免父级科技频道与手机/数码子频道混在同一栏。
  category('tech-digital', '消费数码', '数码', [
    'netease-phone',
    'netease-digital',
    'ithome',
    'ifanr',
    'verge',
  ]),
  category('tech-media', '科技产业', '科技产业', ['netease-tech', 'geekpark', 'mittr', 'wired', 'gnews-tech']),
  category('tech-news', '技术资讯', '技术资讯', ['solidot', 'arstechnica']),
  category('tech-tools', '软件效率', '软件', ['sspai', 'appinn']),
  category('tech-dev', '开发者', '开发者', ['infoq-cn', 'hn', 'v2ex', 'ruanyifeng']),
  category('tech-longform', '技术深读', '技术深读', [
    'qianhei',
    'paulgraham',
    'vitalik',
    'fabricated-knowledge',
    'construction-physics',
  ]),

  // AI 前沿：官方模型厂商与开源/评测生态分开，避免“模型实验室”把框架和评测站也包进去。
  category('ai-labs', '厂商资讯', '实验室', [
    'openai-news',
    'anthropic',
    'claude-blog',
    'google-ai',
    'deepmind',
  ]),
  category('ai-ecosystem', '开源评测', 'AI生态', ['huggingface', 'pytorch', 'arena']),
  category('ai-practice', '产品实践', 'AI实践', [
    'claude-customers',
    'claude-academy-use-cases',
    'claude-academy-tutorials',
    'openai-cookbook',
    'uisdc-aigc',
    'woshipm-ai',
  ]),
  category('ai-media-cn', 'AI中文', 'AI中文', ['qbitai', 'jiqizhixin', 'aiera', 'leiphone', 'zhidx']),
  category('ai-media-en', 'AI海外', 'AI海外', [
    'synced',
    'mittr-ai',
    'verge-ai',
    'ieee-ai',
    'venturebeat-ai',
    'marktechpost',
  ]),
  category('ai-engineering', 'AI工程', 'AI工程', [
    'paperweekly',
    'xixiaoyao',
    'simonw',
    'latent-space',
    'interconnects',
    'lil-log',
  ]),
  category('ai-thinking', 'AI思想', 'AI思想', [
    'baoyu',
    'oneusefulthing',
    'understandingai',
    'thezvi',
    '42zhangjing',
  ]),
  category('ai-watch', 'AI观察', 'AI周报', ['lastweek-ai', 'import-ai', 'ahead-of-ai']),

  // 科学知识：集智俱乐部属于复杂系统/科研前沿，不再误归“地球系统”。
  category('science-general', '科学综合', '科学', ['guokr', 'pansci', 'huanqiukexue', 'gnews-science']),
  category('science-research', '科研前沿', '科研', ['zhishifenzi', 'thepaper-science', 'quanta', 'swarma']),
  category('science-basic', '基础科学', '基础科学', ['netease-fanpu', 'netease-wuli']),
  category('science-earth', '地理观察', '地理', ['netease-diqiu']),
  category('science-health', '健康医学', '健康', ['netease-health', 'gnews-health']),

  // 深度人文：知乎日报明确进入中文精选，中文/海外长文不再混在“知识阅读”大杂烩里。
  category('depth-reporting', '深度报道', '深度', ['infzm-depth', 'infzm-feature']),
  category('depth-books', '中文精选', '中文精选', ['zhihu-daily', 'thepaper-bookreview', 'theue']),
  category('depth-knowledge', '海外长文', '海外长文', [
    'nyrb',
    'marginalian',
    'aldaily',
    'astral-codex-ten',
  ]),
  category('depth-culture', '文史教育', '文化', ['netease-edu', 'netease-history', 'netease-antique']),
  category('depth-blogs', '博客随笔', '博客', ['netease-blog']),

  // 文体生活
  category('life-sports', '体育综合', '体育', ['netease-sports', 'gnews-sports']),
  category('life-basketball', '篮球', '篮球', ['netease-nba', 'netease-cba']),
  category('life-football', '足球', '足球', ['netease-football', 'netease-cn-football']),
  category('life-running', '跑步健身', '跑步', ['netease-run']),
  category('life-ent', '娱乐资讯', '娱乐', ['netease-ent', 'gnews-ent']),
  category('life-games', '游戏文化', '游戏', ['netease-game', 'gcores']),
  category('life-fun', '轻松趣闻', '轻松', ['netease-fun', 'jandan']),
  category('life-travel', '旅行出行', '出行', ['netease-travel', 'netease-auto']),
]

const CATEGORY_MAP = new Map(CATEGORIES.map((item) => [item.id, item]))

export function findCategory(id: CategoryId): NewsCategory {
  return CATEGORY_MAP.get(id) ?? CATEGORIES[0]
}

/** Fresh installs use 中国资讯. Presets own the rest of the taxonomy. */
export const DEFAULT_PRESET_CATEGORY_IDS: readonly CategoryId[] = [
  'cn-headlines',
  'cn-select',
  'cn-public',
  'cn-dialogue',
  'cn-opinion',
  'cn-external',
]

export const DEFAULT_PRESET_CATEGORY_SOURCES: Record<CategoryId, string[]> = Object.fromEntries(
  DEFAULT_PRESET_CATEGORY_IDS.map((id) => [id, [...(findCategory(id).sourceIds ?? [])]]),
)

export function sourceIdsForCategory(
  categoryId: CategoryId,
  enabledIds: string[],
): string[] {
  const found = findCategory(categoryId)
  if (!found.sourceIds?.length) return enabledIds
  return found.sourceIds
}

/** Every non-workspace source must be assigned exactly once. */
export function uncoveredSourceIds(): string[] {
  const covered = new Set<string>()
  CATEGORIES.forEach((item) => item.sourceIds?.forEach((id) => covered.add(id)))
  return SOURCES.filter((source) => !source.workspaceOnly)
    .map((source) => source.id)
    .filter((id) => !covered.has(id))
}

export function duplicateCategorizedSourceIds(): string[] {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  CATEGORIES.forEach((item) => {
    item.sourceIds?.forEach((id) => {
      if (seen.has(id)) duplicates.add(id)
      else seen.add(id)
    })
  })
  return [...duplicates].sort()
}

export function duplicateCategoryLabels(): string[] {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  CATEGORIES.forEach((item) => {
    if (seen.has(item.label)) duplicates.add(item.label)
    else seen.add(item.label)
  })
  return [...duplicates].sort()
}
