/** 目录解析输出的统一条目（Feed Reflow 中间模型） */
export interface CatalogItem {
  id: string
  title: string
  originUrl: string
  image?: string
  summary?: string
  publishedAt?: number
  contentType?: 'article' | 'video'
}

/** 抽取信号来源 */
export type CatalogExtractorId = 'json-ld' | 'heuristic-cards' | 'dom-cards'

export interface CatalogExtractionResult {
  items: CatalogItem[]
  extractor: CatalogExtractorId | null
  confidence: 'high' | 'medium' | 'low'
  truncated?: boolean
}

export interface CatalogExtractOptions {
  /** 启发式最少条目数，低于此阈值不采纳 */
  minItems?: number
  maxItems?: number
  document?: Document
}
