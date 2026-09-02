import type { ParsedSpeedRead } from './types'
import { SPEED_READ_SECTION_TITLES } from '../../features/speedRead/sections'

const { conclusion: SECTION_CONCLUSION, keyPoints: SECTION_KEY_POINTS, warnings: SECTION_WARNINGS } =
  SPEED_READ_SECTION_TITLES

function classifySection(title: string): 'conclusion' | 'keyPoints' | 'warnings' | 'other' {
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

/** 从速读 Markdown 提取结论、要点与注意事项 */
export function parseSpeedReadMarkdown(markdown: string): ParsedSpeedRead {
  const result: ParsedSpeedRead = { conclusion: '', keyPoints: [], warnings: [] }
  let current: keyof ParsedSpeedRead | 'other' = 'other'

  for (const line of markdown.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue

    if (trimmed.startsWith('## ')) {
      current = classifySection(trimmed.slice(3).trim())
      continue
    }

    const text = stripListMarker(trimmed)
    if (!text) continue

    if (current === 'conclusion') {
      result.conclusion = result.conclusion ? `${result.conclusion} ${text}` : text
    } else if (current === 'keyPoints') {
      result.keyPoints.push(text)
    } else if (current === 'warnings') {
      result.warnings.push(text)
    }
  }

  return result
}
