/**
 * 把当前文章丢给系统分享面板：标题 + 站内短链。
 *
 * 主链接固定是 `news.aizeek.com/a/<token>`（见 lib/shareLink），
 * 对方点开后在「有所闻」网页版站内读全文，而不是被甩到出版社页面。
 *
 * 与 imageActions 的图片分享同一条路：Android 走 @capacitor/share，
 * Web 优先 Web Share API，浏览器不支持时降级为复制链接。全程不经服务端。
 *
 * 有链接时**只传 title + url、绝不传 text**：@capacitor/share 的 Android 端
 * 会把 text 与 url 拼成一段（EXTRA_TEXT = "text url"），微信收到的是一条
 * 纯文本消息，不会去抓链接的 OG 卡片；EXTRA_TEXT 恰好是一条裸 URL 时
 * 才被当成链接消息，聊天里才会出现带图的大卡。标题、摘要都由边缘
 * OG 卡片展示（functions/lib/shareCard.ts），不需要写进消息正文。
 */

import { Capacitor } from '@capacitor/core'
import { Share } from '@capacitor/share'

import { log } from './logger'

export type ShareArticleResult = 'shared' | 'copied' | 'cancelled' | 'unsupported'

export interface ShareArticleInput {
  title: string
  /** 站内短链；调用方用 shareLink.buildShareUrl 生成 */
  url?: string
  sourceName?: string
}

/** 分享正文：一行标题带出处，链接单独交给系统字段，避免部分应用重复展示 */
export function buildShareText(input: ShareArticleInput): string {
  const title = input.title.trim() || '一篇文章'
  return input.sourceName ? `${title} · ${input.sourceName}` : title
}

/** 无 Web Share API 时的兜底文本：标题与链接拼在一起才有意义 */
export function buildClipboardText(input: ShareArticleInput): string {
  const text = buildShareText(input)
  return input.url ? `${text}\n${input.url}` : text
}

/**
 * 系统分享面板的载荷。有链接时只给 title + url，让 EXTRA_TEXT 是一条
 * 裸 URL（见文件头注释）；没有链接才退回纯文本分享。
 */
export function buildSharePayload(input: ShareArticleInput): {
  title: string
  url?: string
  text?: string
} {
  const title = input.title.trim() || '分享文章'
  if (input.url) return { title, url: input.url }
  return { title, text: buildShareText(input) }
}

function isCancellation(error: unknown): boolean {
  if (error instanceof Error) {
    if (error.name === 'AbortError') return true
    return /cancel/i.test(error.message)
  }
  return false
}

export async function copyShareText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch (error) {
    log.reader.warn('clipboard write failed', error)
  }
  return false
}

export async function shareArticle(input: ShareArticleInput): Promise<ShareArticleResult> {
  const payload = buildSharePayload(input)

  if (Capacitor.isNativePlatform()) {
    try {
      await Share.share({ ...payload, dialogTitle: '分享文章' })
      return 'shared'
    } catch (error) {
      if (isCancellation(error)) return 'cancelled'
      log.reader.warn('native share failed', error)
      return (await copyShareText(buildClipboardText(input))) ? 'copied' : 'unsupported'
    }
  }

  if (typeof navigator.share === 'function') {
    try {
      await navigator.share(payload)
      return 'shared'
    } catch (error) {
      if (isCancellation(error)) return 'cancelled'
      log.reader.warn('web share failed', error)
    }
  }

  return (await copyShareText(buildClipboardText(input))) ? 'copied' : 'unsupported'
}
