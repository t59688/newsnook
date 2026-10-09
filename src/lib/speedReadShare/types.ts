import type { SpeedReadProfile } from '../../features/speedRead/sections'

export type SpeedReadShareStyle = 'warm-paper' | 'editorial' | 'dusk' | 'journal'

export interface SpeedReadImageInput {
  articleTitle: string
  sourceName: string
  sourceLabel?: string
  model?: string
  markdown: string
  profile?: SpeedReadProfile
}

export interface ParsedSpeedRead {
  conclusion: string
  satire: string
  structure: string
  situation: string
  keyPoints: string[]
  warnings: string[]
}
