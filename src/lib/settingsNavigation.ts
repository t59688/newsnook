import type { CategoryId } from '../sources/categories'

type CategoryReturnTo = 'presets' | 'me'

export type SettingsRoute =
  | { name: 'presets' }
  | { name: 'categories'; returnTo?: CategoryReturnTo }
  | { name: 'category-sources'; categoryId: CategoryId; returnTo?: CategoryReturnTo }
  | { name: 'category-edit'; categoryId?: CategoryId; returnTo?: CategoryReturnTo }
  | { name: 'custom-sources' }
  | { name: 'feed-store'; returnTo?: 'custom-sources' }
  | { name: 'channels'; returnTo?: CategoryReturnTo }
  | { name: 'typography' }
  | { name: 'appearance' }
  | { name: 'custom-scheme' }
  | { name: 'storage' }
  | { name: 'translation' }
  | { name: 'read-aloud' }
  | { name: 'ai'; returnTo?: 'translation' | 'read-aloud' }
  | { name: 'proxy' }
  | { name: 'later' }
  | { name: 'history' }
  | { name: 'local-search' }
  | { name: 'account-sync' }
  | { name: 'about' }
  | { name: 'changelog' }
  | { name: 'licenses' }

/** The header, swipe and Android back actions must resolve the same parent. */
export function settingsBackRoute(route: SettingsRoute): SettingsRoute | null {
  switch (route.name) {
    case 'category-sources':
    case 'category-edit':
    case 'channels':
      return { name: 'categories', returnTo: route.returnTo }
    case 'categories':
      return route.returnTo === 'presets' ? { name: 'presets' } : null
    case 'changelog':
    case 'licenses':
      return { name: 'about' }
    case 'custom-scheme':
      return { name: 'appearance' }
    case 'feed-store':
    case 'ai':
      return route.returnTo ? { name: route.returnTo } : null
    default:
      return null
  }
}
