import type { FrameworkId } from '../../frameworkDetect/types'
import type { CatalogSemantic } from './types'

type FieldRole = CatalogSemantic | 'search' | 'pagination'
interface CmsCapabilityAdapter { fields: Readonly<Record<string, FieldRole>> }
const videoFields: Record<string, FieldRole> = { wd: 'search', type: 'category', tid: 'category', typeid: 'category', class: 'genre', year: 'year', area: 'region', lang: 'language', state: 'status', by: 'sort', order: 'sort', page: 'pagination' }
const articleFields: Record<string, FieldRole> = { q: 'search', keyword: 'search', category: 'category', cat: 'category', tag: 'tag', year: 'year', order: 'sort', page: 'pagination' }

/** Exhaustive registry: adapters classify observed fields; they never manufacture routes. */
export const CMS_CAPABILITY_ADAPTERS: Readonly<Record<FrameworkId, CmsCapabilityAdapter>> = {
  maccms: { fields: { ...videoFields, id: 'category', vod_year: 'year', vod_area: 'region', vod_lang: 'language', vod_class: 'genre', vod_state: 'status', vod_tag: 'tag' } },
  seacms: { fields: { ...videoFields, searchword: 'search', searchtype: 'category', state: 'status' } },
  fyfcms: { fields: { ...videoFields, mcid: 'genre', letter: 'custom', gold: 'sort' } },
  zanpian: { fields: { ...videoFields, mcid: 'genre', letter: 'custom' } },
  nnyy: { fields: videoFields },
  jeecms: { fields: { ...articleFields, channelid: 'category', query: 'search' } },
  wordpress: { fields: { ...articleFields, s: 'search', category_name: 'category', post_type: 'category', orderby: 'sort', paged: 'pagination', m: 'custom' } },
  typecho: { fields: { ...articleFields, s: 'search' } },
  dedecms: { fields: { ...articleFields, typeid: 'category', keyword: 'search', orderby: 'sort', searchtype: 'custom' } },
  empirecms: { fields: { ...articleFields, keyboard: 'search', classid: 'category', orderby: 'sort', show: 'custom' } },
  pbootcms: { fields: { ...articleFields, scode: 'category', field: 'custom' } },
  eyoucms: { fields: { ...articleFields, keywords: 'search', typeid: 'category', orderby: 'sort' } },
  zblog: { fields: { ...articleFields, q: 'search', cate: 'category' } },
  drupal: { fields: { ...articleFields, keys: 'search', combine: 'search', type: 'category', field_year_value: 'year', sort_by: 'sort', sort_order: 'sort', page: 'pagination' } },
  joomla: { fields: { ...articleFields, searchword: 'search', 'filter[search]': 'search', 'filter[category_id]': 'category', 'list[ordering]': 'sort', 'list[direction]': 'sort', filter_order: 'sort', filter_order_dir: 'sort', limitstart: 'pagination' } },
  hugo: { fields: articleFields },
  hexo: { fields: articleFields },
  ghost: { fields: { ...articleFields, query: 'search' } },
  generic: { fields: articleFields },
}
const common: Record<string, FieldRole> = {
  q: 'search', s: 'search', wd: 'search', keyword: 'search', keywords: 'search', searchword: 'search', search: 'search', query: 'search', key: 'search', keyboard: 'search',
  year: 'year', years: 'year', release_year: 'year', pubyear: 'year',
  area: 'region', region: 'region', country: 'region', lang: 'language', language: 'language',
  genre: 'genre', genres: 'genre', class: 'genre', category: 'category', category_id: 'category', cat: 'category', type: 'category', typeid: 'category',
  status: 'status', state: 'status', tag: 'tag', tags: 'tag',
  sort: 'sort', sort_by: 'sort', sort_order: 'sort', order: 'sort', orderby: 'sort', order_by: 'sort', by: 'sort',
  page: 'pagination', paged: 'pagination', pageno: 'pagination', offset: 'pagination', start: 'pagination', limitstart: 'pagination', cursor: 'pagination', after: 'pagination',
}
export const SEMANTIC_TITLES: Record<CatalogSemantic, string> = { category: '分类', genre: '类型', year: '年份', region: '地区', language: '语言', status: '状态', tag: '标签', sort: '排序', custom: '筛选' }

export function fieldRole(name: string, engine: FrameworkId = 'generic'): FieldRole | undefined {
  const key = name.trim().toLowerCase().replace(/\[\]$/, '')
  const explicit = CMS_CAPABILITY_ADAPTERS[engine].fields[key] ?? common[key]
  if (explicit) return explicit
  const nested = key.match(/\[([^\]]+)\]$/)?.[1]
  return nested ? common[nested] : undefined
}
export function labelSemantic(value: string): CatalogSemantic | undefined {
  const label = value.replace(/[\s:：\u00a0]+/g, '').toLowerCase()
  if (/^(?:年份|年代|上映年份|发行年份|发布时间年份|year|years|releaseyear|publicationyear)$/.test(label)) return 'year'
  if (/^(?:地区|国家|区域|产地|制片地区|area|region|country|countries)$/.test(label)) return 'region'
  if (/^(?:语言|语种|配音|language|languages|lang)$/.test(label)) return 'language'
  if (/^(?:类型|题材|风格|剧情类型|genre|genres)$/.test(label)) return 'genre'
  if (/^(?:分类|类别|频道|栏目|category|categories|type|types|contenttype)$/.test(label)) return 'category'
  if (/^(?:状态|连载状态|完结状态|更新状态|status|state|availability)$/.test(label)) return 'status'
  if (/^(?:标签|话题|tag|tags|topics?)$/.test(label)) return 'tag'
  if (/^(?:排序|排序方式|排序依据|排列|order|ordering|sort|sortby|sortorder|orderby)$/.test(label)) return 'sort'
  return undefined
}

export function controlSemantic(name: string, label: string, engine: FrameworkId): CatalogSemantic | undefined {
  const role = fieldRole(name, engine)
  // Labels describe the rendered control, while engine fields resolve ambiguous labels.
  const semantic = labelSemantic(label)
  if (semantic && semantic !== 'category' && semantic !== 'genre') return semantic
  if (role && role !== 'search' && role !== 'pagination') return role
  return semantic
}
export function isYearLabel(value: string): boolean { return /^(?:18|19|20|21)\d{2}(?:年)?$/.test(value.trim()) }
