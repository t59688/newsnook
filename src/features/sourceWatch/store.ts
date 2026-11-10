import type { Article } from '../../lib/types'

export type WatchMode = 'instant' | 'digest' | 'inbox'
export interface WatchRule { sourceId: string; mode: WatchMode; enabled: boolean }
export interface WatchEvent { key: string; sourceId: string; article: Article; discoveredAt: number; read: boolean }
export interface WatchState { rules: WatchRule[]; events: WatchEvent[]; cursors: Record<string, string[]>; lastChecked: Record<string, number>; intervalMinutes: number; quietHours: boolean; wifiOnly: boolean }
const KEY = 'newsnook:source-watch:v1'
const DEFAULT: WatchState = { rules: [], events: [], cursors: {}, lastChecked: {}, intervalMinutes: 60, quietHours: true, wifiOnly: false }
export function loadWatchState(): WatchState {
  try {
    const data = JSON.parse(localStorage.getItem(KEY) || 'null') as Partial<WatchState> | null
    return data && Array.isArray(data.rules) ? { ...DEFAULT, ...data, rules: data.rules.filter(rule => typeof rule.sourceId === 'string' && ['instant','digest','inbox'].includes(rule.mode)), events: Array.isArray(data.events) ? data.events : [], cursors: data.cursors || {}, lastChecked: data.lastChecked || {} } : { ...DEFAULT }
  } catch { return { ...DEFAULT } }
}
export function saveWatchState(state: WatchState): void {
  localStorage.setItem(KEY, JSON.stringify({ ...state, events: state.events.slice(0, 300) }))
  window.dispatchEvent(new Event('newsnook:source-watch-changed'))
}
export function watchArticleKey(article: Article): string {
  return article.sourceId + ':' + (article.originUrl || article.id).trim().replace(/#.*$/, '').replace(/\/$/, '')
}
export function reconcileWatchArticles(state: WatchState, sourceId: string, articles: Article[], timestamp: number): { next: WatchState; added: WatchEvent[] } {
  const known = state.cursors[sourceId]
  const items = articles.slice(0, 50)
  const keys = [...new Set(items.map(watchArticleKey))]
  const old = new Set(known || [])
  // First successful scan only establishes a baseline. It must not flood notifications.
  const existing = new Set(state.events.map(item => item.key))
  const added = known ? items.filter(a => !old.has(watchArticleKey(a)) && !existing.has(watchArticleKey(a))).slice(0, 10).map(a => ({ key: watchArticleKey(a), sourceId, article: a, discoveredAt: timestamp, read: false })) : []
  const next: WatchState = { ...state, events: [...added, ...state.events].slice(0, 300), cursors: { ...state.cursors, [sourceId]: [...new Set([...keys, ...(known || [])])].slice(0, 150) }, lastChecked: { ...state.lastChecked, [sourceId]: timestamp } }
  return { next, added }
}
