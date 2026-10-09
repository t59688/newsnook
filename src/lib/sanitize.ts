import createDOMPurify from 'dompurify'
import { parseHTML } from 'linkedom'

import { isAudioMediaUrl } from './articleAudio'
import { trustedEmbeddedVideoFrameHtml } from './videoArticle'

type PurifyLike = { sanitize: (dirty: string, config?: object) => string }

/** 浏览器用全局 window；Node 测试用 linkedom，避免 DOMPurify.sanitize 为空 */
function createPurify(): PurifyLike {
  if (typeof globalThis.window !== 'undefined' && globalThis.window.document) {
    return createDOMPurify(globalThis.window as unknown as Parameters<typeof createDOMPurify>[0]) as unknown as PurifyLike
  }
  const { window } = parseHTML('<!doctype html><html><body></body></html>')
  return createDOMPurify(window as unknown as Parameters<typeof createDOMPurify>[0]) as unknown as PurifyLike
}

const DOMPurify = createPurify()

const ARTICLE_DROP_TAGS = new Set([
  'script',
  'style',
  'form',
  'input',
  'button',
  'textarea',
  'select',
  'object',
  'embed',
  'link',
  'meta',
])

const ARTICLE_FORBID_ATTRS = new Set(['style', 'class', 'align', 'bgcolor'])
const ARTICLE_URI_ATTRS = new Set(['href', 'src', 'poster'])
const SAFE_ARTICLE_URI = /^(?:(?:https?|mailto):|\/api\/image\?)/i

/**
 * DOMPurify 在 linkedom 等非浏览器 DOM 上可能 `isSupported=false` 并原样返回输入。
 * 正文清洗不能把运行环境差异变成 XSS 缺口，因此在 DOMPurify 后再做一层最小安全栅栏。
 * 浏览器里它通常只是幂等检查；Node 测试/SSR 场景则承担实际兜底。
 */
function enforceArticleHtmlSecurity(html: string): string {
  const { document } = parseHTML('<!doctype html><html><body></body></html>')
  document.body.innerHTML = html

  for (const element of [...document.body.querySelectorAll('*')]) {
    const tag = element.tagName.toLowerCase()
    if (ARTICLE_DROP_TAGS.has(tag)) {
      element.remove()
      continue
    }

    for (const attr of [...element.attributes]) {
      const name = attr.name.toLowerCase()
      if (name.startsWith('on') || ARTICLE_FORBID_ATTRS.has(name)) {
        element.removeAttribute(attr.name)
        continue
      }
      if (ARTICLE_URI_ATTRS.has(name)) {
        const value = attr.value.trim()
        if (value && !SAFE_ARTICLE_URI.test(value)) element.removeAttribute(attr.name)
      }
    }
  }

  return document.body.innerHTML
}

/**
 * France 24 等站点在抓取环境里会把 YouTube 同意/广告拦截提示渲染成正文段落。
 * 这些占位文字没有信息量，应剔除；原站 YouTube embed iframe 则白名单保留。
 */
const EMBED_NOISE =
  /(?:to display this content from youtube[\s\S]{0,160}(?:advertisement tracking|audience measurement|cookies))|(?:to watch this video[\s\S]{0,160}(?:youtube|advertisement|cookies|tracking))|(?:one of your browser extensions seems to be blocking (?:the video player|youtube))|(?:content is not available because[\s\S]{0,120}blocking youtube)|(?:pour afficher ce contenu youtube[\s\S]{0,120}publicit)|(?:un de vos bloqueurs de publicit)|(?:page\s+not\s+found)|(?:content you requested does not exist)|(?:is not available anymore)/i

/** 仅允许原站 YouTube / YouTube nocookie 嵌入，不改写 src */
const YOUTUBE_EMBED_SRC =
  /^https:\/\/(?:www\.)?(?:youtube\.com|youtube-nocookie\.com)\/embed\/[A-Za-z0-9_-]+/i

export function isAllowedYoutubeEmbedSrc(src?: string | null): boolean {
  return Boolean(src && YOUTUBE_EMBED_SRC.test(src.trim()))
}

export function hasEmbedNoise(html?: string): boolean {
  return Boolean(html && EMBED_NOISE.test(html))
}

export function stripEmbedNoise(html: string): string {
  if (!hasEmbedNoise(html)) return html

  return html.replace(
    /<(p|div|section|aside)(\s[^>]*)?>[\s\S]*?<\/\1>/gi,
    (block) => (EMBED_NOISE.test(block) ? '' : block),
  )
}

/**
 * Some publishers use `<p><br></p>` as CMS spacing between every paragraph.
 * Once source styles are removed those nodes become full empty reader lines, so
 * discard them while preserving paragraphs that contain text or real media.
 */
export function stripEmptyArticleBlocks(html: string): string {
  return html
    .replace(
      /<p\b[^>]*>(?:\s|&nbsp;|&#160;|&#x0*a0;|<br\b[^>]*>)*<\/p>/gi,
      '',
    )
    .replace(/<(ul|ol)\b[^>]*>\s*<\/\1>/gi, '')
}

const YOUTUBE_REFERRER_POLICY = 'strict-origin-when-cross-origin'

/**
 * YouTube 需要 Referer 来识别嵌入客户端；应用全局 no-referrer，因此白名单播放器
 * 必须单独覆盖。源站可能显式写了 no-referrer，也统一收紧到只发送 origin。
 */
function ensureYoutubeReferrerPolicy(block: string): string {
  if (/\breferrerpolicy\s*=/i.test(block)) {
    return block.replace(
      /\breferrerpolicy\s*=\s*(?:["'][^"']*["']|[^\s>]+)/i,
      `referrerpolicy="${YOUTUBE_REFERRER_POLICY}"`,
    )
  }
  return block.replace(
    /<iframe\b/i,
    `<iframe referrerpolicy="${YOUTUBE_REFERRER_POLICY}"`,
  )
}

/**
 * iframe 默认全部丢弃，仅保留明确白名单的视频播放器。
 * YouTube 延续原有 staging 流程；Bilibili/Vimeo 等只重建最小安全 iframe，
 * 不继承上游 style/event/任意权限属性。
 */
function keepAllowedEmbeds(html: string): string {
  return html.replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, (block) => {
    const src = block.match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1]
    if (isAllowedYoutubeEmbedSrc(src)) return ensureYoutubeReferrerPolicy(block)

    const title =
      block.match(/\btitle\s*=\s*["']([^"']+)["']/i)?.[1]?.trim() || '视频'
    return trustedEmbeddedVideoFrameHtml(block, title) ?? ''
  })
}

function audioSrcIn(block: string): string | undefined {
  return (
    block.match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1] ||
    block.match(/<source\b[^>]*\bsrc=["']([^"']+)["']/i)?.[1]
  )
}

/** 只保留 https 音频；javascript: 等伪协议整段丢掉 */
function keepAllowedAudio(html: string): string {
  return html
    .replace(/<audio\b[^>]*\/>/gi, (block) =>
      isAudioMediaUrl(audioSrcIn(block)) ? block : '',
    )
    .replace(/<audio\b[^>]*>[\s\S]*?<\/audio>/gi, (block) =>
      isAudioMediaUrl(audioSrcIn(block)) ? block : '',
    )
}

const CJK_REGEX = /[\p{Script=Han}\u3040-\u30ff\uac00-\ud7af]/u
const LEADING_SPACE_REGEX = /^[\s\u3000\u00a0\u2000-\u200b\ufeff]+/

function hasInlineMedia(element: Element): boolean {
  return Boolean(element.querySelector('img, picture, video, audio, iframe, svg, source'))
}

function unwrapElement(element: Element): void {
  const parent = element.parentNode
  if (!parent) {
    element.remove()
    return
  }
  while (element.firstChild) {
    parent.insertBefore(element.firstChild, element)
  }
  element.remove()
}

function cleanLeadingIndent(element: Element): void {
  while (element.firstChild) {
    const first = element.firstChild
    if (first.nodeType === 3 /* Node.TEXT_NODE */) {
      const text = first.nodeValue || ''
      const cleaned = text.replace(LEADING_SPACE_REGEX, '')
      if (cleaned !== text) {
        first.nodeValue = cleaned
      }
      if (!first.nodeValue) {
        first.remove()
        continue
      }
      break
    } else if (first.nodeType === 1 /* Node.ELEMENT_NODE */) {
      const el = first as Element
      if (el.tagName === 'BR') {
        el.remove()
        continue
      }
      if (/^(span|strong|em|b|i|a|font|small|sub|sup)$/i.test(el.tagName)) {
        cleanLeadingIndent(el)
        // 优设等站用 <span class="img-zoom"><img></span> 包图；无 textContent 但不能删
        if (!el.textContent?.trim()) {
          if (hasInlineMedia(el)) {
            unwrapElement(el)
            continue
          }
          el.remove()
          continue
        }
      }
      break
    } else {
      break
    }
  }
}

/**
 * 规整正文段落排版：
 * 1. 剥离段落开头的硬编码全角空格（\u3000）、不换行空格（\u00a0）与连续空白，消除 4 字符重复缩进；
 * 2. 识别段落中英文属性并打标（data-cjk="true" | "false"），支持西文段落自动顶格排版。
 */
export function normalizeParagraphTypography(html: string): string {
  if (!html || !html.includes('<p')) return html

  try {
    const { document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`)
    const paragraphs = document.querySelectorAll('p')
    if (!paragraphs.length) return html

    paragraphs.forEach((p) => {
      cleanLeadingIndent(p)
      const text = (p.textContent || '').trim()
      if (text) {
        const isCjk = CJK_REGEX.test(text)
        p.setAttribute('data-cjk', isCjk ? 'true' : 'false')
      }
    })

    return document.body.innerHTML
  } catch {
    return html
  }
}

/** 正文来自第三方站点，渲染前统一清洗，并移除会破坏暗色版式的内联样式 */
export function sanitizeArticleHtml(html: string): string {
  const withoutNoise = stripEmbedNoise(html)
  const purified = DOMPurify.sanitize(withoutNoise, {
    ADD_TAGS: ['video', 'source', 'iframe', 'audio'],
    ADD_ATTR: [
      'controls',
      'playsinline',
      'poster',
      'preload',
      'src',
      'srcset',
      'sizes',
      'type',
      'alt',
      'title',
      'loading',
      'decoding',
      'referrerpolicy',
      'referrerPolicy',
      'allow',
      'allowfullscreen',
      'allowFullscreen',
      'frameborder',
      'frameBorder',
      'width',
      'height',
      'data-reader-role',
      'data-cjk',
      'data-lang',
      'data-media-format',
      'data-media-headers',
      'data-media-extra-urls',
      'data-media-origins',
      'data-media-resources',
      'data-media-pending',
      'data-source-page',
      'data-related-title',
      'data-reader-image-fallbacks',
      // Linux.do / Discourse: source classes are removed, so trusted semantic
      // roles are converted to this app-owned marker before sanitization.
      'data-linuxdo-role',
      'data-linuxdo-callout',
      'data-linuxdo-original-src',
      'data-linuxdo-topic-id',
      'data-linuxdo-post-number',
      'data-linuxdo-username',
      'data-linuxdo-href',
      'data-linuxdo-onebox-kind',
      'data-linuxdo-poll-name',
      'data-linuxdo-poll-status',
      'data-linuxdo-poll-type',
      'data-linuxdo-poll-voters',
      'data-linuxdo-poll-votes',
      'data-linuxdo-poll-percent',
      'data-linuxdo-poll-option-id',
      'data-linuxdo-policy-version',
      'data-linuxdo-policy-status',
      'data-linuxdo-hashtag-type',
      'data-linuxdo-hashtag-slug',
      'data-linuxdo-hashtag-glyph',
      'data-linuxdo-category-color',
      'data-linuxdo-preview-block',
      // 知乎段评：只保留本地注入的服务端 segment 元数据，供阅读层打开段评/点赞。
      'data-zhihu-segment-id',
      'data-zhihu-content-id',
      'data-zhihu-content-type',
      'data-zhihu-segment-pid',
      'data-zhihu-segment-start',
      'data-zhihu-segment-end',
      'data-zhihu-segment-liked',
      'data-zhihu-segment-like-count',
      'data-zhihu-segment-comment-count',
      'data-zhihu-segment-my-comment-count',
      'data-zhihu-segment-is-span',
      'data-zhihu-segment-display-text',
      'data-empty',
    ],
    FORBID_TAGS: ['style', 'script', 'form', 'input', 'button'],
    FORBID_ATTR: ['style', 'class', 'align', 'bgcolor'],
    // 允许 https? 以及本地图片代理路径
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|\/api\/image\?)/i,
  })
  const sanitized = enforceArticleHtmlSecurity(purified)
  const stripped = stripEmptyArticleBlocks(keepAllowedAudio(keepAllowedEmbeds(sanitized)))
  return normalizeParagraphTypography(stripped)
}

