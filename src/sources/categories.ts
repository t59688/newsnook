/**
 * 阅读分类：覆盖注册表内全部可用信源。
 * - 「综合」读取用户在频道页启用的源
 * - 默认可见为门户经典栏（见 preferences.DEFAULT_HIDDEN_CATEGORY_IDS / presets.PORTAL_VISIBLE_CATEGORY_IDS）
 * - AI / 游戏 / 深度等默认隐藏，由场景预设打开
 * - RSS / 专栏用主题分类承接，保证每个 sourceId 至少落入一个分类
 */

import { SOURCES } from './registry'

export type CategoryId = string

export interface NewsCategory {
  id: CategoryId
  label: string
  /** 轨道上更短的字 */
  short: string
  caption: string
  /**
   * 固定信源；为空表示使用用户在「频道」里启用的来源（综合）。
   */
  sourceIds?: string[]
  /** 标记是否为用户自建的自定义分类 */
  isCustom?: boolean
}

/** 单源分类：轨道名与来源名一致 */
function solo(
  id: CategoryId,
  label: string,
  sourceId: string,
  caption?: string,
): NewsCategory {
  return {
    id,
    label,
    short: label,
    caption: caption ?? label,
    sourceIds: [sourceId],
  }
}

export const CATEGORIES: NewsCategory[] = [
  {
    id: 'mix',
    label: '综合',
    short: '综合',
    caption: '按「综合频道」里启用的来源混合编排',
  },
  {
    id: 'hot',
    label: '热点',
    short: '热点',
    caption: '网易头条',
    sourceIds: ['netease'],
  },
  {
    id: 'ent',
    label: '娱乐',
    short: '娱乐',
    caption: '网易娱乐 · Google 娱乐',
    sourceIds: ['netease-ent', 'gnews-ent'],
  },
  {
    id: 'sports',
    label: '体育',
    short: '体育',
    caption: '网易体育 · Google 体育',
    sourceIds: ['netease-sports', 'gnews-sports'],
  },
  {
    id: 'tech',
    label: '科技',
    short: '科技',
    caption: '网易科技 · IT之家 · 少数派 · 极客公园 · Solidot · 阮一峰 · 小众软件 · V2EX · Google 科技',
    sourceIds: [
      'netease-tech',
      'ithome',
      'sspai',
      'geekpark',
      'solidot',
      'ruanyifeng',
      'appinn',
      'v2ex',
      'gnews-tech',
    ],
  },
  {
    id: 'science',
    label: '科普',
    short: '科普',
    caption: '果壳科学人 · 泛科学 · 环球科学 · 知识分子 · Google 科学',
    sourceIds: ['guokr', 'pansci', 'huanqiukexue', 'zhishifenzi', 'gnews-science'],
  },
  {
    id: 'ai',
    label: 'AI',
    short: 'AI',
    caption: '量子位 · 机器之心 · 新智元 · 智东西 · 宝玉 · Arena · 实验室 · 深度解读与评测',
    sourceIds: [
      // 中文与产业
      'qbitai',
      'jiqizhixin',
      'aiera',
      'zhidx',
      'leiphone',
      'synced',
      // 测评榜 / 评测机构
      'arena',
      // 实验室 / 平台
      'openai-news',
      'anthropic',
      'google-ai',
      'deepmind',
      'huggingface',
      'pytorch',
      // 聚焦栏目与产业
      'mittr-ai',
      'verge-ai',
      'ieee-ai',
      'venturebeat-ai',
      'marktechpost',
      // 周报与作者博
      'lastweek-ai',
      'import-ai',
      'ahead-of-ai',
      'lil-log',
      'simonw',
      'interconnects',
      // 深度解读 / 评测
      'baoyu',
      'oneusefulthing',
      'understandingai',
      'latent-space',
      'thezvi',
    ],
  },
  {
    id: 'finance',
    label: '商业',
    short: '商业',
    caption: '网易商业 · 股票 · 财联社 · 东财 · 见闻 · 晚点 · 36氪 · BBC商业 · Google 商业',
    sourceIds: [
      'netease-biz',
      'netease-stock',
      'cls-telegraph',
      'eastmoney-kx',
      'eastmoney-news',
      'wscn-live',
      'latepost',
      'jazzyear',
      'kr36',
      'huxiu',
      'tmtpost',
      'techcrunch',
      'bbc-business',
      'gnews-business',
    ],
  },
  {
    id: 'intl',
    label: '国际',
    short: '国际',
    caption: 'BBC · DW · SCMP · 外交事务 · 纽约书评 · 彭博观点 · 辛迪加 · 端传媒 · Sinocism · Google 全球',
    sourceIds: [
      'foreign-affairs',
      'nyrb',
      'bloomberg-opinion',
      'project-syndicate',
      'sinocism',
      'theinitium',
      'bbc-zh',
      'bbc-zh-world',
      'bbc-world',
      'dw-top',
      'scmp-china',
      'scmp-news',
      'npr',
      'guardian-world',
      'france24',
      'aljazeera',
      'gnews-world',
    ],
  },
  {
    id: 'health',
    label: '健康',
    short: '健康',
    caption: '网易健康 · Google 健康',
    sourceIds: ['netease-health', 'gnews-health'],
  },
  solo('game', '游戏', 'netease-game'),
  {
    id: 'fun',
    label: '轻松一刻',
    short: '轻松',
    caption: '网易轻松一刻 · 煎蛋新鲜事 · 机核',
    sourceIds: ['netease-fun', 'jandan', 'gcores'],
  },

  // —— 默认隐藏：分类管理可开启 ——
  solo('exclusive', '独家', 'netease-exclusive', '网易独家'),
  {
    id: 'politics',
    label: '政务',
    short: '政务',
    caption: '网易政务 · BBC 中国',
    sourceIds: ['netease-gov', 'bbc-zh-china'],
  },
  solo('edu', '教育', 'netease-edu'),
  solo('auto', '汽车', 'netease-auto'),
  solo('travel', '旅游', 'netease-travel'),
  solo('history', '历史', 'netease-history'),
  // 股票并入「商业」拼单，避免与 finance 重复挂载
  solo('phone', '手机', 'netease-phone'),
  solo('digital', '数码', 'netease-digital'),
  solo('antique', '古玩', 'netease-antique'),
  solo('run', '跑步', 'netease-run'),
  solo('blog', '博客', 'netease-blog', '网易博客'),
  solo('select', '精选', 'netease-select', '网易精选'),
  solo('nba', 'NBA', 'netease-nba'),
  solo('football', '足球', 'netease-football'),
  solo('cba', 'CBA', 'netease-cba'),
  solo('cn-football', '中国足球', 'netease-cn-football'),
  solo('zhihu', '知乎日报', 'zhihu-daily', '知乎日报精选（直连官方列表接口）'),
  solo('astral-codex-ten', 'ACX', 'astral-codex-ten', 'Astral Codex Ten (Scott Alexander)'),
  solo('marginalian', 'Marginalian', 'marginalian', 'The Marginalian (Maria Popova)'),
  solo('aldaily', 'ALDaily', 'aldaily', 'Arts & Letters Daily'),
  solo('theue', '无业游民', 'theue', '无业游民（深度图文特刊）'),
  {
    id: 'tech-depth',
    label: '科技深度',
    short: '深度',
    caption: 'Ars · MIT TR · Quanta · Stratechery · Vitalik · Paul Graham · 半导体 · 建筑物理 · WIRED · HN',
    sourceIds: [
      'arstechnica',
      'mittr',
      'quanta',
      'stratechery',
      'vitalik',
      'fabricated-knowledge',
      'construction-physics',
      'paulgraham',
      'verge',
      'ifanr',
      'infoq-cn',
      'wired',
      'hn',
    ],
  },
]

export function findCategory(id: CategoryId): NewsCategory {
  return CATEGORIES.find((item) => item.id === id) ?? CATEGORIES[0]
}

/**
 * 门户经典默认可见栏（与 preferences.DEFAULT_HIDDEN_CATEGORY_IDS 互斥）。
 * 顺序：要闻 → 消遣 → 硬资讯 → 国际/健康/科普 → 轻松收尾。
 */
export const PORTAL_VISIBLE_CATEGORY_IDS: readonly CategoryId[] = [
  'mix',
  'hot',
  'ent',
  'sports',
  'tech',
  'finance',
  'intl',
  'health',
  'science',
  'fun',
]

export function sourceIdsForCategory(
  categoryId: CategoryId,
  enabledIds: string[],
): string[] {
  const category = findCategory(categoryId)
  if (!category.sourceIds?.length) return enabledIds
  return category.sourceIds
}

/** 开发期自检：注册表中的每个源至少落入一个分类 */
export function uncoveredSourceIds(): string[] {
  const covered = new Set<string>()
  CATEGORIES.forEach((category) => {
    category.sourceIds?.forEach((id) => covered.add(id))
  })
  return SOURCES.map((source) => source.id).filter((id) => !covered.has(id))
}
