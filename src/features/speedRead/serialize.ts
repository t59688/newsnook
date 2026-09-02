const THINKING_START = '<!-- speed-read-thinking-start -->'
const THINKING_END = '<!-- speed-read-thinking-end -->'

export interface SpeedReadContent {
  thinking: string
  body: string
}

export function serializeSpeedRead(content: SpeedReadContent): string {
  const body = content.body.trim()
  const thinking = content.thinking.trim()
  if (!thinking) return body
  if (!body) return `${THINKING_START}\n${thinking}\n${THINKING_END}`
  return `${THINKING_START}\n${thinking}\n${THINKING_END}\n\n${body}`
}

export function parseSpeedReadStored(raw: string): SpeedReadContent {
  const value = raw.trim()
  if (!value) return { thinking: '', body: '' }

  const start = value.indexOf(THINKING_START)
  const end = value.indexOf(THINKING_END)
  if (start === -1 || end === -1 || end < start) {
    return { thinking: '', body: value }
  }

  const thinking = value
    .slice(start + THINKING_START.length, end)
    .replace(/^\n/, '')
    .trim()
  const body = value.slice(end + THINKING_END.length).replace(/^\n+/, '').trim()
  return { thinking, body }
}

/** 分享图 / 复制 / 导出：只要正文速读，不含思考过程 */
export function speedReadBodyForExport(raw: string): string {
  return parseSpeedReadStored(raw).body
}
