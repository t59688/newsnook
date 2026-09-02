import { readRaw } from '../storage'
import type { SpeedReadShareStyle } from './types'

const KEY = 'speed-read-share-style'
const DEFAULT: SpeedReadShareStyle = 'warm-paper'

const VALID: SpeedReadShareStyle[] = ['warm-paper', 'editorial', 'dusk', 'journal']

function isValidStyle(value: unknown): value is SpeedReadShareStyle {
  return typeof value === 'string' && VALID.includes(value as SpeedReadShareStyle)
}

export function loadSpeedReadShareStyle(): SpeedReadShareStyle {
  const raw = readRaw(KEY)
  if (!raw) return DEFAULT
  try {
    const parsed: unknown = JSON.parse(raw)
    if (isValidStyle(parsed)) return parsed
  } catch {
    /* ignore */
  }
  return DEFAULT
}

export function saveSpeedReadShareStyle(style: SpeedReadShareStyle): void {
  try {
    localStorage.setItem(`newsnook:${KEY}`, JSON.stringify(style))
  } catch {
    /* ignore */
  }
}
