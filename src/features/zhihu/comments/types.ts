import type { ZhihuAuthor } from '../types'

export type ZhihuCommentMediaKind = 'image' | 'gif' | 'sticker'

export interface ZhihuCommentMedia {
  kind: ZhihuCommentMediaKind
  url: string
  alt: string
}

export interface ZhihuCommentNode {
  id: string
  contentHtml: string
  media: ZhihuCommentMedia[]
  createdAt?: number
  ipLocation?: string
  author: ZhihuAuthor
  replyToAuthor?: ZhihuAuthor
  likeCount: number
  liked: boolean
  canDelete: boolean
  childCount: number
  children: ZhihuCommentNode[]
}
