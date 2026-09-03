import type { ParsedSpeedRead } from './types'
import { SPEED_READ_SECTION_TITLES } from '../../features/speedRead/sections'

const {
  conclusion: SECTION_CONCLUSION,
  satire: SECTION_SATIRE,
  structure: SECTION_STRUCTURE,
  situation: SECTION_SITUATION,
  keyPoints: SECTION_KEY_POINTS,
  warnings: SECTION_WARNINGS,
} = SPEED_READ_SECTION_TITLES

function classifySection(title: string): keyof ParsedSpeedRead | 'other' {
  if (title.includes(SECTION_SATIRE)) return 'satire'
  if (title.includes(SECTION_STRUCTURE)) return 'structure'
  if (title.includes(SECTION_SITUATION)) return 'situation'
  if (title.includes(SECTION_CONCLUSION) || title.includes('一句话') || title.includes('结论')) {
    return 'conclusion'
  }
  if (title.includes(SECTION_KEY_POINTS) || title.includes('关键') || title.includes('要点')) {
    return 'keyPoints'
  }
  if (title.includes(SECTION_WARNINGS) || title.includes('值得') || title.includes('注意')) {
    return 'warnings'
  }
  return 'other'
}

function stripListMarker(line: string): string {
  return line.replace(/^[-*]\s+/, '').replace(/^\d+\.\s+/, '').trim()
}

function appendText(current: string, next: string): string {
  return current ? `${current} ${next}` : next
}

/** 从速读 Markdown 提取结论、三评、要点与注意事项 */
export function parseSpeedReadMarkdown(markdown: string): ParsedSpeedRead {
  const result: ParsedSpeedRead = {
    conclusion: '',
    satire: '',
    structure: '',
    situation: '',
    keyPoints: [],
    warnings: [],
  }
  let current: keyof ParsedSpeedRead | 'other' = 'other'

  for (const line of markdown.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue

    if (trimmed.startsWith('## ')) {
      current = classifySection(trimmed.slice(3).trim())
      continue
    }

    const text = stripListMarker(trimmed)
    if (!text || current === 'other') continue

    if (current === 'keyPoints') {
      result.keyPoints.push(text)
    } else if (current === 'warnings') {
      result.warnings.push(text)
    } else {
      result[current] = appendText(result[current], text)
    }
  }

  return result
}
