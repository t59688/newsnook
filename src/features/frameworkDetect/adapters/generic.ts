import { detectNextPageUrl } from '../../catalogEngine/pagination'
import type { FrameworkHint } from '../types'

export function detectGenericNextLink(html: string, pageUrl: string): FrameworkHint | null {
  const nextUrl = detectNextPageUrl(html, pageUrl)
  if (!nextUrl) return null
  return {
    framework: 'generic',
    paginationPattern: { kind: 'next-link' },
  }
}
