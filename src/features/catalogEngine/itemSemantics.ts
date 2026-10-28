export type CatalogEntityType = 'article' | 'video' | 'person' | 'collection' | 'unknown'
export interface CatalogItemMetadata { entityType: CatalogEntityType; rank?: number; score?: number }

export function isPersonDocumentUrl(value: string): boolean {
  try { return /\/(?:actors?|people|persons?|stars?|authors?)(?:\/|[._-])/i.test(new URL(value).pathname) } catch { return false }
}
export function positiveRank(value: unknown): number | undefined {
  const text = String(value ?? '').trim()
  if (!/^(?:#|第)?\d{1,6}(?:[.)、]|名|位)?$/.test(text)) return undefined
  const rank = Number(text.match(/\d+/)?.[0])
  return Number.isSafeInteger(rank) && rank > 0 ? rank : undefined
}
