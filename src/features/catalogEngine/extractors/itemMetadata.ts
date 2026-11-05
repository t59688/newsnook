import { positiveRank } from '../itemSemantics'

export function rankOf(card: Element): number | undefined {
  const marker = card.querySelector('[data-rank], [itemprop="position"], .rank-number, .rank, .num, .top em')
  const explicit = positiveRank(card.getAttribute('data-rank') ?? marker?.getAttribute('data-rank') ?? marker?.getAttribute('content') ?? marker?.textContent)
  if (explicit != null) return explicit
  const row = card.tagName === 'LI' ? card : card.closest('li')
  const list = row?.parentElement
  if (list?.tagName !== 'OL' || !row) return undefined
  const rows = [...list.children].filter(node => node.tagName === 'LI')
  const reversed = list.hasAttribute('reversed')
  let rank = Number(list.getAttribute('start') ?? (reversed ? rows.length : 1))
  for (const entry of rows) {
    if (entry.hasAttribute('value')) rank = Number(entry.getAttribute('value'))
    if (entry === row) return positiveRank(rank)
    rank += reversed ? -1 : 1
  }
  return undefined
}
export function undecoratedText(node: Element | undefined | null): string {
  if (!node) return ''
  const copy = node.cloneNode(true) as Element
  for (const marker of copy.querySelectorAll('.num, .rank, .rank-number, .top, [data-rank], [itemprop="position"]')) marker.remove()
  return copy.textContent || ''
}
