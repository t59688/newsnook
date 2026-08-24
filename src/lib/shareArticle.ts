/**
 * 把当前文章丢给系统分享面板：标题 + 站内短链。
 *
 * 主链接固定是 `news.aizeek.com/a/<token>`（见 lib/shareLink），
 * 对方点开后在「有所闻」网页版站内读全文，而不是被甩到出版社页面。
 *
 * 与 imageActions 的图片分享同一条路：Android 走 @capacitor/share，
 * Web 优先 Web Share API，浏览器不支持时降级为复制链接。全程不经服务端。
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
  const text = buildShareText(input)
  const title = input.title.trim() || '分享文章'

  if (Capacitor.isNativePlatform()) {
    try {
      await Share.share({
        title,
        text,
        ...(input.url ? { url: input.url } : {}),
        dialogTitle: '分享文章',
      })
      return 'shared'
    } catch (error) {
      if (isCancellation(error)) return 'cancelled'
      log.reader.warn('native share failed', error)
      return (await copyShareText(buildClipboardText(input))) ? 'copied' : 'unsupported'
    }
  }

  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ title, text, ...(input.url ? { url: input.url } : {}) })
      return 'shared'
    } catch (error) {
      if (isCancellation(error)) return 'cancelled'
      log.reader.warn('web share failed', error)
    }
  }

  return (await copyShareText(buildClipboardText(input))) ? 'copied' : 'unsupported'
}
