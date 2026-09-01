/**
 * Native Android fullscreen uses a fixed-position player instead of the DOM
 * Fullscreen API. Article HTML can place that player under CSS layout
 * containment (for example `.reader-prose p { contain: layout style }`), which
 * turns the paragraph into the containing block for `position: fixed` and clips
 * the player down to a thin strip.
 *
 * Keep the React portal container stable, but temporarily move that container
 * to <body> whenever fullscreen is immersive without a real DOM fullscreen
 * element. Moving the portal host preserves the mounted <video> element and its
 * playback state while escaping all reader containment/overflow ancestors.
 */
export function syncInlineVideoFullscreenHost(
  host: HTMLDivElement,
  anchor: Comment,
  doc: Document = document,
): void {
  const fullscreenRoot = host.querySelector<HTMLElement>('[data-video-fullscreen="true"]')
  const needsPromotion = Boolean(
    fullscreenRoot && doc.fullscreenElement !== fullscreenRoot,
  )

  if (needsPromotion) {
    if (host.parentNode !== doc.body) doc.body.appendChild(host)
    return
  }

  const parent = anchor.parentNode
  if (!parent) return
  if (host.parentNode !== parent || host.previousSibling !== anchor) {
    parent.insertBefore(host, anchor.nextSibling)
  }
}

/** Watch the player fullscreen marker and keep its portal host in the right tree. */
export function watchInlineVideoFullscreenHost(
  host: HTMLDivElement,
  anchor: Comment,
  doc: Document = document,
): () => void {
  const sync = () => syncInlineVideoFullscreenHost(host, anchor, doc)
  const observer = new MutationObserver(sync)
  observer.observe(host, {
    subtree: true,
    attributes: true,
    attributeFilter: ['data-video-fullscreen'],
  })
  doc.addEventListener('fullscreenchange', sync)
  sync()

  return () => {
    observer.disconnect()
    doc.removeEventListener('fullscreenchange', sync)
  }
}
