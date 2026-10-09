import { useEffect, useRef, useState } from 'react'
import { AlertCircle, CheckCircle2, Loader2, RadioTower } from 'lucide-react'
import { SettingsShell } from '../../components/SettingsShell'
import { FeedStorePicker } from '../feedDiscovery/FeedStorePicker'
import { previewFeed } from '../feedDiscovery/preview'
import type { FeedDiscoveryPreviewResult } from '../feedDiscovery/types'
import type { NewsSource, SourceDiscoveryMetadata } from '../../sources/registry'
import {
  isSensitiveRssHubRoute,
  normalizeRssHubInstances,
  rssHubFeedUrl,
  type RssHubInstance,
} from './instances'

interface Props {
  source: NewsSource
  instances: RssHubInstance[]
  onChange: (sourceId: string, url: string, discovery: SourceDiscoveryMetadata) => { ok: boolean; message?: string }
  onBack: () => void
}

/** Rebind the server, not the source: source.id and category/read/cache state remain stable. */
export function RssHubSubscriptionRebindScreen({ source, instances, onChange, onBack }: Props) {
  const list = normalizeRssHubInstances(instances).filter((item) => item.enabled)
  const route = source.discovery?.routeKey ?? ''
  const isSensitive = isSensitiveRssHubRoute(route) || isSensitiveRssHubRoute(source.url)
  let currentOrigin = ''
  try { currentOrigin = new URL(source.url).origin } catch { /* corrupted imported subscription; allow picking a valid instance */ }
  const [instanceId, setInstanceId] = useState(() =>
    list.find((item) => item.url === currentOrigin)?.id ?? list[0]?.id ?? '',
  )
  const selected = list.find((item) => item.id === instanceId)
  let candidateUrl: string | null = null
  try { if (selected && route) candidateUrl = rssHubFeedUrl(selected, route) } catch { /* invalid imported route never reaches the network */ }
  const [preview, setPreview] = useState<FeedDiscoveryPreviewResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const controllerRef = useRef<AbortController | null>(null)
  useEffect(() => () => { controllerRef.current?.abort() }, [])

  const choose = (next: string) => {
    controllerRef.current?.abort()
    controllerRef.current = null
    setLoading(false)
    setPreview(null)
    setError(null)
    setInstanceId(next)
  }
  const check = async () => {
    if (!candidateUrl || loading) return
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    setPreview(null)
    setLoading(true)
    setError(null)
    try {
      const result = await previewFeed(candidateUrl, { signal: controller.signal, timeoutMs: 10_000 })
      if (controllerRef.current === controller && !controller.signal.aborted) setPreview(result)
    } catch (cause) {
      if (controllerRef.current === controller && !controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : '检测失败')
      }
    } finally {
      if (controllerRef.current === controller) { controllerRef.current = null; setLoading(false) }
    }
  }
  const save = () => {
    if (!preview?.ok || !candidateUrl || !selected || !source.discovery) return
    const outcome = onChange(source.id, candidateUrl, {
      ...source.discovery,
      generator: 'rsshub',
      routeKey: route,
      instanceId: selected.id,
      verification: { status: 'verified', checkedAt: preview.checkedAt },
    })
    if (outcome.ok) onBack()
    else setError(outcome.message ?? '更换实例失败')
  }

  return <SettingsShell title="更换 RSSHub 服务" caption={source.name} onBack={onBack}>
    <div className="page-x space-y-4 pt-4 pb-7">
      <section className="rounded-2xl border border-haze bg-ink-raised/75 p-4 shadow-[var(--shadow-lift)]">
        <div className="flex items-center gap-2.5">
          <RadioTower size={17} className="text-cinnabar-soft" strokeWidth={1.7} />
          <p className="min-w-0 truncate text-[13.5px] font-medium text-paper">{source.name}</p>
        </div>
        <p className="mt-2 break-all font-mono text-[10.5px] leading-relaxed text-paper-faint">{route}</p>
        <p className="mt-2 text-[11.5px] leading-relaxed text-paper-muted">
          只更换 RSSHub 服务器，不删除当前订阅。来源 ID、已读、分类和预设都保持不变。
        </p>
      </section>

      {isSensitive ? (
        <p role="alert" className="rounded-2xl border border-cinnabar/30 bg-cinnabar/8 px-4 py-3 text-[12px] leading-relaxed text-cinnabar-soft">
          此订阅含有可能敏感的参数。为避免向其他服务器泄露信息，不支持跨实例迁移。
        </p>
      ) : (
        <section className="space-y-3 rounded-2xl border border-haze bg-ink-raised/75 p-4 shadow-[var(--shadow-lift)]">
          <div>
            <p className="text-[13px] font-medium text-paper">目标实例</p>
            <p className="mt-1 text-[11px] leading-relaxed text-paper-faint">会向所选第三方服务器请求订阅，先检测再保存。</p>
          </div>
          <FeedStorePicker title="选择目标 RSSHub 实例" value={selected?.id ?? ''}
            disabled={!list.length} options={list.map((item) => ({ id: item.id, label: item.name + ' · ' + new URL(item.url).hostname }))}
            onChange={choose}
          />
          <p className="break-all rounded-xl bg-ink/30 px-3 py-2.5 font-mono text-[10.5px] leading-relaxed text-paper-faint">
            {candidateUrl ?? '尚无已启用的 RSSHub 实例'}
          </p>
          <button type="button" onClick={() => void check()} disabled={!candidateUrl || loading}
            className="inline-flex min-h-10 items-center gap-2 rounded-full border border-cinnabar/35 bg-cinnabar/10 px-4 text-[12px] text-cinnabar-soft transition-colors hover:bg-cinnabar/15 disabled:opacity-40">
            {loading ? <Loader2 size={14} className="animate-spin" /> : null}
            {loading ? '正在检测…' : '检测订阅'}
          </button>
          {preview?.ok ? (
            <div role="status" className="flex items-start gap-2 rounded-xl bg-cinnabar/8 px-3.5 py-3 text-[12px] text-paper-muted">
              <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-cinnabar-soft" />
              <span>检测成功 · 本次返回 {preview.itemCount} 条文章</span>
            </div>
          ) : preview || error ? (
            <p role="alert" className="flex items-start gap-2 rounded-xl border border-cinnabar/25 bg-cinnabar/8 px-3.5 py-3 text-[12px] text-cinnabar-soft">
              <AlertCircle size={15} className="mt-0.5 shrink-0" />
              <span>{error ?? (preview && !preview.ok ? preview.message : '检测失败')}</span>
            </p>
          ) : (
            <p className="text-[11.5px] text-paper-faint">先检测新实例是否能返回有效 RSS，成功后才能保存。</p>
          )}
        </section>
      )}

      <button type="button" onClick={save}
        disabled={isSensitive || !preview?.ok || !candidateUrl || candidateUrl === source.url || loading}
        className="min-h-11 w-full rounded-full bg-cinnabar text-[13.5px] font-medium text-white transition-opacity disabled:opacity-30">
        确认更换实例
      </button>
    </div>
  </SettingsShell>
}
