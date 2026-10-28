import type { FrameworkId } from '../../frameworkDetect/types'
import { isCatalogContentUrl, isPlaybackControlTitle } from '../../catalogEngine/linkRoles'
import { isUtilityPath } from '../../catalogEngine/normalize'
import { isDisabled, siteUrl } from '../context'
import { isPaginationNode } from '../navigationRoles'
import type { CatalogControl, CatalogCapabilityIssue, CatalogSemantic } from './types'
import { CONTROL_ATTRIBUTE, CONTROL_SELECTOR, MAX_CHOICES, MAX_CONTROLS } from './types'
import { fieldRole, labelSemantic, SEMANTIC_TITLES } from './semantics'

const EXCLUDED = 'form, article, header, footer, aside, .sidebar, .panel-aside, .related, .related-posts, .recommendations, .playlist, .play-list, .player-controls, .author-info, .author-box, .byline'
const BOUNDARY = 'body, main, section, article, header, footer, nav, [role="navigation"]'
const FILTER_CLASS = /(?:^|[\s_-])(?:filters?|screen|facets?|sort|sorting)(?:$|[\s_-])/i
const clean = (value: string | null | undefined) => (value || '').replace(/\s+/g, ' ').trim()
function compactText(node: Element): string {
  const copy = node.cloneNode(true) as Element
  for (const child of copy.querySelectorAll('a, input, select, button, img, svg, ul, ol, dd')) child.remove()
  return clean(copy.textContent).slice(0, 100)
}
function rowLabel(node: Element): string {
  const explicit = node.getAttribute('aria-label') || node.getAttribute('data-label')
  if (explicit && labelSemantic(explicit)) return clean(explicit)
  const previous = node.previousElementSibling
  if (node.tagName === 'DD' && previous?.tagName === 'DT') return clean(previous.textContent)
  const labels = [...node.children].filter(child => child.matches('dt, legend, label, strong, b, span, h2, h3, h4, .label'))
    .map(compactText).filter(value => labelSemantic(value))
  if (new Set(labels.map(labelSemantic)).size > 1) return ''
  if (labels[0]) return labels[0]
  const own = [...node.childNodes].filter(child => child.nodeType === 3).map(child => child.textContent || '').join(' ')
  return labelSemantic(own) ? clean(own) : ''
}
function isSelected(node: Element): boolean {
  return node.getAttribute('aria-current') === 'page' || node.getAttribute('aria-selected') === 'true'
    || node.matches('.active, .current, .selected, .checked') || Boolean(node.parentElement?.matches('li.active, li.current, li.selected'))
}
function urlKey(value: string): string {
  const url = new URL(value)
  url.hash = ''
  const entries = [...url.searchParams].filter(([key]) => !/^(utm_|fbclid$|gclid$)/i.test(key)).sort(([a], [b]) => a.localeCompare(b))
  return JSON.stringify([url.origin, url.pathname, entries])
}
function varyingField(urls: string[], engine: FrameworkId): { semantic?: CatalogSemantic; field?: string } {
  const parsed = urls.map(url => new URL(url))
  if (!parsed.length || !parsed.every(url => url.pathname === parsed[0].pathname)) return {}
  const keys = new Set(parsed.flatMap(url => [...url.searchParams.keys()]))
  const varying = [...keys].filter(key => !/^(utm_|fbclid$|gclid$)/i.test(key)
    && new Set(parsed.map(url => JSON.stringify(url.searchParams.getAll(key)))).size > 1)
  const meaningful = varying.filter(key => fieldRole(key, engine) !== 'pagination')
  if (meaningful.length !== 1) return {}
  const role = fieldRole(meaningful[0], engine)
  return { semantic: role && role !== 'search' && role !== 'pagination' ? role : undefined, field: meaningful[0] }
}

/** Find the smallest labelled/URL-consistent row, independent of a site's CSS class names. */
export function discoverLinkControls(document: Document, baseUrl: string, pageUrl: string, engine: FrameworkId): { controls: CatalogControl[]; issues: CatalogCapabilityIssue[] } {
  const controls: CatalogControl[] = []
  const issues: CatalogCapabilityIssue[] = []
  const candidates = new Set<Element>()
  const paginationCache = new WeakMap<Element, boolean>()
  for (const anchor of [...document.querySelectorAll('a[href]')].slice(0, 3000)) {
    if (anchor.closest(EXCLUDED) || anchor.closest(CONTROL_SELECTOR) || isPaginationNode(anchor, paginationCache)) continue
    for (let parent = anchor.parentElement, depth = 0; parent && depth < 4; parent = parent.parentElement, depth++) {
      if (parent.matches(BOUNDARY)) break
      candidates.add(parent)
    }
  }
  const signatures = new Set<string>()
  for (const root of candidates) {
    if (controls.length >= MAX_CONTROLS) break
    if (root.closest(EXCLUDED) || root.closest(CONTROL_SELECTOR) || root.querySelector(CONTROL_SELECTOR)) continue
    if (root.querySelector('img, picture, video, article, h2 a, h3 a, h4 a, h5 a, h6 a')) continue
    const anchors = [...root.querySelectorAll('a[href]')]
    if (anchors.length < 2) continue
    // A container with multiple labelled dimensions is not one choice group.
    const labels = [...root.querySelectorAll('dt, legend, label, strong')].map(node => labelSemantic(compactText(node))).filter(Boolean)
    if (new Set(labels).size > 1) continue
    const entries = anchors.flatMap(node => {
      if (node.closest(EXCLUDED) || isDisabled(node) || isPaginationNode(node, paginationCache)) return []
      const title = clean(node.getAttribute('aria-label') || node.getAttribute('title') || node.textContent)
      const url = siteUrl(node.getAttribute('href') || '', baseUrl)
      if (!url || !title || title.length > 100 || !isCatalogContentUrl(url) || isUtilityPath(url) || isPlaybackControlTitle(title)) return []
      return [{ node, title, url }]
    })
    if (entries.length < 2) continue
    const label = rowLabel(root)
    const family = varyingField(entries.map(item => item.url), engine)
    const labelled = labelSemantic(label)
    const sortContainer = /(?:^|[\s_-])sort(?:ing|[-_]?list)?(?:$|[\s_-])/i.test(root.className || '')
    const semantic = labelled ?? family.semantic ?? (sortContainer ? 'sort' : undefined)
    if (!semantic) continue
    // Unlabelled groups require both a known varying field and a tight repeated row.
    if (!labelled && !sortContainer && (!family.semantic || root.querySelector('dl, fieldset, table'))) continue
    const nav = root.closest('nav, [role="navigation"]')
    const declaredFacet = FILTER_CLASS.test(root.className || '') || /^(?:filters?|facets?|筛选|过滤)$/i.test(nav?.getAttribute('aria-label') || '')
    if (nav && !declaredFacet && !sortContainer) continue
    const unique = [...new Map(entries.map(item => [item.url, item])).values()]
    const signature = semantic + ':' + unique.map(item => item.url).join('|')
    if (signatures.has(signature)) continue
    signatures.add(signature)
    const explicitSelected = unique.some(item => isSelected(item.node))
    const control: CatalogControl = {
      id: `links-${controls.length}-${semantic}`,
      title: label ? label.replace(/[:：]\s*$/, '') : SEMANTIC_TITLES[semantic],
      semantic, kind: semantic === 'sort' ? 'sort' : 'filter', selection: 'single',
      choices: unique.slice(0, MAX_CHOICES).map((item, index) => ({
        id: `link-${controls.length}-${index}`, title: item.title,
        selected: explicitSelected ? isSelected(item.node) : urlKey(item.url) === urlKey(pageUrl),
        request: { method: 'GET', url: item.url },
      })),
      evidence: { confidence: labelled || sortContainer ? 'direct' : 'corroborated', signals: ['observed-links', ...(labelled ? ['group-label'] : []), ...(family.field ? ['url-field-family'] : []), ...(sortContainer ? ['sort-container'] : [])] },
    }
    controls.push(control)
    root.setAttribute(CONTROL_ATTRIBUTE, '')
    if (unique.length > MAX_CHOICES) issues.push({ kind: control.kind === 'sort' ? 'filter' : control.kind, reason: 'budget', title: control.title })
  }
  // A URL-valued select is a declared navigation map, not arbitrary JavaScript.
  for (const select of [...document.querySelectorAll('select:not([multiple])')].slice(0, MAX_CONTROLS)) {
    if (select.closest(EXCLUDED) || select.closest(CONTROL_SELECTOR) || isDisabled(select) || select.hasAttribute('form')) continue
    const role = fieldRole(select.getAttribute('name') || '', engine)
    const label = select.getAttribute('aria-label') || rowLabel(select.parentElement ?? select)
    const semantic = labelSemantic(label) ?? (role && role !== 'search' && role !== 'pagination' ? role : undefined)
    if (!semantic) continue
    const choices = [...select.querySelectorAll('option')].slice(0, MAX_CHOICES).flatMap((option, index) => {
      const raw = option.getAttribute('value') || ''
      if (isDisabled(option) || option.closest('optgroup[disabled]') || !/^(?:https?:\/\/|\/|\.{1,2}\/|\?)/i.test(raw)) return []
      const url = siteUrl(raw, baseUrl)
      if (!url || !isCatalogContentUrl(url) || isUtilityPath(url)) return []
      return [{ id: `url-select-${controls.length}-${index}`, title: clean(option.textContent).slice(0, 100), selected: option.hasAttribute('selected') || urlKey(url) === urlKey(pageUrl), request: { url, method: 'GET' as const } }]
    })
    if (!choices.length || controls.length >= MAX_CONTROLS) continue
    controls.push({ id: `url-select-${controls.length}`, semantic, title: label || SEMANTIC_TITLES[semantic], kind: semantic === 'sort' ? 'sort' : 'filter', selection: 'single', choices, evidence: { confidence: 'direct', signals: ['url-valued-options', 'field-or-label'] } })
    select.setAttribute(CONTROL_ATTRIBUTE, '')
  }
  for (const root of [...document.querySelectorAll('div, dl, fieldset, [role="group"]')].slice(0, 2000)) {
    if (root.closest(EXCLUDED) || root.closest(CONTROL_SELECTOR) || !FILTER_CLASS.test(root.className || '')) continue
    if (labelSemantic(rowLabel(root)) && root.querySelectorAll('button[onclick], [role="button"][onclick]').length >= 2) {
      issues.push({ kind: 'filter', reason: 'javascript-control', title: rowLabel(root) })
      root.setAttribute(CONTROL_ATTRIBUTE, '')
    }
  }
  return { controls, issues }
}
