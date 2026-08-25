import createDOMPurify from 'dompurify'
import { parseHTML } from 'linkedom'

import { isAudioMediaUrl } from './articleAudio'

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

/** 丢掉非 YouTube 的 iframe，并为白名单播放器补齐最小来源标识 */
function keepAllowedEmbeds(html: string): string {
  return html.replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, (block) => {
    const src = block.match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1]
    return isAllowedYoutubeEmbedSrc(src) ? ensureYoutubeReferrerPolicy(block) : ''
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
  const sanitized = DOMPurify.sanitize(withoutNoise, {
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
      'data-empty',
    ],
    FORBID_TAGS: ['style', 'script', 'form', 'input', 'button'],
    FORBID_ATTR: ['style', 'class', 'align', 'bgcolor'],
    // 允许 https? 以及本地图片代理路径
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|\/api\/image\?)/i,
  })
  const stripped = stripEmptyArticleBlocks(keepAllowedAudio(keepAllowedEmbeds(sanitized)))
  return normalizeParagraphTypography(stripped)
}

