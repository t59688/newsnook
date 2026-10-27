import { isCatalogContentUrl, isPlaybackControlTitle } from '../catalogEngine/linkRoles'
import { isUtilityPath } from '../catalogEngine/normalize'
import { isDisabled, siteUrl } from './context'
import { isPaginationControlLabel, isPaginationNode } from './navigationRoles'
import type { CatalogLink, CatalogNavigation, CatalogNavigationGroup } from './types'

const PRIMARY = 'nav a[href], [role="navigation"] a[href], .navbar a[href], .menu a[href], .panel-heading h3 a[href], .categories a[href], .category-list a[href]'
const SECONDARY = '.box-title-nav, .subnav, .sub-nav, .secondary-nav, .section-nav, .sub-menu, .submenu, [data-navigation="secondary"]'
const EXCLUDED = 'footer, aside, .sidebar, .panel-aside, .breadcrumbs, .breadcrumb, [aria-label="breadcrumb"], .sort, .sorting, .sort-list, [data-sort], .filter, .filters, .screen-list, .filter-list, .playlist, .play-list, .player-controls'

function linkFor(node: Element, baseUrl: string): CatalogLink | undefined {
  const url = siteUrl(node.getAttribute('href') || '', baseUrl)
  const title = (node.getAttribute('aria-label') || node.getAttribute('title') || node.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 100)
  if (!url || !title || isDisabled(node) || isUtilityPath(url) || !isCatalogContentUrl(url)
    || isPlaybackControlTitle(title) || isPaginationNode(node) || isPaginationControlLabel(title)
    || /^(?:首页|主页|home|index|更多|more|登录|注册|搜索)$/i.test(title)
    || /search|vod-search|vodsearch|\/so(?:[/?]|$)/i.test(url)) return undefined
  const parsed = new URL(url)
  if (parsed.pathname === '/' && !parsed.search) return undefined
  return { title, url }
}

function active(node: Element): boolean {
  return node.getAttribute('aria-current') === 'page' || node.getAttribute('aria-selected') === 'true'
    || node.matches('.active, .current') || Boolean(node.parentElement?.matches('li.active, li.current'))
}

/** The nearest enclosing menu item owns nested lists, regardless of CSS framework. */
function menuParent(node: Element): Element | undefined {
  const list = node.closest('ul, ol')
  const item = list?.parentElement?.closest('li')
  if (!item || item === node.closest('li')) return undefined
  return [...item.children].find(child => child.matches('a[href]'))
}

function sectionFor(node: Element): Element | null {
  const explicit = node.closest(SECONDARY)
  if (explicit) return explicit
  const nav = node.closest('nav, [role="navigation"]')
  if (!nav || nav.closest('header, .navbar, .menu')) return null
  const name = nav.getAttribute('aria-label') || ''
  return /sub|section|context|二级|子栏目|子分类|栏目导航/i.test(name) ? nav : null
}

function descendantUrl(root: string, pageUrl: string): boolean {
  const parent = new URL(root), page = new URL(pageUrl)
  return parent.origin === page.origin && !parent.search && parent.pathname !== '/'
    && parent.pathname.endsWith('/') && page.pathname.startsWith(parent.pathname)
}

export interface DiscoveredCatalogNavigation extends CatalogNavigation {
  primary: CatalogLink[]
}

/** Page-local navigation: primary destinations stay distinct from scoped child menus. */
export function discoverCatalogNavigation(document: Document, baseUrl: string, pageUrl: string): DiscoveredCatalogNavigation {
  const primary = new Map<string, CatalogLink>()
  const childNodes = new Map<Element, Element[]>()
  const owners = new Map<Element, CatalogLink>()
  const selectedAncestors = new Set<string>()
  let activePrimaryUrl: string | undefined
  const addChild = (container: Element, node: Element, owner?: CatalogLink) => {
    const nodes = childNodes.get(container) ?? []
    if (!nodes.includes(node)) nodes.push(node)
    childNodes.set(container, nodes)
    if (owner) owners.set(container, owner)
  }
  for (const node of document.querySelectorAll(PRIMARY)) {
    if (node.closest(EXCLUDED)) continue
    const link = linkFor(node, baseUrl)
    if (!link) continue
    const section = sectionFor(node)
    const ancestor = menuParent(node)
    const owner = ancestor && linkFor(ancestor, baseUrl)
    if (section || owner) {
      // The nearest list owns its direct children, even inside an outer submenu.
      addChild(owner ? node.closest('ul, ol')! : section!, node, owner)
      if (active(node) || link.url === pageUrl) {
        for (let parent = ancestor, depth = 0; parent && depth < 8; parent = menuParent(parent), depth++) {
          const parentLink = linkFor(parent, baseUrl)
          if (parentLink) selectedAncestors.add(parentLink.url)
        }
      }
      continue
    }
    primary.set(link.url, link)
    if (active(node) || link.url === pageUrl) activePrimaryUrl = link.url
  }
  const selectedRoot = [...primary.keys()].find(url => selectedAncestors.has(url))
  if (selectedRoot) activePrimaryUrl = selectedRoot
  if (!activePrimaryUrl) {
    activePrimaryUrl = [...primary.keys()].filter(url => descendantUrl(url, pageUrl))
      .sort((left, right) => right.length - left.length)[0]
  }
  for (const container of document.querySelectorAll(SECONDARY)) {
    if (container.closest(EXCLUDED)) continue
    for (const node of container.querySelectorAll('a[href]')) {
      if (sectionFor(node) !== container || node.closest(EXCLUDED) || menuParent(node)) continue
      addChild(container, node)
    }
  }
  const groups: CatalogNavigationGroup[] = []
  const seen = new Set<string>()
  for (const [container, nodes] of childNodes) {
    const owner = owners.get(container)
    // Nested site menus belong to their selected parent, not to every page.
    if (owner && owner.url !== activePrimaryUrl && !selectedAncestors.has(owner.url) && !descendantUrl(owner.url, pageUrl)) continue
    const links = new Map<string, CatalogLink>()
    let activeUrl: string | undefined
    for (const node of nodes) {
      const link = linkFor(node, baseUrl)
      if (!link) continue
      links.set(link.url, link)
      if (active(node)) activeUrl = link.url
    }
    if (links.has(pageUrl)) activeUrl = pageUrl
    if (!links.size || ![...links.keys()].some(url => url !== pageUrl)) continue
    const key = [...links.keys()].join('\n')
    if (seen.has(key)) continue
    seen.add(key)
    const parentUrl = owner?.url ?? activePrimaryUrl
    const title = (container.getAttribute('aria-label') || owner?.title || (parentUrl && primary.get(parentUrl)?.title) || '子栏目').trim().slice(0, 50)
    groups.push({ title, parentUrl, links: [...links.values()].slice(0, 100), activeUrl })
    if (groups.length >= 6) break
  }
  return { primary: [...primary.values()].slice(0, 100), activePrimaryUrl, groups }
}
