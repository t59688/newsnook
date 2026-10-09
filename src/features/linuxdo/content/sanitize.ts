import { parseHTML } from 'linkedom'

import { sanitizeArticleHtml } from '../../../lib/sanitize'

const LINUX_DO_ORIGIN = 'https://linux.do'

function absoluteLinuxDoUrl(value: string | null): string | undefined {
  if (!value) return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  try {
    const parsed = new URL(trimmed, LINUX_DO_ORIGIN)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return undefined
    return parsed.toString()
  } catch {
    return undefined
  }
}

function numericDimension(element: Element, name: 'width' | 'height'): number | undefined {
  const value = Number(element.getAttribute(name) ?? '')
  return Number.isFinite(value) && value > 0 ? value : undefined
}

function copySemanticAttribute(element: Element, source: string, target: string): void {
  const value = element.getAttribute(source)?.trim()
  if (value) element.setAttribute(target, value)
}

function formatDiscoursePoll(poll: Element): void {
  poll.setAttribute('data-linuxdo-role', 'poll')
  const name = poll.getAttribute('data-poll-name')?.trim() || 'poll'
  const type = poll.getAttribute('data-poll-type')?.trim() || 'regular'
  const status = poll.getAttribute('data-poll-status')?.trim() || 'open'
  const isPublic = poll.getAttribute('data-poll-public') === 'true'

  poll.setAttribute('data-linuxdo-poll-name', name)
  poll.setAttribute('data-linuxdo-poll-type', type)
  poll.setAttribute('data-linuxdo-poll-status', status)

  poll.removeAttribute('data-poll-name')
  poll.removeAttribute('data-poll-type')
  poll.removeAttribute('data-poll-status')
  poll.removeAttribute('data-poll-public')
  poll.removeAttribute('data-poll-question')
  poll.removeAttribute('data-poll-title')
  poll.removeAttribute('data-poll-voters')
  poll.removeAttribute('data-poll-votes')

  // Title
  let title = poll.getAttribute('data-poll-question')?.trim() || poll.getAttribute('data-poll-title')?.trim() || ''
  const titleEl = poll.querySelector('.poll-title, .poll-question')
  if (titleEl && !title) {
    title = titleEl.textContent?.trim() || ''
  }

  // Total voters / votes count
  let totalVoters = 0
  const infoNumberEl = poll.querySelector('.poll-info .info-number, .poll-voters')
  if (infoNumberEl) {
    const parsed = parseInt(infoNumberEl.textContent || '', 10)
    if (Number.isFinite(parsed) && parsed > 0) totalVoters = parsed
  }
  const pollVotersAttr = poll.getAttribute('data-poll-voters') || poll.getAttribute('data-poll-votes')
  if (!totalVoters && pollVotersAttr) {
    const parsed = parseInt(pollVotersAttr, 10)
    if (Number.isFinite(parsed) && parsed > 0) totalVoters = parsed
  }

  // Parse option elements
  const optionLis = Array.from(poll.querySelectorAll('li[data-poll-option-id], .poll-container li, ul li'))
  interface OptionData {
    id: string
    votes: number
    label: string
  }

  const options: OptionData[] = []
  let sumVotes = 0

  optionLis.forEach((li, idx) => {
    const id = li.getAttribute('data-poll-option-id')?.trim() || String(idx + 1)
    const optInfoNumber = li.querySelector('.info-number, .info-votes')
    let votes = 0
    let label = ''

    if (optInfoNumber) {
      const parsed = parseInt(optInfoNumber.textContent || '', 10)
      if (Number.isFinite(parsed)) votes = parsed
      optInfoNumber.remove()
      label = li.textContent?.trim() || ''
    } else {
      const rawText = li.textContent?.trim() || ''
      // Match patterns like "12是", "12 是", "1否"
      const match = rawText.match(/^(\d+)\s*(.*)$/)
      if (match && match[2]) {
        votes = parseInt(match[1], 10)
        label = match[2].trim()
      } else {
        label = rawText
      }
    }

    sumVotes += votes
    options.push({ id, votes, label })
  })

  if (!totalVoters && sumVotes > 0) {
    totalVoters = sumVotes
  }

  if (totalVoters > 0) {
    poll.setAttribute('data-linuxdo-poll-voters', String(totalVoters))
  }

  // Type label mapping
  const typeLabel =
    type === 'multiple' ? '多选' : type === 'number' ? '评分' : type === 'ranked_choice' ? '排序' : '单选'

  // Clear existing children and reconstruct semantic HTML
  poll.innerHTML = ''

  // 1. Header
  const doc = poll.ownerDocument
  const header = doc.createElement('div')
  header.setAttribute('data-linuxdo-role', 'poll-header')

  const badges = doc.createElement('div')
  badges.setAttribute('data-linuxdo-role', 'poll-badges')

  const typeBadge = doc.createElement('span')
  typeBadge.setAttribute('data-linuxdo-role', 'poll-badge')
  typeBadge.textContent = typeLabel
  badges.appendChild(typeBadge)

  if (status === 'closed') {
    const closedBadge = doc.createElement('span')
    closedBadge.setAttribute('data-linuxdo-role', 'poll-badge-closed')
    closedBadge.textContent = '已关闭'
    badges.appendChild(closedBadge)
  }

  if (isPublic) {
    const publicBadge = doc.createElement('span')
    publicBadge.setAttribute('data-linuxdo-role', 'poll-badge-subtle')
    publicBadge.textContent = '公开'
    badges.appendChild(publicBadge)
  }

  header.appendChild(badges)

  if (title) {
    const titleNode = doc.createElement('div')
    titleNode.setAttribute('data-linuxdo-role', 'poll-title')
    titleNode.textContent = title
    header.appendChild(titleNode)
  }
  poll.appendChild(header)

  // 2. Options list
  if (options.length > 0) {
    const optionsContainer = doc.createElement('div')
    optionsContainer.setAttribute('data-linuxdo-role', 'poll-options')

    for (const opt of options) {
      const optionCard = doc.createElement('div')
      optionCard.setAttribute('data-linuxdo-role', 'poll-option')
      optionCard.setAttribute('data-linuxdo-poll-option-id', opt.id)
      optionCard.setAttribute('data-linuxdo-poll-votes', String(opt.votes))

      const percent = totalVoters > 0 ? Math.min(100, Math.round((opt.votes / totalVoters) * 100)) : 0
      optionCard.setAttribute('data-linuxdo-poll-percent', String(percent))

      // Progress bar track
      const bar = doc.createElement('div')
      bar.setAttribute('data-linuxdo-role', 'poll-bar')
      bar.setAttribute('data-linuxdo-poll-percent', String(percent))
      optionCard.appendChild(bar)

      // Content row
      const content = doc.createElement('div')
      content.setAttribute('data-linuxdo-role', 'poll-option-content')

      const indicator = doc.createElement('span')
      indicator.setAttribute('data-linuxdo-role', 'poll-indicator')
      content.appendChild(indicator)

      const labelNode = doc.createElement('span')
      labelNode.setAttribute('data-linuxdo-role', 'poll-label')
      labelNode.textContent = opt.label
      content.appendChild(labelNode)

      if (totalVoters > 0 || opt.votes > 0) {
        const statsNode = doc.createElement('span')
        statsNode.setAttribute('data-linuxdo-role', 'poll-stats')
        statsNode.textContent = `${percent}%`

        const countNode = doc.createElement('span')
        countNode.setAttribute('data-linuxdo-role', 'poll-count')
        countNode.textContent = ` (${opt.votes}票)`
        statsNode.appendChild(countNode)

        content.appendChild(statsNode)
      }

      optionCard.appendChild(content)
      optionsContainer.appendChild(optionCard)
    }

    poll.appendChild(optionsContainer)
  }

  // 3. Footer
  const footer = doc.createElement('div')
  footer.setAttribute('data-linuxdo-role', 'poll-footer')

  const summary = doc.createElement('span')
  summary.setAttribute('data-linuxdo-role', 'poll-voter-summary')
  summary.textContent = totalVoters > 0 ? `共 ${totalVoters} 位投票人` : '投票'
  footer.appendChild(summary)

  poll.appendChild(footer)
}

function formatDiscoursePolicy(policy: Element): void {
  policy.setAttribute('data-linuxdo-role', 'policy')
  copySemanticAttribute(policy, 'data-version', 'data-linuxdo-policy-version')
  copySemanticAttribute(policy, 'data-status', 'data-linuxdo-policy-status')
  policy.removeAttribute('data-version')
  policy.removeAttribute('data-status')

  const body = policy.querySelector('.policy-body')
  if (body) {
    body.setAttribute('data-linuxdo-role', 'policy-body')
  }
  const footer = policy.querySelector('.policy-footer')
  if (footer) {
    footer.setAttribute('data-linuxdo-role', 'policy-footer')
  }
}

function formatDiscourseHashtag(hashtag: Element): void {
  hashtag.setAttribute('data-linuxdo-role', 'hashtag')
  hashtag.setAttribute('data-reader-role', 'badge')
  copySemanticAttribute(hashtag, 'data-type', 'data-linuxdo-hashtag-type')
  copySemanticAttribute(hashtag, 'data-slug', 'data-linuxdo-hashtag-slug')

  const doc = hashtag.ownerDocument
  const svgs = hashtag.querySelectorAll('svg')
  svgs.forEach((svg) => {
    const glyph = doc.createElement('span')
    glyph.setAttribute('data-linuxdo-role', 'hashtag-glyph')
    glyph.setAttribute('aria-hidden', 'true')
    glyph.textContent = '🏷️'
    svg.replaceWith(glyph)
  })

  hashtag.querySelectorAll('img').forEach((img) => {
    img.setAttribute('data-linuxdo-role', 'badge-image')
    img.setAttribute('data-reader-role', 'badge')
  })
}

function formatDiscourseQuote(quote: Element): void {
  quote.setAttribute('data-linuxdo-role', 'quote')
  copySemanticAttribute(quote, 'data-topic', 'data-linuxdo-topic-id')
  copySemanticAttribute(quote, 'data-post', 'data-linuxdo-post-number')
  copySemanticAttribute(quote, 'data-username', 'data-linuxdo-username')
  quote.removeAttribute('data-topic')
  quote.removeAttribute('data-post')
  quote.removeAttribute('data-username')

  const doc = quote.ownerDocument
  const body = quote.querySelector('blockquote')
  if (body) {
    body.setAttribute('data-linuxdo-role', 'quote-body')
  }

  const titleEl = quote.querySelector('.title')
  if (!titleEl) return

  titleEl.setAttribute('data-linuxdo-role', 'quote-header')

  // 1. Extract avatar
  const avatarImg = titleEl.querySelector('img.avatar') || titleEl.querySelector('img')
  let avatarNode: Element | null = null
  if (avatarImg) {
    avatarNode = avatarImg
    avatarNode.setAttribute('data-linuxdo-role', 'quote-avatar')
    avatarNode.setAttribute('data-reader-role', 'badge')
    avatarNode.setAttribute('width', '20')
    avatarNode.setAttribute('height', '20')
    const src = absoluteLinuxDoUrl(avatarNode.getAttribute('src'))
    if (src) avatarNode.setAttribute('src', src)
  }

  // 2. Extract category info (if present)
  const categoryWrapper = titleEl.querySelector('.badge-category__wrapper, .badge-category, .topic-category')
  let categoryNode: Element | null = null
  if (categoryWrapper) {
    const catLink = categoryWrapper.closest('a') || categoryWrapper.querySelector('a') || (categoryWrapper.tagName === 'A' ? categoryWrapper : null)
    const catHref = absoluteLinuxDoUrl(catLink?.getAttribute('href') ?? null)
    const catName = categoryWrapper.querySelector('.badge-category__name')?.textContent?.trim() || categoryWrapper.textContent?.trim() || ''

    const coloredEl = categoryWrapper.querySelector('[style*="--category-badge-color"]') || categoryWrapper
    const styleAttr = coloredEl.getAttribute('style') ?? ''
    const colorMatch = styleAttr.match(/--category-badge-color:\s*(#[0-9a-fA-F]{3,8}|[a-zA-Z]+)/i)
    const catColor = colorMatch ? colorMatch[1] : '#3AB54A'

    if (catName) {
      categoryNode = doc.createElement('a')
      if (catHref) categoryNode.setAttribute('href', catHref)
      categoryNode.setAttribute('data-linuxdo-role', 'quote-category')
      if (catColor) categoryNode.setAttribute('data-linuxdo-category-color', catColor)

      const dot = doc.createElement('span')
      dot.setAttribute('data-linuxdo-role', 'quote-category-dot')
      if (catColor) dot.setAttribute('data-linuxdo-category-color', catColor)
      categoryNode.appendChild(dot)

      const nameSpan = doc.createElement('span')
      nameSpan.setAttribute('data-linuxdo-role', 'quote-category-name')
      nameSpan.textContent = catName
      categoryNode.appendChild(nameSpan)
    }
  }

  // 3. Extract topic link or username
  const textContentEl = titleEl.querySelector('.quote-title__text-content')
  const searchScope = textContentEl || titleEl
  const allLinks = Array.from(searchScope.querySelectorAll('a')).filter(
    (a) => !a.classList.contains('badge-category__wrapper') && !a.closest('.badge-category__wrapper, .badge-category, .topic-category')
  )
  const topicLink = allLinks.find((a) => /\/t\//.test(a.getAttribute('href') ?? '')) || allLinks[0] || null

  let titleContentNode: Element | null = null
  if (topicLink) {
    const cleanLink = doc.createElement('a')
    const href = absoluteLinuxDoUrl(topicLink.getAttribute('href'))
    if (href) cleanLink.setAttribute('href', href)
    cleanLink.setAttribute('data-linuxdo-role', 'quote-title-link')
    cleanLink.textContent = topicLink.textContent?.trim() || ''
    titleContentNode = cleanLink
  } else {
    const userSpan = doc.createElement('span')
    userSpan.setAttribute('data-linuxdo-role', 'quote-username')
    const rawUsername = quote.getAttribute('data-linuxdo-username')
    let userText = rawUsername ? `${rawUsername}:` : ''
    if (!userText) {
      const clonedTitle = titleEl.cloneNode(true) as Element
      clonedTitle.querySelectorAll('.quote-controls, img, .badge-category__wrapper').forEach((el) => el.remove())
      userText = clonedTitle.textContent?.trim() || ''
    }
    userSpan.textContent = userText
    titleContentNode = userSpan
  }

  // 4. Build controls with chevron
  const controls = doc.createElement('div')
  controls.setAttribute('data-linuxdo-role', 'quote-controls')
  controls.setAttribute('aria-hidden', 'true')
  const chevron = doc.createElement('span')
  chevron.setAttribute('data-linuxdo-role', 'quote-chevron')
  chevron.textContent = '⌄'
  controls.appendChild(chevron)

  // 5. Reconstruct titleEl DOM cleanly
  titleEl.innerHTML = ''

  const main = doc.createElement('div')
  main.setAttribute('data-linuxdo-role', 'quote-header-main')

  if (avatarNode) {
    main.appendChild(avatarNode)
  }

  const meta = doc.createElement('div')
  meta.setAttribute('data-linuxdo-role', 'quote-meta')

  if (titleContentNode) {
    const titleRow = doc.createElement('div')
    titleRow.setAttribute('data-linuxdo-role', 'quote-title-row')
    titleRow.appendChild(titleContentNode)
    meta.appendChild(titleRow)
  }

  if (categoryNode) {
    const catRow = doc.createElement('div')
    catRow.setAttribute('data-linuxdo-role', 'quote-category-row')
    catRow.appendChild(categoryNode)
    meta.appendChild(catRow)
  }

  main.appendChild(meta)
  titleEl.appendChild(main)
  titleEl.appendChild(controls)
}

const MARKDOWN_CALLOUT_KIND: Record<string, 'note' | 'tip' | 'important' | 'warning' | 'caution' | 'success'> = {
  note: 'note',
  info: 'note',
  tip: 'tip',
  hint: 'tip',
  important: 'important',
  warning: 'warning',
  warn: 'warning',
  caution: 'caution',
  danger: 'caution',
  error: 'caution',
  success: 'success',
  check: 'success',
  done: 'success',
}

const MARKDOWN_CALLOUT_RE = /^\s*\[!\s*([a-z]+)\s*\]\s*/i

function markMarkdownCallout(blockquote: Element): void {
  // Discourse quote widgets have their own author/topic semantics. Only enhance
  // plain Markdown blockquotes so quoted forum posts cannot accidentally change type.
  if (blockquote.closest('aside.quote')) return

  let firstMeaningfulText: ChildNode | null = null
  const queue: ChildNode[] = Array.from(blockquote.childNodes)
  while (queue.length > 0) {
    const node = queue.shift()!
    if (node.nodeType === 3) {
      if ((node.nodeValue ?? '').trim()) {
        firstMeaningfulText = node
        break
      }
      continue
    }
    if (node.nodeType !== 1) continue
    const element = node as Element
    queue.unshift(...Array.from(element.childNodes))
  }

  if (!firstMeaningfulText) return
  const text = firstMeaningfulText.nodeValue ?? ''
  const match = text.match(MARKDOWN_CALLOUT_RE)
  const kind = match ? MARKDOWN_CALLOUT_KIND[match[1].toLowerCase()] : undefined
  if (!match || !kind) return

  firstMeaningfulText.nodeValue = text.slice(match[0].length)
  blockquote.setAttribute('data-linuxdo-role', 'callout')
  blockquote.setAttribute('data-linuxdo-callout', kind)

  // GitHub-style alerts often put the marker on a line by itself. Remove the
  // now-empty leading paragraph without touching links/strong/code in real content.
  const firstElement = Array.from(blockquote.children)[0]
  if (firstElement?.tagName === 'P' && !(firstElement.textContent ?? '').trim() && !firstElement.querySelector('img, video, audio, iframe, code')) {
    firstElement.remove()
  }
}

function markDiscourseSemantics(root: Element): void {
  root.querySelectorAll('aside.quote').forEach((quote) => formatDiscourseQuote(quote))
  root.querySelectorAll('blockquote').forEach((blockquote) => markMarkdownCallout(blockquote))

  root.querySelectorAll('aside.onebox, .onebox').forEach((onebox) => {
    const className = onebox.getAttribute('class') ?? ''
    const target = onebox.querySelector('a[href]')
    const href = absoluteLinuxDoUrl(onebox.getAttribute('data-onebox-src') ?? target?.getAttribute('href') ?? null)
    const hrefUrl = href ? new URL(href) : undefined
    const localTopic =
      /(?:^|\s)discourse(?:topic|local-date)?(?:\s|$)/i.test(className) ||
      /(?:^|\s)discourse-topic(?:\s|$)/i.test(className) ||
      Boolean(hrefUrl?.hostname === 'linux.do' && /^\/t\//.test(hrefUrl.pathname))
    onebox.setAttribute('data-linuxdo-role', localTopic ? 'onebox-topic' : 'onebox')
    onebox.setAttribute('data-linuxdo-onebox-kind', localTopic ? 'topic' : 'external')
    if (href) onebox.setAttribute('data-linuxdo-href', href)
    onebox.removeAttribute('data-onebox-src')
    onebox.querySelectorAll('header, .source').forEach((element) => element.setAttribute('data-linuxdo-role', 'onebox-source'))
    onebox.querySelectorAll('.onebox-body, article').forEach((element) => element.setAttribute('data-linuxdo-role', 'onebox-body'))
    onebox.querySelectorAll('h3, h4').forEach((element) => element.setAttribute('data-linuxdo-role', 'onebox-title'))
    onebox.querySelectorAll('p').forEach((element) => element.setAttribute('data-linuxdo-role', 'onebox-description'))
    onebox.querySelectorAll('.category, .topic-category').forEach((element) => element.setAttribute('data-linuxdo-role', 'onebox-category'))
    onebox.querySelectorAll('.discourse-tags, .topic-tags').forEach((element) => element.setAttribute('data-linuxdo-role', 'onebox-tags'))
  })

  root.querySelectorAll('a.mention').forEach((element) => element.setAttribute('data-linuxdo-role', 'mention'))
  root.querySelectorAll('a.mention-group').forEach((element) => element.setAttribute('data-linuxdo-role', 'mention-group'))
  root.querySelectorAll('.spoiler, .spoiled, [data-spoiler-state]').forEach((element) => element.setAttribute('data-linuxdo-role', 'spoiler'))
  root.querySelectorAll('details').forEach((element) => element.setAttribute('data-linuxdo-role', 'details'))
  root.querySelectorAll('.poll').forEach((element) => formatDiscoursePoll(element))
  root.querySelectorAll('.policy').forEach((element) => formatDiscoursePolicy(element))
  root.querySelectorAll('a.hashtag, a.hashtag-cooked, span.hashtag, span.hashtag-cooked, a.discourse-tag').forEach((element) => formatDiscourseHashtag(element))
  root.querySelectorAll('table').forEach((element) => element.setAttribute('data-linuxdo-role', 'table'))
  root.querySelectorAll('pre').forEach((element) => element.setAttribute('data-linuxdo-role', 'code-block'))
  root.querySelectorAll('a.attachment').forEach((element) => element.setAttribute('data-linuxdo-role', 'attachment'))
}

function normalizeDiscourseMarkup(html: string): string {
  if (!html.trim()) return ''

  try {
    const { document } = parseHTML('<!doctype html><html><body></body></html>')
    document.body.innerHTML = html
    markDiscourseSemantics(document.body)

    // Discourse lightbox metadata (filename / dimensions / filesize) is UI chrome,
    // not post content. Once source classes are stripped by our generic sanitizer
    // it would otherwise become visible body text and create large layout gaps.
    document.body
      .querySelectorAll('.lightbox-wrapper .meta, a.lightbox .meta, .lightbox-wrapper .informations, .lightbox-wrapper .filename')
      .forEach((element) => element.remove())

    document.body.querySelectorAll('.lightbox-wrapper').forEach((element) => {
      element.setAttribute('data-linuxdo-role', 'image-block')
    })
    document.body.querySelectorAll('a.lightbox').forEach((element) => {
      const fullSize = absoluteLinuxDoUrl(element.getAttribute('href'))
      const image = element.querySelector('img')
      if (fullSize && image) image.setAttribute('data-linuxdo-original-src', fullSize)
      // Discourse uses this anchor only to launch its own lightbox. NewsNook owns
      // image preview, so leaving href here risks opening the browser as a second action.
      element.removeAttribute('href')
      element.setAttribute('data-linuxdo-role', 'image-link')
    })

    document.body.querySelectorAll('a[href]').forEach((element) => {
      const href = absoluteLinuxDoUrl(element.getAttribute('href'))
      if (href) element.setAttribute('href', href)
      else element.removeAttribute('href')
    })

    document.body.querySelectorAll('img').forEach((element) => {
      const src = absoluteLinuxDoUrl(element.getAttribute('src'))
      if (src) {
        element.setAttribute('src', src)
        if (!element.getAttribute('data-linuxdo-original-src')) element.setAttribute('data-linuxdo-original-src', src)
      } else element.removeAttribute('src')

      // Source responsive candidates are generated for the Discourse layout and
      // can point at relative/CDN-specific variants. The canonical src is enough
      // here and avoids WebView choosing an unexpected candidate.
      element.removeAttribute('srcset')
      element.removeAttribute('sizes')

      const className = element.getAttribute('class') ?? ''
      const width = numericDimension(element, 'width')
      const height = numericDimension(element, 'height')
      const srcValue = (element.getAttribute('src') ?? '').toLowerCase()
      const isEmoji =
        /(?:^|\s)emoji(?:\s|$)/i.test(className) ||
        srcValue.includes('/images/emoji/') ||
        (srcValue.includes('/emoji/') && width !== undefined && width <= 32 && height !== undefined && height <= 32)
      const isBadgeOrIcon =
        !isEmoji &&
        (Boolean(element.closest('[data-linuxdo-role="hashtag"], a.hashtag, a.hashtag-cooked')) ||
          (width !== undefined && width <= 48 && height !== undefined && height <= 48) ||
          /(?:^|\s)(?:badge|icon|glyph|favicon|flair|avatar-inline|tag)(?:\s|$)/i.test(className))

      const onebox = element.closest('[data-linuxdo-role="onebox"], [data-linuxdo-role="onebox-topic"]')
      const quoteHeader = element.closest('[data-linuxdo-role="quote-header"]')
      if (element.getAttribute('data-linuxdo-role') === 'quote-avatar' || quoteHeader) {
        element.setAttribute('data-linuxdo-role', 'quote-avatar')
        element.setAttribute('data-reader-role', 'badge')
      } else if (isEmoji) {
        element.setAttribute('data-linuxdo-role', 'emoji')
        element.setAttribute('data-reader-role', 'badge')
        element.setAttribute('width', '20')
        element.setAttribute('height', '20')
      } else if (isBadgeOrIcon) {
        element.setAttribute('data-linuxdo-role', 'badge-image')
        element.setAttribute('data-reader-role', 'badge')
      } else if (onebox) {
        element.setAttribute('data-linuxdo-role', 'onebox-image')
      } else {
        element.setAttribute('data-linuxdo-role', 'content-image')
      }

      element.setAttribute('loading', 'lazy')
      element.setAttribute('decoding', 'async')
    })

    // Remove empty image blocks without media
    document.body.querySelectorAll('[data-linuxdo-role="image-block"]').forEach((element) => {
      if (!element.querySelector('img, video, iframe')) {
        element.remove()
      }
    })

    // Remove empty paragraphs or mark paragraph with content image
    document.body.querySelectorAll('p').forEach((element) => {
      const contentImage = element.querySelector('img[data-linuxdo-role="content-image"]')
      const hasMedia = element.querySelector('img, video, iframe, [data-linuxdo-role]')
      const text = (element.textContent || '').trim()
      if (contentImage && !text) {
        element.setAttribute('data-linuxdo-role', 'image-paragraph')
      } else if (!text && !hasMedia) {
        element.remove()
      }
    })

    document.body.querySelectorAll('video, source').forEach((element) => {
      const src = absoluteLinuxDoUrl(element.getAttribute('src'))
      if (src) element.setAttribute('src', src)
      else if (element.hasAttribute('src')) element.removeAttribute('src')
    })

    document.body.querySelectorAll('video[poster]').forEach((element) => {
      const poster = absoluteLinuxDoUrl(element.getAttribute('poster'))
      if (poster) element.setAttribute('poster', poster)
      else element.removeAttribute('poster')
    })

    return document.body.innerHTML
  } catch {
    return html
  }
}

export function sanitizeLinuxDoCooked(html: string): string {
  return sanitizeArticleHtml(normalizeDiscourseMarkup(html))
}
