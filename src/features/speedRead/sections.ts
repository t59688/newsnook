/** AI 速读六段标题（system prompt、解析、分享卡共用） */
export const SPEED_READ_SECTION_TITLES = {
  conclusion: '有所闻',
  satire: '讽世',
  structure: '析世',
  situation: '观世',
  keyPoints: '重点脉络',
  warnings: '值得注意',
} as const

/** 知乎回答强调作者论证，不套用新闻三评的编辑口吻。 */
export const ZHIHU_ANSWER_SPEED_READ_SECTION_TITLES = {
  conclusion: '一句话回答',
  satire: '观点脉络',
  structure: '关键依据',
  situation: '成立条件',
  keyPoints: '可能忽略',
  warnings: '阅读提示',
} as const

export type SpeedReadProfile = 'news' | 'zhihu-answer'

export interface SpeedReadSectionTitles {
  conclusion: string
  satire: string
  structure: string
  situation: string
  keyPoints: string
  warnings: string
}

export function speedReadSectionTitles(profile: SpeedReadProfile): SpeedReadSectionTitles {
  return profile === 'zhihu-answer'
    ? ZHIHU_ANSWER_SPEED_READ_SECTION_TITLES
    : SPEED_READ_SECTION_TITLES
}

export const SPEED_READ_COMMENT_KEYS = ['satire', 'structure', 'situation'] as const

export type SpeedReadCommentKey = (typeof SPEED_READ_COMMENT_KEYS)[number]
