import { parseHTML } from 'linkedom'

export const DEFERRED_SRC_ATTR = 'data-deferred-src'
export const DEFERRED_POSTER_ATTR = 'data-deferred-poster'
export const DEFERRED_LOAD_TIMEOUT_MS = 20_000

export const DEFERRED_LABEL_IDLE = '点击加载图片'
export const DEFERRED_LABEL_LOADING = '加载中…'
export const DEFERRED_LABEL_FAILED = '加载失败，点击重试'
export const DEFERRED_LABEL_TIMEOUT = '加载超时，点击重试'

export type DeferredHostPhase = 'idle' | 'loading' | 'failed' | 'timeout'

export function deferredHostLabel(phase: DeferredHostPhase): string {
  switch (phase) {
    case 'loading':
      return DEFERRED_LABEL_LOADING
    case 'failed':
      return DEFERRED_LABEL_FAILED
    case 'timeout':
      return DEFERRED_LABEL_TIMEOUT
    default:
      return DEFERRED_LABEL_IDLE
  }
}

export function applyDeferredHostPhase(host: Element, phase: DeferredHostPhase): void {
  host.classList.toggle('is-loading', phase === 'loading')
  host.classList.toggle('is-failed', phase === 'failed' || phase === 'timeout')
  host.classList.toggle('ink-shimmer', phase === 'loading')
  const label = host.querySelector('.reader-deferred-label')
  if (label) label.textContent = deferredHostLabel(phase)
}

function isBadge(img: Element): boolean {
  return img.getAttribute('data-reader-role') === 'badge'
}

function isRelatedCover(img: Element): boolean {
  return img.getAttribute('data-reader-role') === 'related-image'
}

function wrapHost(el: Element, phase: DeferredHostPhase): void {
  const doc = el.ownerDocument
  const host = doc.createElement('button')
  host.setAttribute('type', 'button')
  host.setAttribute('data-no-page-tap', '')
  host.setAttribute('data-reader-deferred', '')
  host.className = 'reader-deferred-host'
  const caption = doc.createElement('span')
  caption.className = 'reader-deferred-label'
  caption.textContent = deferredHostLabel(phase)
  el.replaceWith(host)
  host.append(caption, el)
  applyDeferredHostPhase(host, phase)
}

function deferImage(
  img: Element,
  unlocked: ReadonlySet<string>,
  phases: ReadonlyMap<string, DeferredHostPhase>,
  playableSrcByUrl: ReadonlyMap<string, string>,
): void {
  if (isBadge(img) || isRelatedCover(img)) return
  const src = img.getAttribute('src')
  if (!src || src.startsWith('data:') || src.startsWith('blob:')) return
  if (unlocked.has(src)) {
    const playable = playableSrcByUrl.get(src)
    if (playable && playable !== src) {
      img.setAttribute('src', playable)
      img.removeAttribute('srcset')
    }
    return
  }
  img.setAttribute(DEFERRED_SRC_ATTR, src)
  img.removeAttribute('src')
  img.removeAttribute('srcset')
  wrapHost(img, phases.get(src) ?? 'idle')
}

function deferAudio(audio: Element, unlocked: ReadonlySet<string>): void {
  const src = audio.getAttribute('src') || audio.querySelector('source')?.getAttribute('src') || ''
  if (src && unlocked.has(src)) return
  if (src) {
    audio.setAttribute(DEFERRED_SRC_ATTR, src)
    audio.removeAttribute('src')
  }
  for (const source of Array.from(audio.querySelectorAll('source'))) {
    const nested = source.getAttribute('src')
    if (!nested) continue
    if (!audio.getAttribute(DEFERRED_SRC_ATTR)) audio.setAttribute(DEFERRED_SRC_ATTR, nested)
    source.removeAttribute('src')
  }
}

function deferVideo(video: Element, unlocked: ReadonlySet<string>): void {
  const src = video.getAttribute('src') || video.querySelector('source')?.getAttribute('src') || ''
  const poster = video.getAttribute('poster') || ''
  if (src && unlocked.has(src)) return
  if (src) {
    video.setAttribute(DEFERRED_SRC_ATTR, src)
    video.removeAttribute('src')
  }
  for (const source of Array.from(video.querySelectorAll('source'))) {
    const nested = source.getAttribute('src')
    if (!nested) continue
    if (!video.getAttribute(DEFERRED_SRC_ATTR)) video.setAttribute(DEFERRED_SRC_ATTR, nested)
    source.removeAttribute('src')
  }
  if (poster) {
    video.setAttribute(DEFERRED_POSTER_ATTR, poster)
    video.removeAttribute('poster')
  }
}

export function deferMediaInHtml(
  html: string,
  unlockedUrls: ReadonlySet<string>,
  phases: ReadonlyMap<string, DeferredHostPhase> = new Map(),
  playableSrcByUrl: ReadonlyMap<string, string> = new Map(),
): string {
  const { document } = parseHTML(`<div id="newsnook-defer">${html}</div>`)
  const root = document.getElementById('newsnook-defer')
  if (!root) return html
  for (const img of Array.from(root.querySelectorAll('img'))) {
    deferImage(img, unlockedUrls, phases, playableSrcByUrl)
  }
  for (const video of Array.from(root.querySelectorAll('video'))) deferVideo(video, unlockedUrls)
  for (const audio of Array.from(root.querySelectorAll('audio'))) deferAudio(audio, unlockedUrls)
  return root.innerHTML
}
