import { Capacitor } from '@capacitor/core'

import { fetchAbsoluteText } from '../../lib/http'
import { fetchMediaBytes } from '../../lib/mediaFetch'
import {
  buildMediaDescriptor,
  collectMediaCandidates,
  mergeObservationSources,
  observeMediaInHtml,
  observeMediaInPayload,
} from './core'
import { observeMediaInNativePage } from './native'
import { nnyyPlayApiUrls } from './nnyyPlay'
import { parseMediaApiBody } from './apiParser'
import { admitObservation } from './classifier'
import { publicPlaybackHeaders } from './originHeaders'
import { planSniffTargets, runtimeProbePageUrl } from './targetPlanner'
import type { MediaDescriptor, MediaObservation } from './types'

export { embeddedPageUrlsInHtml, planSniffTargets, runtimeProbePageUrl } from './targetPlanner'
export { secondaryPlaybackUrlsInHtml } from './targetPlanner'

const MAX_MANIFEST_BYTES = 512 * 1024

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

async function manifestBodies(
  observations: MediaObservation[],
  signal?: AbortSignal,
): Promise<Map<string, string>> {
  const manifests = collectMediaCandidates(observations)
    .filter((candidate) => candidate.format === 'hls' || candidate.format === 'dash')
    .slice(0, 2)
  const result = new Map<string, string>()

  await Promise.all(
    manifests.map(async (candidate) => {
      try {
        const { data } = await fetchMediaBytes(candidate.originalUrl, signal, {
          sourcePage: candidate.pageUrl,
          headers: candidate.requestHeaders,
          range: `bytes=0-${MAX_MANIFEST_BYTES - 1}`,
        })
        if (data.byteLength > MAX_MANIFEST_BYTES) return
        result.set(candidate.originalUrl, new TextDecoder().decode(data))
      } catch {
        // URL 与媒体类型信号仍可用于播放；清单增强失败不应丢掉候选。
      }
    }),
  )
  return result
}

export async function discoverMediaDescriptor(options: {
  pageUrl: string
  html?: string
  payload?: unknown
  runtime?: boolean
  timeoutMs?: number
  referrer?: string
  signal?: AbortSignal
  onDescriptor?: (descriptor: MediaDescriptor) => void
  observeNative?: (
    url: string,
    timeoutMs: number,
    referrer?: string,
    onObservation?: (observation: MediaObservation) => void,
  ) => Promise<MediaObservation[]>
}): Promise<MediaDescriptor | null> {
  const staticObservations = options.html
    ? observeMediaInHtml(options.html, options.pageUrl)
    : options.payload === undefined
      ? []
      : observeMediaInPayload(options.payload, options.pageUrl)

  if (options.html) {
    for (const apiUrl of nnyyPlayApiUrls(options.html, options.pageUrl)) {
      try {
        const body = await fetchAbsoluteText(apiUrl, { signal: options.signal })
        staticObservations.push(...parseMediaApiBody(body, options.pageUrl, 'fetch'))
      } catch {
        // 播放 API 失败时不阻断其他嗅探路径。
      }
    }
  }

  const runtimeObservations: MediaObservation[] = []
  let lastEmittedSignature = ''
  const emitAvailableDescriptor = (allowProgressive: boolean) => {
    if (!options.onDescriptor) return
    const descriptor = buildMediaDescriptor(
      mergeObservationSources(staticObservations, runtimeObservations),
    )
    if (!descriptor || descriptor.resources?.[0]?.isAd) return
    // Preroll progressive often arrives first; publishing it mid-sniff replaces
    // the player with a short ad and aborts waiting for the real manifest.
    if (!allowProgressive && descriptor.type === 'progressive') return
    const signature = descriptorSignature(descriptor)
    if (signature === lastEmittedSignature) return
    lastEmittedSignature = signature
    try {
      options.onDescriptor(descriptor)
    } catch {
      // A UI subscriber must not cancel the underlying discovery lifecycle.
    }
  }
  emitAvailableDescriptor(true)
  const observe = options.observeNative ?? (Capacitor.isNativePlatform() ? observeMediaInNativePage : undefined)
  if (options.runtime !== false && observe) {
    const sniffTargets = planSniffTargets({
      pageUrl: options.pageUrl,
      html: options.html,
      staticObservations,
      totalTimeoutMs: options.timeoutMs ?? 6000,
    })
    const totalTimeoutMs = options.timeoutMs ?? 6000
    const deadline = Date.now() + totalTimeoutMs
    for (const target of sniffTargets) {
      const remainingMs = deadline - Date.now()
      if (remainingMs <= 0) break
      const targetTimeoutMs = Math.min(target.budgetMs, remainingMs)
      const probeTarget = runtimeProbePageUrl(target.url)
      const observations = await observe(
        probeTarget,
        targetTimeoutMs,
        target.referrer ?? options.referrer,
        (observation) => {
          const admitted = admitObservation(observation)
          if (!admitted) return
          runtimeObservations.push(admitted)
          emitAvailableDescriptor(false)
        },
      ).catch(() => [])
      for (const observation of observations) {
        const admitted = admitObservation(observation)
        if (admitted) runtimeObservations.push(admitted)
      }
      emitAvailableDescriptor(false)
    }
  }

  const observations = mergeObservationSources(staticObservations, runtimeObservations)
  if (!observations.length) return null
  const manifests = await manifestBodies(observations, options.signal)
  const descriptor = buildMediaDescriptor(observations, manifests)
  if (descriptor && options.onDescriptor) {
    const signature = descriptorSignature(descriptor)
    if (signature !== lastEmittedSignature) {
      try {
        options.onDescriptor(descriptor)
        lastEmittedSignature = signature
      } catch {
        // Keep the final descriptor available to the Promise caller.
      }
    }
  }
  return descriptor
}

function descriptorSignature(descriptor: MediaDescriptor): string {
  const headerSignature = (headers?: Record<string, string>) =>
    Object.entries(headers ?? {})
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [key, value])
  return JSON.stringify([
    descriptor.type,
    descriptor.url,
    descriptor.drm,
    headerSignature(descriptor.requestHeaders),
    descriptor.videoTracks.map((track) => track.url || ''),
    descriptor.audioTracks.map((track) => track.url || ''),
    descriptor.subtitles.map((track) => track.url || ''),
    descriptor.resources?.map((resource) => [
      resource.type,
      resource.url,
      resource.drm,
      headerSignature(resource.requestHeaders),
    ]) ?? [],
  ])
}

export function mediaDescriptorHtml(
  descriptor: MediaDescriptor,
  options: { title: string; poster?: string; contentHtml?: string },
): string {
  const content = options.contentHtml || ''
  if (descriptor.drm) {
    return `${content}<p>检测到受保护媒体，需在原站授权播放。</p>`
  }

  const attrs = [
    `src="${escapeHtml(descriptor.url)}"`,
    `title="${escapeHtml(options.title)}"`,
    `data-media-format="${descriptor.type}"`,
    `data-source-page="${escapeHtml(descriptor.pageUrl)}"`,
    'controls',
    'playsinline',
    'preload="metadata"',
  ]
  const publicHeaders = publicPlaybackHeaders(descriptor.requestHeaders)
  if (publicHeaders) {
    attrs.push(`data-media-headers="${escapeHtml(JSON.stringify(publicHeaders))}"`)
  }
  if (options.poster) attrs.push(`poster="${escapeHtml(options.poster)}"`)
  if (descriptor.relatedUrls?.length) {
    attrs.push(`data-media-extra-urls="${escapeHtml(JSON.stringify(descriptor.relatedUrls))}"`)
  }
  if (descriptor.origins?.length) {
    attrs.push(`data-media-origins="${escapeHtml(JSON.stringify(descriptor.origins))}"`)
  }
  if (descriptor.resources?.length) {
    attrs.push(`data-media-resources="${escapeHtml(JSON.stringify(descriptor.resources))}"`)
  }
  return `<video ${attrs.join(' ')}></video>${content}`
}
