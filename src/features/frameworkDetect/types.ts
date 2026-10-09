export type FrameworkId =
  | 'maccms'
  | 'seacms'
  | 'fyfcms'
  | 'jeecms'
  | 'zanpian'
  | 'nnyy'
  | 'wordpress'
  | 'hugo'
  | 'hexo'
  | 'ghost'
  | 'generic'

export type PaginationPattern =
  | { kind: 'query-param'; param: string }
  | { kind: 'path-segment'; template: string }
  | { kind: 'next-link' }

export type FrameworkSortKey =
  | 'default'
  | 'time'
  | 'hits'
  | 'hits_day'
  | 'hits_week'
  | 'hits_month'
  | 'score'

export interface FrameworkSortOption {
  key: FrameworkSortKey
  label: string
}

export interface FrameworkHint {
  framework: FrameworkId
  themeVariant?: string
  paginationPattern: PaginationPattern
  categories?: { title: string; url: string }[]
  searchTemplate?: string
  sortOptions?: FrameworkSortOption[]
}
