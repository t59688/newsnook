export type SpeedReadShareStyle = 'warm-paper' | 'editorial' | 'dusk' | 'journal'

export interface SpeedReadImageInput {
  articleTitle: string
  sourceName: string
  model?: string
  markdown: string
}

export interface ParsedSpeedRead {
  conclusion: string
  keyPoints: string[]
  warnings: string[]
}
