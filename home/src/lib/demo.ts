/*
 * 门户数据注册表。
 * 信源名 / 分类名 / 预设名全部严格对齐源码注册表（src/sources/registry、categories、presets）；
 * 数据模型与状态均反映客户端真实运行态。
 */

export const BUILTIN_SOURCES_COUNT = 153
export const RSS_CATALOG_COUNT = 34270
export const DEDICATED_SITES_COUNT = 2 // 知乎、LINUX DO

export interface DemoArticle {
  id: string
  source: string
  title: string
  summary?: string
  time: string
  category: string
  read?: boolean
  saved?: boolean
  prestored?: boolean
  video?: boolean
  hasAudio?: boolean
  url?: string
}

export const CATEGORIES = [
  '推荐',
  '综合',
  '国内要闻',
  '全球视野',
  '财经商业',
  '科技数码',
  'AI 前沿',
  '科学知识',
  '深度人文',
  '文体生活',
] as const

export const ARTICLES: DemoArticle[] = [
  {
    id: 'a1',
    source: '见闻快讯',
    title: '美联储会议纪要释放按兵不动信号，美元指数尾盘回落 0.4%',
    summary: '多数委员认为通胀回落路径尚不稳固，建议将当前利率区间维持到明年一季度再作评估。',
    time: '刚刚',
    category: '财经商业',
    hasAudio: true,
  },
  {
    id: 'a2',
    source: '晚点 LatePost',
    title: '独家｜字节 AI 硬件团队拆分独立融资，估值超 300 亿元',
    summary: '该团队过去两年从手机外溢到耳机、眼镜与桌面机器人，拆分意在引入外部战略股东。',
    time: '23 分钟前',
    category: '科技数码',
    saved: true,
    prestored: true,
  },
  {
    id: 'a3',
    source: '量子位',
    title: '开源阵营的「跨会话记忆」之战：新评测集下各家模型表现分化明显',
    summary: '在长上下文与多会话召回场景中，轻量级状态空间架构与传统注意力缓存拉开差距。',
    time: '1 小时前',
    category: 'AI 前沿',
    prestored: true,
  },
  {
    id: 'a4',
    source: '澎湃·特稿',
    title: '回到县城的人们：一份持续十年的中部就业观察',
    summary: '我们跟踪了 47 位从沿海返乡的务工者，他们的选择勾勒出产业转移最真实的剖面。',
    time: '2 小时前',
    category: '深度人文',
    hasAudio: true,
  },
  {
    id: 'a5',
    source: 'BBC中文',
    title: '英国议会就自动驾驶责任法案展开辩论：事故责任该由谁承担',
    summary: '新法案拟明确制造商与软件开发商的主体责任，驾驶人由掌控者转为乘员。',
    time: '3 小时前',
    category: '全球视野',
    video: true,
  },
  {
    id: 'a6',
    source: '中科院物理所',
    title: '室温超导又双叒：这次是镍氧化物？解读最新预印本',
    summary: '研究团队在高压液氮温区观察到电阻陡降，但迈斯纳效应完全抗磁性仍待复现。',
    time: '5 小时前',
    category: '科学知识',
    read: true,
  },
  {
    id: 'a7',
    source: '少数派',
    title: '我把整个阅读工作流换成了 RSS：对抗信息焦虑的一次实践',
    summary: '当算法推荐把「你可能喜欢」变成「它想让你看」，主动选择信源成了一种自救。',
    time: '8 小时前',
    category: '科技数码',
    read: true,
  },
  {
    id: 'a8',
    source: '财联社',
    title: '工信部发布智能家居互联互通新标准，头部厂商集体表态支持',
    time: '昨天 21:47',
    category: '财经商业',
  },
  {
    id: 'a9',
    source: '知识分子',
    title: '为什么传染病数学模型越来越复杂，却越来越不确定？',
    time: '昨天 16:12',
    category: '科学知识',
    read: true,
  },
  {
    id: 'a10',
    source: '虎嗅',
    title: '便利店咖啡的零售革命：9.9 元价格战打到最后一公里',
    time: '11 月 2 日',
    category: '财经商业',
  },
  {
    id: 'a11',
    source: '端传媒',
    title: '特稿｜失去年轻人的村庄：东北县城三百天田野调查',
    time: '11 月 2 日',
    category: '深度人文',
    read: true,
  },
  {
    id: 'a12',
    source: 'Hacker News',
    title: 'Show HN: 一个不联网也能用的墨水屏新闻阅读器',
    summary: 'Local-first architecture with on-device smart recommendations and zero cloud dependency.',
    time: '11 月 1 日',
    category: '科技数码',
    prestored: true,
  },
]

/** 阅读器示意正文 */
export const READER_ARTICLE = {
  source: '澎湃·特稿',
  time: '2 小时前',
  title: '回到县城的人们：一份十年就业观察',
  lede: '我们跟踪了 47 位从沿海返乡的务工者。他们的选择比任何统计口径都更诚实地勾勒出产业转移的剖面。',
  paragraphs: [
    '十年前的冬天，陈礼明从东莞的电子厂回到湖南老家时，县城能提供的岗位只有两种：工地，或者开车。他在两者之间选了后者，每天在县城与乡镇之间跑两百公里，一个月挣四千二。',
    '变化是从第三年开始的。先是食品加工厂搬进了开发区，然后是电子配件厂，再后来连做跨境电商仓储的也来了。到去年冬天，陈礼明在一家做小家电出口的工厂做了组长，月薪六千八，走路十五分钟上班。',
    '「不是我们选择了回来，是工作自己走过来了。」他在电话里说。',
    '我们的跟踪调查试图回答一个朴素的问题：当产业沿着交通线向内陆铺开，人、家庭和县城会因此变成什么样？答案并不总是励志的——有人错过了沿海最后的红利，有人把孩子留在了原地，也有人第一次觉得，留下不是一个需要道歉的决定。',
  ],
  quote: '统计数字会告诉你流向，但只有具体的人能告诉你，为什么是现在，为什么是这里。',
  caption: '图｜2016—2026 年，中部三省返乡就业跟踪样本构成',
}

/** 8 大场景预设真实注册表（src/sources/presets.ts） */
export const PRESETS = [
  { id: 'builtin-v2-cn', name: '中国资讯', desc: '国内要闻、独家精选、公共议题、人物、观点与外部观察', count: 42 },
  { id: 'builtin-v2-world', name: '全球视野', desc: '中英文公共媒体、报刊通讯、亚太新闻与国际评论', count: 33 },
  { id: 'builtin-v2-biz', name: '财经商业', desc: '市场、财经、商业媒体、创业创投、产业评论与全球商业', count: 28 },
  { id: 'builtin-v2-tech', name: '科技数码', desc: '消费数码、科技产业、技术资讯、软件效率与开发者内容', count: 29 },
  { id: 'builtin-v2-ai', name: 'AI 前沿', desc: '模型实验室、AI 媒体、实践、研究与长期观察', count: 39 },
  { id: 'builtin-v2-science', name: '科学知识', desc: '科学、科研、基础科学、地球系统与健康医学', count: 24 },
  { id: 'builtin-v2-depth', name: '深度人文', desc: '深度报道、中文精选、海外思想长文与教育历史文化', count: 31 },
  { id: 'builtin-v2-life', name: '文体生活', desc: '体育、娱乐、游戏、轻松内容与旅行出行', count: 22 },
]

/** 官方主题配色方案（完全对齐 src/lib/theme.ts），首推三款核心定制方案：墨问、群青、不二 */
export const SCHEMES = [
  { key: 'ink', name: '墨问', caption: '宣纸 · 朱砂 · 默认', light: { ink: '#f6f2e9', paper: '#1a1815', accent: '#8d314d' }, dark: { ink: '#0e0f12', paper: '#eae4d8', accent: '#cf8597' } },
  { key: 'pearl', name: '群青', caption: '工业冷白 · 瑞士大报', light: { ink: '#f4f6f9', paper: '#101318', accent: '#1856f3' }, dark: { ink: '#0b0e14', paper: '#e6ecf5', accent: '#387bff' } },
  { key: 'buer', name: '不二', caption: '先锋社论 · 极简墨翠', light: { ink: '#fafafc', paper: '#111215', accent: '#166534' }, dark: { ink: '#090a0c', paper: '#f4f5f7', accent: '#c8f008' } },
  { key: 'celadon', name: '竹青', caption: '晨露竹林 · 碧玉冷翠', light: { ink: '#e8f0ea', paper: '#122019', accent: '#1b734e' }, dark: { ink: '#0d1612', paper: '#d7e8de', accent: '#3bb57e' } },
  { key: 'amber', name: '赤霞', caption: '暖砂陶土 · 落日晚霞', light: { ink: '#f6efea', paper: '#241814', accent: '#9d5815' }, dark: { ink: '#14100e', paper: '#ece1d8', accent: '#e7a66e' } },
  { key: 'dusk', name: '紫宸', caption: '暮山薄雾 · 丝绒星穹', light: { ink: '#f3eff7', paper: '#221628', accent: '#7e3ba8' }, dark: { ink: '#120e18', paper: '#e7deee', accent: '#b76ee8' } },
] as const

export type SchemeKey = (typeof SCHEMES)[number]['key']

/** 按分类过滤真实条目；「推荐」根据本地阅读频次实时重排 */
export function articlesFor(category: string): DemoArticle[] {
  if (category === '综合' || category === '推荐') return ARTICLES.slice(0, 7)
  const list = ARTICLES.filter((a) => a.category === category)
  return list.length ? list : ARTICLES.slice(0, 5)
}

export function hashId(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return h
}
