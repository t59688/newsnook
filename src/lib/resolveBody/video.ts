/**
 * 视频稿正文构造与媒体嗅探增量更新：
 * 占位 <video> 节点、嗅探成功替换、失败降级标记。
 */

import {
  discoverMediaDescriptor,
  mediaDescriptorHtml,
} from '../../features/mediaSniffer/service'
import { sanitizeArticleHtml } from '../sanitize'
import type { Article } from '../types'
import { escapeHtml, type MediaResolvedHandler, type ResolvedBody } from './shared'

export function buildVideoBody(
  article: Article,
  pending: 'sniffing' | 'failed' = 'sniffing',
): ResolvedBody {
  const paragraphs = (article.summary || article.title)
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join('')

  if (article.videoUrl) {
    return {
      contentHtml: sanitizeArticleHtml(paragraphs),
      bodySource: 'video',
    }
  }

  const attrs = [
    `data-media-pending="${pending}"`,
    `title="${escapeHtml(article.title)}"`,
    'playsinline',
  ]
  if (article.image) attrs.push(`poster="${escapeHtml(article.image)}"`)
  return {
    contentHtml: sanitizeArticleHtml(`<video ${attrs.join(' ')}></video>${paragraphs}`),
    bodySource: 'video',
  }
}

/** 测试导出：视频稿在嗅探前/失败时都必须保留 video 占位节点。 */
export function buildVideoBodyForTest(
  article: Article,
  pending: 'sniffing' | 'failed' = 'sniffing',
): ResolvedBody {
  return buildVideoBody(article, pending)
}

function stripVideoDiscoveryPlaceholder(html: string): string {
  return html
    .replace(/<video\b[^>]*\bdata-media-pending\b[^>]*>\s*<\/video>/gi, '')
    .replace(/<div\b[^>]*data-newsnook-video-placeholder=["']true["'][^>]*>[\s\S]*?<\/div>/gi, '')
}

export function withVideoDiscoveryFailed(resolved: ResolvedBody): ResolvedBody {
  if (!/data-media-pending=["']sniffing["']/i.test(resolved.contentHtml)) return resolved
  return {
    ...resolved,
    contentHtml: sanitizeArticleHtml(
      resolved.contentHtml.replace(
        /data-media-pending=["']sniffing["']/gi,
        'data-media-pending="failed"',
      ),
    ),
  }
}

export function applyMediaDescriptor(
  resolved: ResolvedBody,
  descriptor: Awaited<ReturnType<typeof discoverMediaDescriptor>>,
  title: string,
  poster?: string,
): ResolvedBody | null {
  if (!descriptor) return null
  return {
    ...resolved,
    contentHtml: sanitizeArticleHtml(
      mediaDescriptorHtml(descriptor, {
        title,
        poster,
        contentHtml: stripVideoDiscoveryPlaceholder(resolved.contentHtml),
      }),
    ),
  }
}

export function scheduleMediaDiscovery(
  options: Parameters<typeof discoverMediaDescriptor>[0],
  resolved: ResolvedBody,
  title: string,
  poster: string | undefined,
  onMediaResolved: MediaResolvedHandler | undefined,
  incremental = true,
): void {
  if (!onMediaResolved) return
  const publish = (descriptor: Awaited<ReturnType<typeof discoverMediaDescriptor>>) => {
    const enriched = descriptor
      ? applyMediaDescriptor(resolved, descriptor, title, poster)
      : withVideoDiscoveryFailed(resolved)
    if (enriched) onMediaResolved(enriched)
  }
  // A direct video article starts from a pending placeholder. Do not publish
  // the first static candidate before runtime sniffing has captured the
  // session headers: replacing the HTML tears down the player, and the
  // header-less attempt is exactly what causes the error/flicker/retry path.
  const discoveryOptions = incremental ? { ...options, onDescriptor: publish } : options
  void discoverMediaDescriptor(discoveryOptions)
    .then((descriptor) => {
      if (!incremental) publish(descriptor)
    })
    .catch(() => {
      onMediaResolved(withVideoDiscoveryFailed(resolved))
    })
}
