/** AI 速读六段标题（system prompt、解析、分享卡共用） */
export const SPEED_READ_SECTION_TITLES = {
  conclusion: '有所闻',
  satire: '讽世',
  structure: '析世',
  situation: '观世',
  keyPoints: '重点脉络',
  warnings: '值得注意',
} as const

export const SPEED_READ_COMMENT_KEYS = ['satire', 'structure', 'situation'] as const

export type SpeedReadCommentKey = (typeof SPEED_READ_COMMENT_KEYS)[number]
