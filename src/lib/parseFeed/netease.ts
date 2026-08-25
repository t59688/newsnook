/**
 * 网易新闻列表 JSON 解析（含视频卡片分流与网易号短视频过滤）。
 */

import {
  bestMediaUrlInPayload,
  bestPosterUrlInPayload,
} from '../../features/mediaSniffer/core'
import type { NewsSource } from '../../sources/registry'
import type { Article } from '../types'
import {
  asRecord,
  buildArticle,
  preferHttpsAsset,
  stripTags,
  text,
  type Unknown,
} from './shared'

function stableNeteaseDocId(raw: string): string | undefined {
  // 正常稿件 docid，如 L35E0QFF00019B3E；排除视频拼接脏串
  if (/^[A-Z0-9]{8,24}$/i.test(raw)) return raw
  return undefined
}

/** 整条是网易号短视频卡片（非「文章正文里带了视频」）。 */
function isNeteaseHaoShortVideoCard(entry: Unknown, videoinfo: Unknown | undefined): boolean {
  const boardid = text(entry.boardid)
  const docid = text(entry.docid)
  const videosource = text(entry.videosource) || text(videoinfo?.videosource)
  if (boardid === 'video_bbs') return true
  if (/updateDoc$/i.test(docid)) return true
  return videosource === '新媒体' || videosource === '其他'
}

export function parseNetease(source: NewsSource, payload: string, fetchedAt: number): Article[] {
  const data = JSON.parse(payload) as Record<string, unknown>
  // 汽车等频道顶层为 list；普通频道为动态 TID 数组键
  const listKey =
    (Array.isArray(data.list) ? 'list' : undefined) ||
    Object.keys(data).find((key) => Array.isArray(data[key]))
  if (!listKey) return []

  const entries = (data[listKey] as unknown[]).map(asRecord).filter(Boolean) as Unknown[]

  return entries.flatMap((entry) => {
    const title = text(entry.title)
    if (!title) return []

    const skipType = text(entry.skipType)
    // 图集 / 专题本期不做站内展开，避免点开后必失败
    if (skipType === 'photoset' || skipType === 'special') return []

    const videoinfo = asRecord(entry.videoinfo)
    const isVideo = skipType === 'video' || Boolean(videoinfo) || Boolean(text(entry.videoID))
    // 丢掉灌进频道的网易号短视频卡片；正文内嵌视频的文章条目不走这条分支
    if (isVideo && isNeteaseHaoShortVideoCard(entry, videoinfo)) return []

    if (isVideo) {
      const vid = text(entry.videoID) || text(entry.skipID) || text(videoinfo?.vid)
      if (!vid) return []
      const description =
        stripTags(text(videoinfo?.description)) ||
        stripTags(text(entry.digest)) ||
        title
      const link = `https://3g.163.com/news/video/${vid}.html`
      const cover = bestPosterUrlInPayload(
        { videoinfo, image: entry.imgsrc },
        link,
      )
      const coverHttps = cover ? preferHttpsAsset(cover) : undefined
      const videoUrl = bestMediaUrlInPayload(videoinfo, link)

      const article = buildArticle(
        source,
        {
          title,
          link,
          html: '',
          summaryText: description,
          dateRaw: text(entry.ptime) || text(videoinfo?.ptime),
          image: coverHttps,
          contentType: 'video',
          videoUrl,
          neteaseDocId: stableNeteaseDocId(text(entry.postid)) || vid,
        },
        fetchedAt,
      )
      return article ? [article] : []
    }

    const docid =
      stableNeteaseDocId(text(entry.docid)) ||
      stableNeteaseDocId(text(entry.postid)) ||
      undefined

    // 独家/网易号等列表常给 url_3w=news.163.com，实测大量 404；
    // m 站与 dy 站才是真实落地页。优先 https 移动站，再退回 docid 拼链。
    const mobileUrl = text(entry.url)
    const desktopUrl = text(entry.url_3w)
    const link =
      (mobileUrl.startsWith('http') ? mobileUrl : '') ||
      (docid ? `https://m.163.com/news/article/${docid}.html` : '') ||
      (desktopUrl.startsWith('http') ? desktopUrl : '')

    if (!link) return []

    const article = buildArticle(
      source,
      {
        title,
        link,
        html: '',
        summaryText: stripTags(text(entry.digest)),
        dateRaw: text(entry.ptime),
        image: text(entry.imgsrc) ? preferHttpsAsset(text(entry.imgsrc)) : undefined,
        contentType: 'article',
        neteaseDocId: docid,
      },
      fetchedAt,
    )
    return article ? [article] : []
  })
}

/** Raw page size before unsupported photosets/specials are filtered out. */
export function neteasePageEntryCount(payload: string): number {
  try {
    const data = JSON.parse(payload) as Record<string, unknown>
    if (Array.isArray(data.list)) return data.list.length
    const list = Object.values(data).find(Array.isArray)
    return Array.isArray(list) ? list.length : 0
  } catch {
    return 0
  }
}
