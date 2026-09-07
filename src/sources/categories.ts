/**
 * 阅读分类：覆盖注册表内全部可用信源。
 * - 「综合」读取用户在频道页启用的源
 * - 默认可见为门户经典栏（见 preferences.DEFAULT_HIDDEN_CATEGORY_IDS / PORTAL_VISIBLE_CATEGORY_IDS）
 * - 主题栏按正文能否无翻译直读拆成中文栏与「·外刊」栏；同栏不中英混源
 * - AI 分层、游戏、科技深度等默认隐藏，由场景预设打开
 * - RSS / 专栏用主题分类承接，保证每个 sourceId 至少落入一个分类
 */

import { SOURCES } from './registry'

export type CategoryId = string

/** 本地推荐分类：候选池为当前预设启用的全部信源，排序见 lib/recommend.ts */
export const RECOMMEND_CATEGORY_ID: CategoryId = 'recommend'

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

/**
 * 动态「推荐」分类：不进 CATEGORIES 注册表，不参与分类管理与预设快照；
 * 由 App 在预设内阅读量达标（lib/recommend.isRecommendationReady）时插到轨道最前。
 */
export const RECOMMEND_CATEGORY: NewsCategory = {
  id: RECOMMEND_CATEGORY_ID,
  label: '推荐',
  short: '推荐',
  caption: '基于本机已读记录对预设内信源做个性化排序 · 数据不出本机',
}

/** 「推荐」是动态栏位的保留名：自建分类的名称与短名都不得使用 */
export function isReservedCategoryLabel(label: string): boolean {
  return label.trim() === RECOMMEND_CATEGORY.label
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

/** 外刊配对栏：短名后加「·外刊」 */
function worldRail(
  id: CategoryId,
  themeLabel: string,
  short: string,
  caption: string,
  sourceIds: string[],
): NewsCategory {
  return {
    id,
    label: `${themeLabel}·外刊`,
    short: `${short}·外刊`,
    caption,
    sourceIds,
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
  solo('exclusive', '独家', 'netease-exclusive', '网易独家'),
  {
    id: 'ent',
    label: '娱乐',
    short: '娱乐',
    caption: '网易娱乐',
    sourceIds: ['netease-ent'],
  },
  {
    id: 'sports',
    label: '体育',
    short: '体育',
    caption: '网易体育',
    sourceIds: ['netease-sports'],
  },
  {
    id: 'tech',
    label: '科技',
    short: '科技',
    caption: '网易科技 · IT之家 · 少数派 · 极客公园 · Solidot · 阮一峰 · 小众软件',
    sourceIds: [
      'netease-tech',
      'ithome',
      'sspai',
      'geekpark',
      'solidot',
      'ruanyifeng',
      'appinn',
    ],
  },
  {
    id: 'finance',
    label: '商业',
    short: '商业',
    caption: '网易商业 · 股票 · 财联社 · 东财 · 见闻 · 晚点 · 36氪',
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
    ],
  },
  {
    id: 'intl',
    label: '国际',
    short: '国际',
    caption: 'BBC 中文 · DW · 端传媒',
    sourceIds: ['bbc-zh', 'bbc-zh-world', 'dw-top', 'theinitium'],
  },
  {
    id: 'health',
    label: '健康',
    short: '健康',
    caption: '网易健康',
    sourceIds: ['netease-health'],
  },
  {
    id: 'science',
    label: '科普',
    short: '科普',
    caption: '果壳科学人 · 泛科学 · 环球科学 · 知识分子 · 返朴 · 物理所 · 地球知识局 · 集智',
    sourceIds: [
      'guokr',
      'pansci',
      'huanqiukexue',
      'zhishifenzi',
      'netease-fanpu',
      'netease-wuli',
      'netease-diqiu',
      'swarma',
    ],
  },
  {
    id: 'fun',
    label: '轻松一刻',
    short: '轻松',
    caption: '网易轻松一刻 · 煎蛋新鲜事 · 机核',
    sourceIds: ['netease-fun', 'jandan', 'gcores'],
  },
  worldRail('ent-world', '娱乐', '娱乐', 'Google 娱乐', ['gnews-ent']),
  worldRail('sports-world', '体育', '体育', 'Google 体育', ['gnews-sports']),
  worldRail('tech-world', '科技', '科技', 'Google 科技', ['gnews-tech']),
  worldRail(
    'finance-world',
    '商业',
    '商业',
    'BBC Business · Google 商业 · TechCrunch',
    ['techcrunch', 'bbc-business', 'gnews-business'],
  ),
  worldRail(
    'intl-world',
    '国际',
    '国际',
    'SCMP · 外交事务 · 纽约书评 · 彭博观点 · 辛迪加 · Sinocism · 公共广电 · Google 全球',
    [
      'foreign-affairs',
      'nyrb',
      'bloomberg-opinion',
      'project-syndicate',
      'sinocism',
      'bbc-world',
      'scmp-china',
      'scmp-news',
      'npr',
      'guardian-world',
      'france24',
      'aljazeera',
      'gnews-world',
    ],
  ),
  worldRail('health-world', '健康', '健康', 'Google 健康', ['gnews-health']),
  worldRail('science-world', '科普', '科普', 'Google 科学', ['gnews-science']),
  // AI 按信息层次拆栏：OpenAI / Claude / 实验室（官方一手）→ 业界（媒体）→ 深读（二次加工）→ 社区
  {
    id: 'ai-openai',
    label: 'OpenAI',
    short: 'OpenAI',
    caption: 'OpenAI 官方：News 发布 · Cookbook 实践指南',
    sourceIds: ['openai-news', 'openai-cookbook'],
  },
  {
    id: 'ai-claude',
    label: 'Claude',
    short: 'Claude',
    caption: 'Anthropic 官方：新闻 · Claude 博客 · 客户案例 · 学院用例/教程',
    sourceIds: [
      'anthropic',
      'claude-blog',
      'claude-customers',
      'claude-academy-use-cases',
      'claude-academy-tutorials',
    ],
  },
  {
    id: 'ai',
    label: '实验室',
    short: '实验室',
    caption: '实验室与平台官方：Google AI · DeepMind · Hugging Face · PyTorch · Arena',
    sourceIds: ['google-ai', 'deepmind', 'huggingface', 'pytorch', 'arena'],
  },
  {
    id: 'ai-media',
    label: '业界',
    short: '业界',
    caption: '中文媒体快报：量子位 · 机器之心 · 新智元 · 雷锋网',
    sourceIds: ['qbitai', 'jiqizhixin', 'aiera', 'leiphone'],
  },
  worldRail(
    'ai-media-world',
    '业界',
    '业界',
    'MIT/Verge/IEEE 等 AI 栏目 · Synced · VentureBeat · MarkTechPost',
    ['mittr-ai', 'verge-ai', 'ieee-ai', 'venturebeat-ai', 'synced', 'marktechpost'],
  ),
  {
    id: 'ai-depth',
    label: '深读',
    short: '深读',
    caption: '中文解读评测：智东西 · 宝玉 · 夕小瑶 · 42章经',
    sourceIds: ['zhidx', 'baoyu', 'xixiaoyao', '42zhangjing'],
  },
  worldRail(
    'ai-depth-world',
    '深读',
    '深读',
    'Mollick · Latent · 周报作者博',
    [
      'oneusefulthing',
      'latent-space',
      'understandingai',
      'thezvi',
      'lastweek-ai',
      'import-ai',
      'simonw',
      'interconnects',
      'lil-log',
      'ahead-of-ai',
    ],
  ),
  {
    id: 'ai-community',
    label: '社区',
    short: '社区',
    caption: '优设 AIGC · V2EX · PaperWeekly · 人人都是产品经理',
    sourceIds: ['uisdc-aigc', 'v2ex', 'paperweekly', 'woshipm-ai'],
  },
  worldRail('ai-community-world', '社区', '社区', 'Hacker News', ['hn']),
  solo('game', '游戏', 'netease-game'),

  // —— 默认隐藏：分类管理可开启 ——
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
    caption: '浅黑科技 · 爱范儿 · InfoQ 中文',
    sourceIds: ['qianhei', 'ifanr', 'infoq-cn'],
  },
  worldRail(
    'tech-depth-world',
    '科技深度',
    '深度',
    'Ars · MIT TR · Quanta · Stratechery · Vitalik · Paul Graham · 半导体 · 建筑物理 · WIRED · The Verge',
    [
      'arstechnica',
      'mittr',
      'quanta',
      'stratechery',
      'vitalik',
      'fabricated-knowledge',
      'construction-physics',
      'paulgraham',
      'verge',
      'wired',
    ],
  ),
]

export function findCategory(id: CategoryId): NewsCategory {
  return CATEGORIES.find((item) => item.id === id) ?? CATEGORIES[0]
}

/**
 * 门户经典默认可见栏（与 preferences.DEFAULT_HIDDEN_CATEGORY_IDS 互斥）。
 * 整组中文栏在前、整组外刊栏在后；不含综合。
 */
export const PORTAL_VISIBLE_CATEGORY_IDS: readonly CategoryId[] = [
  'hot',
  'exclusive',
  'ent',
  'sports',
  'tech',
  'finance',
  'intl',
  'health',
  'science',
  'fun',
  'ent-world',
  'sports-world',
  'tech-world',
  'finance-world',
  'intl-world',
  'health-world',
  'science-world',
]

/** 全景门户出厂信源；新装 / 重置布局与 builtin-default 共用，避免可见外刊栏铺开注册表全集 */
export const PORTAL_CATEGORY_SOURCES: Record<CategoryId, string[]> = {
  hot: ['netease'],
  exclusive: ['netease-exclusive'],
  ent: ['netease-ent'],
  sports: ['netease-sports', 'netease-football', 'netease-cn-football'],
  tech: [
    'netease-tech',
    'ithome',
    'sspai',
    'geekpark',
    'solidot',
    'ifanr',
    'netease-auto',
    'ruanyifeng',
    'appinn',
  ],
  finance: [
    'cls-telegraph',
    'latepost',
    'kr36',
    'eastmoney-kx',
    'wscn-live',
    'huxiu',
    'jazzyear',
    'tmtpost',
    'eastmoney-news',
    'netease-stock',
    'netease-biz',
  ],
  intl: ['bbc-zh', 'dw-top', 'theinitium', 'bbc-zh-world'],
  health: ['netease-health'],
  science: [
    'guokr',
    'pansci',
    'huanqiukexue',
    'netease-diqiu',
    'zhishifenzi',
    'netease-fanpu',
    'netease-wuli',
  ],
  fun: ['netease-fun', 'jandan', 'gcores'],
  'ent-world': ['gnews-ent'],
  'sports-world': ['gnews-sports'],
  'tech-world': ['gnews-tech', 'verge', 'arstechnica'],
  'finance-world': ['bbc-business', 'gnews-business', 'techcrunch'],
  'intl-world': ['gnews-world', 'scmp-china', 'npr', 'guardian-world'],
  'health-world': ['gnews-health'],
  'science-world': ['gnews-science', 'quanta'],
}

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
