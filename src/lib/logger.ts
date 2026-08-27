/**
 * 统一日志：全局级别 + 分模块开关。
 *
 * 运行时覆盖（真机调试）：
 * - localStorage `newsnook:log`：`{"level":"debug","namespaces":{"http":true,"sniffer":false}}`
 * - URL：`?log=debug` 或 `?log=debug&logNs=http,sniffer`
 * - 控制台：`window.__newsnookLog.setLevel('debug')` / `.enable('http')` / `.disable('sniffer')`
 */

export type LogLevel = 'silent' | 'error' | 'warn' | 'info' | 'debug' | 'trace'

export type LogNamespace =
  | 'account'
  | 'app'
  | 'boot'
  | 'catalog'
  | 'feed'
  | 'http'
  | 'proxy'
  | 'reader'
  | 'sniffer'
  | 'storage'
  | 'sync'
  | 'translation'

export interface LogConfig {
  level: LogLevel
  /** 未列出的命名空间默认启用；显式 `false` 可关闭单个模块 */
  namespaces: Partial<Record<LogNamespace, boolean>>
}

export interface Logger {
  error: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
  info: (...args: unknown[]) => void
  debug: (...args: unknown[]) => void
  trace: (...args: unknown[]) => void
}

export interface LogController {
  getConfig: () => LogConfig
  setConfig: (patch: Partial<LogConfig>) => LogConfig
  setLevel: (level: LogLevel) => LogConfig
  enable: (namespace: LogNamespace) => LogConfig
  disable: (namespace: LogNamespace) => LogConfig
  reset: () => LogConfig
}

const LOG_STORAGE_KEY = 'newsnook:log'

const LEVEL_RANK: Record<LogLevel, number> = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
  trace: 5,
}

const ALL_NAMESPACES: LogNamespace[] = [
  'account',
  'app',
  'boot',
  'catalog',
  'feed',
  'http',
  'proxy',
  'reader',
  'sniffer',
  'storage',
  'sync',
  'translation',
]

function defaultLevel(): LogLevel {
  const env = (import.meta as ImportMeta & { env?: { DEV?: boolean } }).env
  return env?.DEV ? 'debug' : 'warn'
}

function defaultConfig(): LogConfig {
  return { level: defaultLevel(), namespaces: {} }
}

function isLogLevel(value: unknown): value is LogLevel {
  return (
    value === 'silent' ||
    value === 'error' ||
    value === 'warn' ||
    value === 'info' ||
    value === 'debug' ||
    value === 'trace'
  )
}

function isLogNamespace(value: string): value is LogNamespace {
  return (ALL_NAMESPACES as string[]).includes(value)
}

function parseNamespaces(raw: unknown): Partial<Record<LogNamespace, boolean>> {
  if (!raw || typeof raw !== 'object') return {}
  const result: Partial<Record<LogNamespace, boolean>> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isLogNamespace(key) || typeof value !== 'boolean') continue
    result[key] = value
  }
  return result
}

function parseStoredConfig(raw: string | null): Partial<LogConfig> | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as { level?: unknown; namespaces?: unknown }
    const patch: Partial<LogConfig> = {}
    if (isLogLevel(parsed.level)) patch.level = parsed.level
    const namespaces = parseNamespaces(parsed.namespaces)
    if (Object.keys(namespaces).length) patch.namespaces = namespaces
    return Object.keys(patch).length ? patch : null
  } catch {
    return null
  }
}

function parseUrlConfig(): Partial<LogConfig> | null {
  if (typeof window === 'undefined') return null
  try {
    const params = new URLSearchParams(window.location.search)
    const patch: Partial<LogConfig> = {}
    const level = params.get('log')
    if (level && isLogLevel(level)) patch.level = level
    const namespacesParam = params.get('logNs')
    if (namespacesParam) {
      const namespaces: Partial<Record<LogNamespace, boolean>> = {}
      for (const token of namespacesParam.split(',')) {
        const trimmed = token.trim()
        if (!trimmed) continue
        if (trimmed.startsWith('-') && isLogNamespace(trimmed.slice(1))) {
          namespaces[trimmed.slice(1) as LogNamespace] = false
          continue
        }
        if (trimmed.startsWith('+') && isLogNamespace(trimmed.slice(1))) {
          namespaces[trimmed.slice(1) as LogNamespace] = true
          continue
        }
        if (isLogNamespace(trimmed)) namespaces[trimmed] = true
      }
      if (Object.keys(namespaces).length) patch.namespaces = namespaces
    }
    return Object.keys(patch).length ? patch : null
  } catch {
    return null
  }
}

function loadInitialConfig(): LogConfig {
  const config = defaultConfig()
  const stored =
    typeof localStorage !== 'undefined' ? parseStoredConfig(localStorage.getItem(LOG_STORAGE_KEY)) : null
  if (stored?.level) config.level = stored.level
  if (stored?.namespaces) config.namespaces = { ...config.namespaces, ...stored.namespaces }
  const fromUrl = parseUrlConfig()
  if (fromUrl?.level) config.level = fromUrl.level
  if (fromUrl?.namespaces) config.namespaces = { ...config.namespaces, ...fromUrl.namespaces }
  return config
}

let activeConfig: LogConfig = loadInitialConfig()

function persistConfig(config: LogConfig): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(LOG_STORAGE_KEY, JSON.stringify(config))
  } catch {
    // 配额或隐私模式：仅内存生效
  }
}

function namespaceEnabled(config: LogConfig, namespace: LogNamespace): boolean {
  return config.namespaces[namespace] !== false
}

function shouldEmit(config: LogConfig, level: LogLevel, namespace: LogNamespace): boolean {
  if (!namespaceEnabled(config, namespace)) return false
  return LEVEL_RANK[level] <= LEVEL_RANK[config.level]
}

function write(level: LogLevel, namespace: LogNamespace, args: unknown[]): void {
  if (!shouldEmit(activeConfig, level, namespace)) return
  const prefix = `[${namespace}]`
  switch (level) {
    case 'error':
      console.error(prefix, ...args)
      break
    case 'warn':
      console.warn(prefix, ...args)
      break
    case 'info':
      console.info(prefix, ...args)
      break
    case 'debug':
      console.debug(prefix, ...args)
      break
    case 'trace':
      console.log(prefix, ...args)
      break
    default:
      break
  }
}

export function createLogger(namespace: LogNamespace): Logger {
  return {
    error: (...args) => write('error', namespace, args),
    warn: (...args) => write('warn', namespace, args),
    info: (...args) => write('info', namespace, args),
    debug: (...args) => write('debug', namespace, args),
    trace: (...args) => write('trace', namespace, args),
  }
}

function mergeConfig(base: LogConfig, patch: Partial<LogConfig>): LogConfig {
  return {
    level: patch.level ?? base.level,
    namespaces: patch.namespaces ? { ...base.namespaces, ...patch.namespaces } : { ...base.namespaces },
  }
}

export const logController: LogController = {
  getConfig: () => ({ ...activeConfig, namespaces: { ...activeConfig.namespaces } }),
  setConfig(patch) {
    activeConfig = mergeConfig(activeConfig, patch)
    persistConfig(activeConfig)
    return logController.getConfig()
  },
  setLevel(level) {
    return logController.setConfig({ level })
  },
  enable(namespace) {
    return logController.setConfig({ namespaces: { [namespace]: true } })
  },
  disable(namespace) {
    return logController.setConfig({ namespaces: { [namespace]: false } })
  },
  reset() {
    activeConfig = defaultConfig()
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.removeItem(LOG_STORAGE_KEY)
      } catch {
        // ignore
      }
    }
    return logController.getConfig()
  },
}

/** 预置命名空间 logger，业务侧优先使用这些而非直接 console */
export const log = {
  controller: logController,
  account: createLogger('account'),
  app: createLogger('app'),
  boot: createLogger('boot'),
  catalog: createLogger('catalog'),
  feed: createLogger('feed'),
  http: createLogger('http'),
  proxy: createLogger('proxy'),
  reader: createLogger('reader'),
  sniffer: createLogger('sniffer'),
  storage: createLogger('storage'),
  sync: createLogger('sync'),
  translation: createLogger('translation'),
} as const

declare global {
  interface Window {
    __newsnookLog?: LogController
  }
}

if (typeof window !== 'undefined') {
  window.__newsnookLog = logController
}
