import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { CloudTranslationConfig } from '../translation/types'
import { loadSpeedReadCache, saveSpeedReadCache, speedReadCacheKey } from './cache'
import { createSpeedReadPartialStore, type SpeedReadPartialStore } from './partialStore'
import { parseSpeedReadStored } from './serialize'
import { summarizeArticle } from './service'
import type { SpeedReadProfile } from './sections'
import type { SpeedReadUiState } from './types'

export interface SpeedReadDocument {
  id: string
  title: string
  contentHtml: string
  profile?: SpeedReadProfile
}

interface UseSpeedReadOptions {
  document: SpeedReadDocument | null
  config: CloudTranslationConfig
}

export interface SpeedReadController {
  available: boolean
  open: boolean
  state: SpeedReadUiState
  markdown: string
  error: string
  partialStore: SpeedReadPartialStore
  openPanel: () => void
  closePanel: () => void
  retry: () => void
  cancel: () => void
}

/**
 * Shared local lifecycle for every AI speed-read surface.
 * Content screens only identify the current document; cache, streaming and
 * abort behavior stay out of site-specific UI modules.
 */
export function useSpeedRead({ document, config }: UseSpeedReadOptions): SpeedReadController {
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<SpeedReadUiState>('idle')
  const [markdown, setMarkdown] = useState('')
  const [error, setError] = useState('')
  const abortRef = useRef<AbortController | null>(null)
  const partialStoreRef = useRef<SpeedReadPartialStore | null>(null)
  if (!partialStoreRef.current) partialStoreRef.current = createSpeedReadPartialStore()
  const partialStore = partialStoreRef.current

  const profile = document?.profile ?? 'news'
  const available = Boolean(document?.contentHtml.trim())
  const cacheKey = useMemo(
    () => document
      ? speedReadCacheKey(document.id, document.title, document.contentHtml, config, profile)
      : null,
    [config, document, profile],
  )

  const abortActive = useCallback(() => {
    const controller = abortRef.current
    abortRef.current = null
    controller?.abort()
  }, [])

  useEffect(() => {
    abortActive()
    partialStore.reset()
    setOpen(false)
    setError('')

    if (!available || !cacheKey) {
      setMarkdown('')
      setState('idle')
      return
    }

    const cached = loadSpeedReadCache(cacheKey)
    if (!cached) {
      setMarkdown('')
      setState('idle')
      return
    }

    const parsed = parseSpeedReadStored(cached)
    partialStore.set({ thinking: parsed.thinking, body: parsed.body, status: '' })
    setMarkdown(parsed.body)
    setState('ready')
  }, [abortActive, available, cacheKey, partialStore])

  useEffect(() => () => abortActive(), [abortActive])

  const run = useCallback(async () => {
    if (!document || !cacheKey || !document.contentHtml.trim()) return

    abortActive()
    const controller = new AbortController()
    abortRef.current = controller
    partialStore.reset()
    setOpen(true)
    setState('loading')
    setError('')
    setMarkdown('')

    try {
      const result = await summarizeArticle({
        title: document.title,
        contentHtml: document.contentHtml,
        config,
        profile,
        signal: controller.signal,
        onPartial: (partial) => {
          if (controller.signal.aborted || abortRef.current !== controller) return
          partialStore.set(partial)
        },
      })
      if (controller.signal.aborted || abortRef.current !== controller) return
      const parsed = parseSpeedReadStored(result)
      partialStore.set({ thinking: parsed.thinking, body: parsed.body, status: '' })
      setMarkdown(parsed.body)
      setState('ready')
      saveSpeedReadCache(cacheKey, result)
    } catch (cause) {
      if (abortRef.current !== controller) return
      if (controller.signal.aborted) {
        const latest = partialStore.getSnapshot()
        partialStore.set({ ...latest, status: '' })
        setState('cancelled')
        return
      }
      partialStore.reset()
      setMarkdown('')
      setError(cause instanceof Error ? cause.message : 'AI 速读生成失败')
      setState('error')
    } finally {
      if (abortRef.current === controller) abortRef.current = null
    }
  }, [abortActive, cacheKey, config, document, partialStore, profile])

  const openPanel = useCallback(() => {
    setOpen(true)
    if (state === 'ready' && markdown.trim()) return
    if (state === 'loading') return
    void run()
  }, [markdown, run, state])

  const retry = useCallback(() => {
    void run()
  }, [run])

  const closePanel = useCallback(() => setOpen(false), [])

  const cancel = useCallback(() => {
    if (!abortRef.current) return
    abortRef.current.abort()
    setState('cancelled')
  }, [])

  return {
    available,
    open,
    state,
    markdown,
    error,
    partialStore,
    openPanel,
    closePanel,
    retry,
    cancel,
  }
}
