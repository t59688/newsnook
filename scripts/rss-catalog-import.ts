import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { pinyin } from 'pinyin-pro'
import { parseCatalog, type CatalogFeed, type RssCatalog } from '../src/features/rssCatalog/schema'
import { catalogCreatorIdentity } from '../src/features/rssCatalog/identity'

// Build-time taxonomy only. Neither upstream provenance nor this mapping is bundled.
const TOPICS: Record<string, [string, ...string[]]> = {
  Agriculture: ['农业', '农林', '种植', '农作物'],
  'AI & Research': ['人工智能', 'AI', '机器学习', '大模型'],
  'Artificial Intelligence': ['人工智能', 'AI', '机器学习', '大模型'],
  Android: ['Android', '安卓', '手机'],
  'Android Development': ['移动开发', 'Android', '安卓', '手机'],
  Apple: ['Apple', '苹果', '手机', '数码'],
  Architecture: ['建筑', '建筑设计'],
  Beauty: ['美妆', '美容', '护肤'],
  Books: ['图书', '阅读', '书评'],
  'Business & Economy': ['商业与经济', '财经', '商业'],
  'Business & Startups': ['创业', '商业', '初创企业'],
  Cars: ['汽车', '交通', '出行'],
  'Cars & Mobility': ['汽车', '交通', '出行'],
  Communities: ['社区', '论坛'],
  Cricket: ['板球', '体育', '运动'],
  'Culture & Ideas': ['文化与思想', '人文', '文化'],
  DIY: ['动手制作', 'DIY', '手工'],
  'Education & Learning': ['教育与学习', '科教', '教育'],
  'Engineering & Technology': ['工程与技术', '科技', '工程'],
  Fashion: ['时尚', '服饰'],
  'Fisheries & Oceans': ['渔业与海洋', '水产', '渔业'],
  Food: ['美食', '饮食', '烹饪'],
  Football: ['足球', '体育', '运动'],
  'Forestry & Environment': ['林业与环境', '农林', '生态', '环保'],
  Funny: ['趣闻', '幽默'],
  Gaming: ['游戏', '电子游戏'],
  'Gaming & Entertainment': ['游戏', '娱乐', '电子游戏'],
  History: ['历史与考古', '历史', '考古'],
  'History & Archaeology': ['历史与考古', '历史', '考古'],
  'Interior design': ['室内设计', '家居', '装修'],
  'iOS Development': ['移动开发', 'iOS', 'Swift', '手机'],
  'Livestock & Veterinary': ['畜牧与兽医', '养殖', '畜牧', '兽医'],
  'Medicine & Public Health': ['医学与公共卫生', '医疗', '健康', '医学'],
  'Military & Defense': ['军事与国防', '军事', '国防'],
  Movies: ['电影', '影视'],
  Music: ['音乐', '演出'],
  News: ['新闻', '时事'],
  'Open Source & Software': ['软件与开源', '软件', '开源'],
  'Personal Blogs': ['个人博客', '博客', '随笔'],
  'Personal finance': ['金融与理财', '财经', '金融', '投资'],
  Photography: ['摄影', '相机', '影像'],
  Podcasts: ['播客', '音频'],
  'Politics & Geopolitics': ['政治与地缘', '政治', '国际关系'],
  'Product & Design': ['产品与设计', '产品设计', '用户体验'],
  Programming: ['编程', '程序开发', '软件开发'],
  'Research & Science': ['科学研究', '科研', '科普'],
  Science: ['科学研究', '科研', '科普'],
  Security: ['信息安全', '网络安全'],
  'Sexual Health & Relationships': ['性健康与亲密关系', '两性', '健康'],
  Space: ['航天与太空', '宇宙', '天文'],
  Sports: ['体育', '运动'],
  Startups: ['创业', '商业', '初创企业'],
  Tech: ['科技媒体', '科技', '数码'],
  'Tech Newsletters & Weeklies': ['技术通讯与周刊', '科技', '周刊'],
  'Technology Media': ['科技媒体', '科技', '数码'],
  Television: ['电视', '影视'],
  Tennis: ['网球', '体育', '运动'],
  Travel: ['旅行', '旅游'],
  'UI / UX': ['产品与设计', '用户界面', '用户体验'],
  Videos: ['视频', '影像'],
  'Web Development': ['前端开发', 'Web', '前端'],
  'World News': ['国际新闻', '新闻', '时事'],
}
const LANGUAGE_TOPICS: Record<string, [string, ...string[]]> = {
  'ai-research': ['人工智能研究', 'AI', '人工智能', '机器学习', '大模型', '科研'],
  'ai-tools': ['AI 工具', 'AI', '人工智能', '机器学习', '大模型', '工具'],
  backend: ['后端开发', '编程', '服务端'],
  'dev-tools': ['开发工具', '编程', '工具', '软件'],
  'devops-data': ['运维与数据', 'DevOps', '数据库', '数据工程'],
  essays: ['随笔', '博客', '人文'],
  finance: ['金融与理财', '财经', '金融', '投资'],
  lifestyle: ['生活方式', '生活', '文化'],
  mobile: ['手机与移动技术', 'Android', 'iOS', '手机', '数码'],
  newsletters: ['技术通讯与周刊', '科技', '周刊'],
  podcasts: ['播客', '音频'],
  'product-design': ['产品与设计', '产品设计', '用户体验'],
  startups: ['创业', '商业', '初创企业'],
  'tech-teams': ['技术团队', '工程', '研发'],
  'web-frontend': ['前端开发', 'Web', '前端'],
}
/** Generate pinyin at build time, not on the device's search thread. */
function pinyinNames(title: string): string[] {
  const name = title.split(/\s+[·｜|—–]\s+/)[0]
  if (!/[\u3400-\u9fff]/.test(name)) return []
  const spaced = pinyin(name.slice(0, 32), { toneType: 'none' }).toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 100).trim()
  const joined = spaced.replace(/\s+/g, '').slice(0, 100)
  return joined.length >= 3 ? [...new Set([spaced, joined])] : []
}

const PLATFORM_TAGS: Record<string, string[]> = {
  bilibili: ['B站', '哔哩哔哩', 'UP主'],
  wechat: ['微信', '微信公众号', '公众号'],
  youtube: ['YouTube', '视频频道'],
  telegram: ['Telegram', '频道'],
  douban: ['豆瓣', '小组'],
  jike: ['即刻', '圈子'],
  weibo: ['微博'],
  zhihu: ['知乎'],
  reddit: ['Reddit', '社区'],
  webcomic: ['漫画', '插画'],
}

const REGIONS: Record<string, string> = {
  USA: 'US', 'United States': 'US', GBR: 'GB', 'United Kingdom': 'GB', DEU: 'DE', Germany: 'DE', FRA: 'FR', France: 'FR',
  India: 'IN', IND: 'IN', ESP: 'ES', Spain: 'ES', NLD: 'NL', Philippines: 'PH', Australia: 'AU', AUS: 'AU', ITA: 'IT', Italy: 'IT',
  Mexico: 'MX', Russia: 'RU', Ukraine: 'UA', UKR: 'UA', 'South Africa': 'ZA', CHE: 'CH', BEL: 'BE', Nigeria: 'NG', IRL: 'IE', Ireland: 'IE',
  CAN: 'CA', Canada: 'CA', AUT: 'AT', Bangladesh: 'BD', Poland: 'PL', POL: 'PL', SWE: 'SE', Japan: 'JP', JPN: 'JP', Brazil: 'BR',
  Pakistan: 'PK', Iran: 'IR', NOR: 'NO', SGP: 'SG', DNK: 'DK', 'Hong Kong SAR China': 'HK', Indonesia: 'ID', 'Myanmar (Burma)': 'MM',
  FIN: 'FI', PRT: 'PT', CZE: 'CZ', ROU: 'RO', HUN: 'HU', SRB: 'RS',
}
const regionNames = new Intl.DisplayNames(['zh-CN'], { type: 'region' })
function topic(value: unknown): [string, ...string[]] {
  if (typeof value !== 'string') throw new Error('上游分类格式错误')
  const result = TOPICS[value] ?? LANGUAGE_TOPICS[value.replace(/^(?:cn|en)-/, '')]
  if (!result) throw new Error(`未映射的上游分类：${value}`)
  return result
}
function region(value: unknown): string {
  if (value == null) return '未标注'
  if (typeof value !== 'string' || !REGIONS[value]) throw new Error('未映射的上游地区')
  return regionNames.of(REGIONS[value])!
}
export function normalizeUpstreamCatalog(value: unknown): RssCatalog {
  if (!value || typeof value !== 'object') throw new Error('上游目录格式错误')
  const source = value as { metadata?: { schema_version?: unknown; total_feeds?: unknown; generated_at?: unknown; revision?: unknown }; feeds?: unknown }
  if (source.metadata?.schema_version !== 1 || !Array.isArray(source.feeds)) throw new Error('不支持的上游目录结构')
  if (source.metadata.total_feeds !== source.feeds.length) throw new Error('上游目录数量不一致')
  if (typeof source.metadata.generated_at !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(source.metadata.generated_at)) throw new Error('上游目录日期错误')
  if (source.metadata.revision !== undefined && (!Number.isSafeInteger(source.metadata.revision) || Number(source.metadata.revision) < 1)) throw new Error('上游目录修订号错误')
  const feeds = source.feeds.map((raw): CatalogFeed => {
    if (!raw || typeof raw !== 'object') throw new Error('上游来源格式错误')
    const row = raw as Record<string, unknown>
    if (row.nsfw !== undefined && typeof row.nsfw !== 'boolean') throw new Error('RSS 目录 NSFW 标记格式错误')
    const primary = topic(row.category)
    const alternate = row.alternative_categories == null ? [] : row.alternative_categories
    if (!Array.isArray(alternate) || !alternate.every((item) => typeof item === 'string')) throw new Error('上游备用分类格式错误')
    const categories = [String(row.category), ...alternate]
    const mapped = categories.map(topic)
    const aliases = row.aliases ?? []
    const tags = row.tags ?? []
    if (!Array.isArray(aliases) || !aliases.every((item) => typeof item === 'string') ||
        !Array.isArray(tags) || !tags.every((item) => typeof item === 'string')) throw new Error('上游目录别名与标签格式错误')
    if (row.platform !== undefined && (typeof row.platform !== 'string' || !/^[a-z][a-z0-9_-]{0,59}$/.test(row.platform))) throw new Error('上游平台字段错误')
    if (row.creator_id !== undefined && (typeof row.creator_id !== 'string' || !/^[A-Za-z0-9_.-]{1,100}$/.test(row.creator_id))) throw new Error('上游创作者 ID 错误')
    const identity = catalogCreatorIdentity({ url: String(row.url), rsshubRoute: row.rsshub_route as string | undefined, platform: row.platform as string | undefined, creatorId: row.creator_id as string | undefined })
    if (row.rsshub_route !== undefined && (typeof row.rsshub_route !== 'string' || identity?.routePath !== row.rsshub_route)) throw new Error('上游 RSSHub 逻辑路由错误')
    const url = new URL(String(row.url))
    const nativeYouTubeId = /^(?:www\.)?youtube\.com$/.test(url.hostname) && url.pathname === '/feeds/videos.xml'
      ? url.searchParams.get('channel_id') : null
    const platform = typeof row.platform === 'string' ? row.platform : identity?.platform ?? (nativeYouTubeId ? 'youtube' : undefined)
    const creatorId = typeof row.creator_id === 'string' ? row.creator_id : identity?.creatorId ?? nativeYouTubeId ?? undefined

    return {
      id: row.id as string, title: row.title as string, url: row.url as string, category: primary[0], language: row.language as string, region: region(row.region),
      aliases: [...new Set([...categories, ...mapped.map((item) => item[0]), ...aliases, ...pinyinNames(String(row.title))])],
      // The audit checks feed metadata for image/video references; no media payload is downloaded.
      tags: [...new Set([...mapped.flatMap((item) => item.slice(1)), ...tags, ...(platform ? PLATFORM_TAGS[platform] ?? [] : []), ...(row.has_image_in_feed === true ? ['图文', '图片'] : []), ...(row.has_video_in_feed === true ? ['视频'] : [])])],
      nsfw: row.nsfw === true,
      ...(platform ? { platform } : {}),
      ...(creatorId ? { creatorId } : {}),
      ...(identity ? { rsshubRoute: identity.routePath } : {}),
    }
  })
  feeds.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  return parseCatalog({ schemaVersion: 1, generatedAt: source.metadata.generated_at + 'T00:00:00Z', ...(source.metadata.revision === undefined ? {} : { revision: source.metadata.revision }), feeds })
}
async function main() {
  const source = JSON.parse(await readFile(new URL('../data/rss-catalog/upstream.json', import.meta.url), 'utf8'))
  const catalog = normalizeUpstreamCatalog(source)
  const output = JSON.stringify(catalog) + '\n'
  const file = new URL('../src/features/rssCatalog/seed.json', import.meta.url)
  if (process.argv.includes('--check')) {
    if (await readFile(file, 'utf8') !== output) throw new Error('目录种子与上游不一致，请运行 npm run rss-catalog:import')
  } else await writeFile(file, output)
  console.log(`RSS 目录归一化：${catalog.feeds.length} 条，${new Set(catalog.feeds.map((feed) => feed.category)).size} 个专题，${Buffer.byteLength(output)} 字节`)
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch((error) => { console.error(error instanceof Error ? error.message : 'RSS 目录导入失败'); process.exitCode = 1 })
