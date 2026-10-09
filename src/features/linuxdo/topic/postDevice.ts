export function normalizeDeviceModel(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const model = value.replace(/[\p{Cc}\u202a-\u202e\u2066-\u2069]/gu, '').trim().slice(0, 80)
  return model && !/^(unknown|null|undefined|K)$/i.test(model) ? model : undefined
}
