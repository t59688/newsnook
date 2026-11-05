/** User-installed source code stays local to this device and is never synced to NewsNook Cloud. */
export interface UserScript {
  id: string
  name: string
  version: string
  source: string
  enabled: boolean
  matches: string[]
  includes: string[]
  excludes: string[]
  excludeMatches: string[]
  grants: string[]
  connects: string[]
  requires: string[]
  runAt: 'document-start' | 'document-end' | 'document-idle'
  noFrames: boolean
  createdAt: number
}

const KEY = 'newsnook:userscripts:v1'
const MARKER = /^\s*\/\/\s*@([^\s]+)\s*(.*)$/
export const MAX_USER_SCRIPT_BYTES = 400_000
const MAX_LEGACY_SCRIPT_CHARACTERS = 400_000
function metadata(code: string): Map<string, string[]> {
  const meta = new Map<string, string[]>()
  let active = false
  let ended = false
  for (const line of code.split(/\r?\n/)) {
    if (/^\s*\/\/\s*==UserScript==\s*$/.test(line)) { active = true; continue }
    if (/^\s*\/\/\s*==\/UserScript==\s*$/.test(line)) { ended = true; break }
    if (!active) continue
    const match = MARKER.exec(line)
    if (match) meta.set(match[1], [...(meta.get(match[1]) ?? []), match[2].trim()])
  }
  if (!active || !ended) throw new Error('缺少完整的 UserScript 元信息头')
  return meta
}
function single(meta: Map<string, string[]>, key: string, fallback = ''): string {
  return meta.get(key)?.[0] || fallback
}
export function installUserScript(source: string, old?: Pick<UserScript, 'id' | 'enabled' | 'createdAt'>): UserScript {
  if (source.length === 0 || new TextEncoder().encode(source).byteLength > MAX_USER_SCRIPT_BYTES) throw new Error('脚本大小不得超过 400 KB')
  return parseUserScript(source, old)
}
function parseUserScript(source: string, old?: Pick<UserScript, 'id' | 'enabled' | 'createdAt'>): UserScript {
  const meta = metadata(source)
  const name = single(meta, 'name')
  if (!name) throw new Error('脚本缺少 @name')
  const matches = (meta.get('match') ?? []).filter(Boolean)
  const includes = (meta.get('include') ?? []).filter(Boolean)
  if (!matches.length && !includes.length) throw new Error('请添加 @match 或 @include 以限定网站')
  const runAt = single(meta, 'run-at', 'document-end')
  const runAtSafe = runAt === 'document-start' || runAt === 'document-end' || runAt === 'document-idle' ? runAt : 'document-end'
  return {
    id: old?.id ?? `us-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`,
    name, version: single(meta, 'version', '1.0'), source, enabled: old?.enabled ?? true,
    matches, includes, excludes: meta.get('exclude') ?? [], excludeMatches: meta.get('exclude-match') ?? [],
    grants: meta.get('grant') ?? [], connects: meta.get('connect') ?? [], requires: meta.get('require') ?? [],
    runAt: runAtSafe, noFrames: meta.has('noframes'), createdAt: old?.createdAt ?? Date.now(),
  }
}
/** Re-imports use the userscript name/namespace identity; explicit edits keep their existing identity. */
export function prepareUserScriptInstall(source: string, scripts: readonly UserScript[], editing?: UserScript): UserScript {
  const editedInstallation = editing ? scripts.find(script => script.id === editing.id) : undefined
  if (source.length > MAX_LEGACY_SCRIPT_CHARACTERS) {
    throw new Error(editedInstallation ? '已有脚本不能超过 400000 个字符' : '脚本大小不得超过 400 KB')
  }
  // Only the installed collection grants the historical character allowance.
  // An editor for a deleted script must pass the new-install byte limit again.
  if (editedInstallation) return parseUserScript(source, editedInstallation)
  const candidate = parseUserScript(source)
  const namespace = single(metadata(source), 'namespace')
  const existing = scripts.find(script => script.name === candidate.name && single(metadata(script.source), 'namespace') === namespace)
  return existing ? parseUserScript(source, existing) : installUserScript(source)
}
function wildcard(p: string): RegExp {
  const escaped = p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
  return new RegExp(`^${escaped}$`, 'i')
}
function matchPattern(pattern: string, url: URL): boolean {
  const m = /^(\*|https?|file):\/\/(\*|\*\.[^/]+|[^/]+)(\/.*)$/.exec(pattern)
  if (!m) return false
  if (m[1] !== '*' && m[1] !== url.protocol.slice(0, -1)) return false
  if (m[1] === '*' && !['http:', 'https:'].includes(url.protocol)) return false
  const hostPattern = m[2]
  if (hostPattern !== '*' && !(
    hostPattern.startsWith('*.') ? (url.hostname === hostPattern.slice(2) || url.hostname.endsWith(`.${hostPattern.slice(2)}`)) : url.hostname === hostPattern
  )) return false
  return wildcard(m[3]).test(`${url.pathname}${url.search}${url.hash}`)
}
function includePattern(pattern: string, url: URL): boolean {
  if (pattern.startsWith('/') && pattern.endsWith('/') && pattern.length > 2) {
    try { return new RegExp(pattern.slice(1, -1)).test(url.href) } catch { return false }
  }
  return wildcard(pattern).test(url.href)
}
export function matchesUserScript(script: UserScript, address: string): boolean {
  let url: URL
  try { url = new URL(address) } catch { return false }
  if (!['https:', 'http:'].includes(url.protocol)) return false
  if (!script.matches.some((m) => matchPattern(m, url)) && !script.includes.some((m) => includePattern(m, url))) return false
  if (script.excludeMatches.some((m) => matchPattern(m, url))) return false
  return !script.excludes.some((m) => includePattern(m, url))
}
export function loadUserScripts(): UserScript[] {
  try {
    const raw = localStorage.getItem(KEY)
    const result: unknown = raw && JSON.parse(raw)
    if (!Array.isArray(result)) return []
    const scripts: UserScript[] = []
    const seen = new Set<string>()
    for (const item of result) {
      if (!item || typeof item.id !== 'string' || !item.id || seen.has(item.id) || typeof item.source !== 'string' || item.source.length > MAX_LEGACY_SCRIPT_CHARACTERS || typeof item.enabled !== 'boolean') continue
      try {
        // Earlier versions counted UTF-16 characters. Keep those installed sources readable.
        const script = parseUserScript(item.source, {
          id: item.id,
          enabled: item.enabled,
          createdAt: typeof item.createdAt === 'number' && Number.isFinite(item.createdAt) ? item.createdAt : 0,
        })
        scripts.push(script)
        seen.add(script.id)
      } catch { /* Invalid entries are isolated; valid local scripts stay available. */ }
      if (scripts.length === 128) break
    }
    return scripts
  } catch { return [] }
}
export function saveUserScripts(items: UserScript[]): void {
  if (items.length > 128) throw new Error('最多安装 128 个脚本')
  try { localStorage.setItem(KEY, JSON.stringify(items)) }
  catch { throw new Error('脚本保存失败，请检查本机存储空间后重试') }
}
