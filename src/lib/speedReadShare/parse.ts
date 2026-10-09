import type { ParsedSpeedRead } from './types'
import {
  speedReadSectionTitles,
  type SpeedReadProfile,
  type SpeedReadSectionTitles,
} from '../../features/speedRead/sections'

function classifySection(
  title: string,
  sections: SpeedReadSectionTitles,
): keyof ParsedSpeedRead | 'other' {
  if (title.includes(sections.satire)) return 'satire'
  if (title.includes(sections.structure)) return 'structure'
  if (title.includes(sections.situation)) return 'situation'
  if (title.includes(sections.conclusion) || title.includes('一句话') || title.includes('结论')) {
    return 'conclusion'
  }
  if (title.includes(sections.keyPoints) || title.includes('关键') || title.includes('要点')) {
    return 'keyPoints'
  }
  if (title.includes(sections.warnings) || title.includes('值得') || title.includes('注意')) {
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
export function parseSpeedReadMarkdown(
  markdown: string,
  profile: SpeedReadProfile = 'news',
): ParsedSpeedRead {
  const sections = speedReadSectionTitles(profile)
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
      current = classifySection(trimmed.slice(3).trim(), sections)
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
