/** Pagination is a navigation role, not a category name or a specific CMS class. */
const NEXT = /^(?:下一页|下页|后一页|后页|next(?:\s+page)?)(?:\s*[›»>→▶►])?$|^[›»>→▶►]$/i
const PREVIOUS = /^(?:上一页|上页|前一页|前页|previous(?:\s+page)?|prev)(?:\s*[‹«<←◀◄])?$|^[‹«<←◀◄]$/i
const NUMBER = /^(?:(?:\.{2,}|…+)\s*)?(\d{1,8})(?:\s*(?:\.{2,}|…+))?$/
const PAGER_CLASS = /^(?:pagination(?:[-_\d].*)?|pager|page-navigator|pagebar|dede_pages|page-nav|page-number|page_numbers|wp-block-query-pagination|com-content-category-blog__pagination)$/i

export function paginationLabel(node: Element): string {
  return (node.getAttribute('aria-label') || node.getAttribute('title') || node.textContent || '').replace(/\s+/g, ' ').trim()
}

export function paginationNumber(label: string): number | undefined {
  const value = NUMBER.exec(label.trim())?.[1]
  return value ? Number(value) : undefined
}

export function isNextPageLabel(label: string): boolean { return NEXT.test(label.trim()) }
export function isPaginationControlLabel(label: string): boolean {
  const text = label.trim()
  return NUMBER.test(text) || NEXT.test(text) || PREVIOUS.test(text)
    || /^(?:首页|末页|尾页|first(?:\s+page)?|last(?:\s+page)?|\.{2,}|…+)$/i.test(text)
}

function isPagerContainer(node: Element): boolean {
  if ([...node.classList].some(name => PAGER_CLASS.test(name))) return true
  if (/^(?:pagination|pages?|分页|页码)$/i.test(node.getAttribute('aria-label') || '')) return true
  // Only direct controls participate: a nested pager must not classify its entire
  // navigation ancestor (and all the site's actual categories) as pagination.
  const controls = [...node.querySelectorAll(':scope > a[href], :scope > li > a[href]')]
  const numeric = controls.filter(anchor => paginationNumber(paginationLabel(anchor)) != null)
  if (numeric.length < 2) return false
  const current = controls.some(anchor => anchor.hasAttribute('aria-current') || anchor.matches('.current, .active') || anchor.parentElement?.matches('.current, .active'))
  const direction = controls.some(anchor => NEXT.test(paginationLabel(anchor)) || PREVIOUS.test(paginationLabel(anchor)))
  if (!current && !direction) return false
  const families = numeric.map(anchor => (anchor.getAttribute('href') || '').replace(/\d+/g, ':n'))
  return families.every(family => family === families[0])
}

export function isPaginationNode(node: Element): boolean {
  for (let parent = node.parentElement, depth = 0; parent && depth < 4; parent = parent.parentElement, depth++) {
    if (isPagerContainer(parent)) return true
    if (parent.matches('body, main, article, section')) break
  }
  return false
}
