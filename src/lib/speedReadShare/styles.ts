import type { SpeedReadShareStyle } from './types'

export interface SpeedReadShareStyleMeta {
  id: SpeedReadShareStyle
  label: string
  en: string
}

export const SPEED_READ_SHARE_STYLES: SpeedReadShareStyleMeta[] = [
  { id: 'warm-paper', label: '暖纸手记', en: 'Warm Paper Note' },
  { id: 'editorial', label: '白纸杂志', en: 'Editorial Minimal' },
  { id: 'dusk', label: '暮色夜读', en: 'Dusk Dark' },
  { id: 'journal', label: '手账拼贴', en: 'Journal Collage' },
]
