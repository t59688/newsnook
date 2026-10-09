import type { ZhihuEntityKind } from '../types'

export function formatZhihuCount(value?: number): string | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(value >= 1_000_000_000 ? 0 : 1)}亿`
  if (value >= 10_000) return `${(value / 10_000).toFixed(value >= 100_000 ? 0 : 1)}万`
  return String(Math.max(0, Math.round(value)))
}

export function zhihuEntityLabel(kind: ZhihuEntityKind): string {
  switch (kind) {
    case 'answer': return '回答'
    case 'article': return '文章'
    case 'question': return '问题'
    case 'pin': return '想法'
    case 'people': return '用户'
    case 'topic': return '话题'
    case 'collection': return '收藏夹'
    case 'comment': return '评论'
    default: return '知乎'
  }
}

/** 格式化知乎热榜热度指数或推荐热度标签 */
export function formatZhihuHotMetric(reason?: string, voteupCount?: number): string | null {
  if (reason) {
    const hotMatch = reason.match(/([\d,.]+\s*[万亿]?\s*热度)/)
    if (hotMatch) return hotMatch[1].replace(/\s+/g, '')
    if (reason.includes('热度') || reason.includes('讨论') || reason.includes('榜')) return reason
  }
  if (typeof voteupCount === 'number' && voteupCount > 0) {
    return `${formatZhihuCount(voteupCount)} 赞同`
  }
  return null
}

