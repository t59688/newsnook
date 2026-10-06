const HTTP_PROTOCOLS = new Set(['http:', 'https:'])

export function validateFeedUrl(raw: string): string {
  const value = raw.trim()
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error('订阅地址不是有效网址')
  }
  if (!HTTP_PROTOCOLS.has(parsed.protocol)) {
    throw new Error('订阅地址仅支持 HTTP 或 HTTPS')
  }
  if (parsed.username || parsed.password) {
    throw new Error('订阅地址不能包含用户名或密码')
  }
  parsed.hash = ''
  return parsed.toString()
}
