import type {
  LinuxDoCategory,
  LinuxDoTopicOrder,
  LinuxDoTopicPage,
  LinuxDoTopicSummary,
} from '../types'

export type LinuxDoDiscoveryScope =
  | { kind: 'category'; category: LinuxDoCategory }
  | { kind: 'tag'; name: string }

interface DiscoveryScopeApi {
  category: (
    slug: string,
    id: number,
    page?: number,
    order?: LinuxDoTopicOrder,
  ) => Promise<LinuxDoTopicPage>
  tag: (
    name: string,
    page?: number,
    order?: LinuxDoTopicOrder,
  ) => Promise<LinuxDoTopicPage>
}

export function discoveryScopeKey(scope: LinuxDoDiscoveryScope): string {
  return scope.kind === 'category' ? 'category:' + scope.category.id : 'tag:' + scope.name
}

export function loadDiscoveryScope(
  api: DiscoveryScopeApi,
  scope: LinuxDoDiscoveryScope,
  page = 0,
  order: LinuxDoTopicOrder = 'activity',
): Promise<LinuxDoTopicPage> {
  return scope.kind === 'category'
    ? api.category(scope.category.slug, scope.category.id, page, order)
    : api.tag(scope.name, page, order)
}

export function mergeDiscoveryTopics(
  current: LinuxDoTopicSummary[],
  incoming: LinuxDoTopicSummary[],
): LinuxDoTopicSummary[] {
  if (!current.length) return incoming
  const seen = new Set(current.map((topic) => topic.id))
  return current.concat(incoming.filter((topic) => !seen.has(topic.id)))
}
