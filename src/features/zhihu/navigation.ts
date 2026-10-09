import type { RouteAction, RouteFrame, ZhihuRoute, ZhihuSearchState } from './types'

export function zhihuRouteKey(route: ZhihuRoute): string {
  switch (route.screen) {
    case 'feed':
      return `feed:${route.mode}`
    case 'entity':
      return `entity:${route.ref.kind}:${route.ref.id}`
    case 'search':
      return `search:${route.restrictedMemberHashId ?? 'all'}:${route.query}`
    case 'editor':
      return `editor:${route.localDraftId}`
    case 'conversation':
      return `conversation:${route.peerId}`
    default:
      return route.screen
  }
}

/**
 * Feature-local navigation reducer. No browser history/router dependency.
 *
 * `push` 同目标采用 replace 语义，避免双击/重复站内链接制造无限重复栈；不同目标才真正 push。
 * `replace` 显式替换当前页，`back` 在空栈/单根栈上保持不变，由宿主决定是否退出工作区。
 */
export function reduceRoutes(frames: RouteFrame[], action: RouteAction): RouteFrame[] {
  switch (action.type) {
    case 'reset':
      return [action.frame]
    case 'replace':
      return frames.length ? [...frames.slice(0, -1), action.frame] : [action.frame]
    case 'push': {
      const current = frames.at(-1)
      if (current && zhihuRouteKey(current.route) === zhihuRouteKey(action.frame.route)) {
        return [...frames.slice(0, -1), action.frame]
      }
      return [...frames, action.frame]
    }
    case 'back':
      return frames.length > 1 ? frames.slice(0, -1) : frames
  }
}

export function createZhihuRootFrame(mode: 'recommended' | 'hot' | 'following' = 'recommended'): RouteFrame {
  return { route: { screen: 'feed', mode }, scrollTop: 0 }
}

export function updateCurrentSearchState(frames: RouteFrame[], searchState: ZhihuSearchState): RouteFrame[] {
  const current = frames.at(-1)
  if (!current || current.route.screen !== 'search') return frames
  return [...frames.slice(0, -1), { ...current, searchState }]
}
