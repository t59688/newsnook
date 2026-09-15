import { eastmoneyCommentProvider } from './providers/eastmoney'
import { hackerNewsCommentProvider } from './providers/hackerNews'
import { jandanCommentProvider } from './providers/jandan'
import { neteaseCommentProvider } from './providers/netease'
import { zhihuCommentProvider } from './providers/zhihu'
import { zhihuMainCommentProvider } from './providers/zhihuMain'
import type {
  CommentProvider,
  CommentsQueryResult,
  CommentTabId,
} from './types'

const PROVIDERS: CommentProvider[] = [
  // 东财须先于网易：误写的 neteaseDocId / 数字 id 不能被网易拦截
  eastmoneyCommentProvider,
  neteaseCommentProvider,
  // 主站必须先于旧知乎日报 Provider，二者协议完全不同。
  zhihuMainCommentProvider,
  zhihuCommentProvider,
  jandanCommentProvider,
  hackerNewsCommentProvider,
]

export function findCommentProvider(article: {
  sourceId?: string
  originUrl?: string
  neteaseDocId?: string
}): CommentProvider | undefined {
  return PROVIDERS.find((p) => p.canHandle(article))
}

export function supportsComments(article: {
  sourceId?: string
  originUrl?: string
  neteaseDocId?: string
}): boolean {
  return Boolean(findCommentProvider(article))
}

export async function fetchArticleComments(
  article: { id: string; sourceId?: string; originUrl?: string; neteaseDocId?: string },
  tab?: CommentTabId,
  offset?: number | string,
  signal?: AbortSignal,
): Promise<CommentsQueryResult> {
  const provider = findCommentProvider(article)
  if (!provider) {
    return {
      comments: [],
      totalCount: 0,
      availableTabs: [],
      hasMore: false,
    }
  }
  return provider.getComments(article, tab, offset, signal)
}

export async function fetchCommentCount(
  article: { id: string; sourceId?: string; originUrl?: string; neteaseDocId?: string },
  signal?: AbortSignal,
): Promise<number | undefined> {
  const provider = findCommentProvider(article)
  if (!provider?.getSummaryCount) return undefined
  return provider.getSummaryCount(article, signal)
}
