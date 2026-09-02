import { Capacitor, CapacitorHttp } from '@capacitor/core'

import { extractOpenAiChatContent } from '../translation/openai'
import { awaitWithAbort } from './abortable'
import { cleanMarkdown } from './markdown'

export interface ChatMessage {
  role: 'system' | 'user'
  content: string
}

export interface StreamChatDelta {
  content: string
  reasoning: string
}

export interface StreamChatPartial {
  thinking: string
  body: string
}

const STREAM_PARTIAL_INTERVAL_MS = 80

export interface StreamUpdateScheduler {
  schedule: () => void
  flush: () => void
  cancel: () => void
}

/** Coalesce bursty token callbacks without dropping any accumulated text. */
export function createStreamUpdateScheduler(
  run: () => void,
  intervalMs = STREAM_PARTIAL_INTERVAL_MS,
): StreamUpdateScheduler {
  const interval = Math.max(0, intervalMs)
  let lastRunAt = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  let pending = false

  const runPending = () => {
    if (!pending) return
    pending = false
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    lastRunAt = Date.now()
    run()
  }

  return {
    schedule: () => {
      pending = true
      const now = Date.now()
      const elapsed = lastRunAt ? now - lastRunAt : interval
      if (elapsed >= interval) {
        runPending()
        return
      }
      if (timer) return
      timer = setTimeout(runPending, Math.max(interval - elapsed, 0))
    },
    flush: runPending,
    cancel: () => {
      pending = false
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
    },
  }
}

function coerceJson(data: unknown): unknown {
  if (typeof data !== 'string') return data
  const value = data.trim()
  if (!value || (value[0] !== '{' && value[0] !== '[')) return data
  try {
    return JSON.parse(value) as unknown
  } catch {
    return data
  }
}

function textFromUnknown(value: unknown): string {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return ''
  return value
    .map((part) => {
      if (typeof part === 'string') return part
      if (part && typeof part === 'object' && 'text' in part) {
        const text = (part as { text?: unknown }).text
        return typeof text === 'string' ? text : ''
      }
      return ''
    })
    .join('')
}

export function extractStreamChatDelta(payload: unknown): StreamChatDelta {
  const data = payload as {
    choices?: Array<{
      delta?: { content?: unknown; reasoning_content?: unknown; reasoning?: unknown }
      message?: { content?: unknown; reasoning_content?: unknown; reasoning?: unknown }
      text?: unknown
    }>
  } | null
  const choice = data?.choices?.[0]
  if (!choice) return { content: '', reasoning: '' }

  const delta = choice.delta ?? choice.message
  const content = textFromUnknown(delta?.content ?? choice.text)
  const reasoning = textFromUnknown(delta?.reasoning_content ?? delta?.reasoning)
  return { content, reasoning }
}

/** 部分模型把思考过程写进正文 … */
export function splitInlineThinking(body: string): { thinking: string; body: string } {
  let rest = body
  const parts: string[] = []
  const re = /<think(?:ing)?>([\s\S]*?)<\/think(?:ing)?>\s*/gi
  rest = rest.replace(re, (_, inner: string) => {
    const trimmed = inner.trim()
    if (trimmed) parts.push(trimmed)
    return ''
  })
  return { thinking: parts.join('\n\n').trim(), body: rest.trim() }
}

function mergePartial(thinking: string, body: string): StreamChatPartial {
  const inline = splitInlineThinking(body)
  return {
    thinking: [thinking.trim(), inline.thinking].filter(Boolean).join('\n\n').trim(),
    body: inline.body,
  }
}

function errorFromResponse(label: string, status: number, data: unknown): Error {
  const payload = coerceJson(data) as { error?: { message?: string }; message?: string } | null
  const detail = payload?.error?.message || payload?.message
  return new Error(detail ? `${label}：${detail}` : `${label}：请求失败（HTTP ${status}）`)
}

async function completeJson(
  url: string,
  apiKey: string,
  body: object,
  signal?: AbortSignal,
): Promise<StreamChatPartial> {
  if (signal?.aborted) throw new DOMException('AI 速读已取消', 'AbortError')

  let response: { status: number; data: unknown }
  if (Capacitor.isNativePlatform()) {
    const nativeResponse = await awaitWithAbort(
      CapacitorHttp.post({
        url,
        headers: {
          'Content-Type': 'application/json; charset=UTF-8',
          Authorization: `Bearer ${apiKey}`,
        },
        data: body,
        connectTimeout: 15000,
        readTimeout: 120000,
      }),
      signal,
    )
    response = { status: nativeResponse.status, data: coerceJson(nativeResponse.data) }
  } else {
    const webResponse = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    })
    response = {
      status: webResponse.status,
      data: (await webResponse.json().catch(() => null)) as unknown,
    }
  }

  if (signal?.aborted) throw new DOMException('AI 速读已取消', 'AbortError')
  if (response.status < 200 || response.status >= 300) {
    throw errorFromResponse('AI 速读', response.status, response.data)
  }

  const payload = coerceJson(response.data) as {
    choices?: Array<{
      message?: { content?: unknown; reasoning_content?: unknown; reasoning?: unknown }
    }>
  } | null
  const message = payload?.choices?.[0]?.message
  const content = textFromUnknown(message?.content) || extractOpenAiChatContent(response.data) || ''
  const reasoning = textFromUnknown(message?.reasoning_content ?? message?.reasoning)
  const merged = mergePartial(reasoning, cleanMarkdown(content))
  if (!merged.thinking && !merged.body.trim()) throw new Error('AI 速读：返回内容为空')
  return merged
}

export async function streamChatCompletion(
  url: string,
  apiKey: string,
  body: object,
  signal: AbortSignal | undefined,
  onPartial: ((partial: StreamChatPartial) => void) | undefined,
): Promise<StreamChatPartial> {
  let emittedPartial = false
  const emit = (partial: StreamChatPartial) => {
    emittedPartial = true
    onPartial?.(partial)
  }

  let updateScheduler: StreamUpdateScheduler | null = null

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        Accept: 'text/event-stream, application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    })

    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as unknown
      throw errorFromResponse('AI 速读', response.status, data)
    }

    if (!response.body?.getReader) {
      throw new TypeError('AI 速读：当前环境不支持流式响应')
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder('utf-8')
    let buffer = ''
    let raw = ''
    let thinking = ''
    let bodyText = ''
    let sawSse = false

    updateScheduler = createStreamUpdateScheduler(() => {
      emit(mergePartial(thinking, bodyText))
    })

    const consumeLine = (line: string) => {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) return
      sawSse = true
      const data = trimmed.slice(5).trim()
      if (!data || data === '[DONE]') return
      let payload: unknown
      try {
        payload = JSON.parse(data) as unknown
      } catch {
        return
      }
      const delta = extractStreamChatDelta(payload)
      if (!delta.reasoning && !delta.content) return
      if (delta.reasoning) thinking += delta.reasoning
      if (delta.content) bodyText += delta.content
      updateScheduler?.schedule()
    }

    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      const text = decoder.decode(chunk.value, { stream: true })
      if (!sawSse) raw += text
      buffer += text.replace(/\r\n/g, '\n')
      let newline = buffer.indexOf('\n')
      while (newline >= 0) {
        consumeLine(buffer.slice(0, newline))
        buffer = buffer.slice(newline + 1)
        newline = buffer.indexOf('\n')
      }
      if (sawSse) raw = ''
    }
    buffer += decoder.decode()
    if (buffer.trim()) consumeLine(buffer)

    if (!sawSse) {
      try {
        const payload = JSON.parse(raw) as unknown
        const message = (payload as { choices?: Array<{ message?: { content?: unknown; reasoning_content?: unknown; reasoning?: unknown } }> })
          ?.choices?.[0]?.message
        const content = textFromUnknown(message?.content) || extractOpenAiChatContent(payload) || ''
        const reasoning = textFromUnknown(message?.reasoning_content ?? message?.reasoning)
        thinking = reasoning
        bodyText = content
      } catch {
        /* fall through */
      }
    }

    updateScheduler.cancel()
    const merged = mergePartial(thinking, cleanMarkdown(bodyText))
    if (!merged.thinking && !merged.body.trim()) throw new Error('AI 速读：返回内容为空')
    emit(merged)
    return merged
  } catch (error) {
    updateScheduler?.cancel()
    if (signal?.aborted) throw error
    const streamUnavailable =
      error instanceof TypeError ||
      (error instanceof Error && error.message === 'AI 速读：当前环境不支持流式响应')
    if (emittedPartial || !streamUnavailable) throw error
    const fallback = await completeJson(url, apiKey, { ...body, stream: false }, signal)
    emit(fallback)
    return fallback
  }
}
