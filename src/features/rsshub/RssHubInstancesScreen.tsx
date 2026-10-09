import { useEffect, useRef, useState } from 'react'
import { Activity, AlertCircle, CheckCircle2, Globe2, Loader2, Plus, Trash2 } from 'lucide-react'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { SettingsSection, SettingsShell } from '../../components/SettingsShell'
import { fetchAbsoluteText } from '../../lib/http'
import {
  addRssHubInstance,
  changeRssHubInstanceEnabled,
  normalizeRssHubInstances,
  removeRssHubInstance,
  type RssHubInstance,
} from './instances'
import { getRssHubCooldown } from './fetch'

interface Props {
  instances: RssHubInstance[]
  onChange: (next: RssHubInstance[]) => void
  onBack: () => void
}

type CheckResult = { kind: 'checking' | 'ok' | 'error'; detail?: string; at?: number }

export function RssHubInstancesScreen({ instances, onChange, onBack }: Props) {
  const list = normalizeRssHubInstances(instances)
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [results, setResults] = useState<Record<string, CheckResult>>({})
  const [removing, setRemoving] = useState<RssHubInstance | null>(null)
  const controllerRef = useRef<Map<string, AbortController>>(new Map())
  useEffect(() => () => {
    for (const controller of controllerRef.current.values()) controller.abort()
    controllerRef.current.clear()
  }, [])

  const add = () => {
    try {
      const next = addRssHubInstance(list, address, name)
      onChange(next)
      setAddress('')
      setName('')
      setMessage(null)
    } catch (error) { setMessage(error instanceof Error ? error.message : '无法添加实例') }
  }
  const check = async (instance: RssHubInstance) => {
    controllerRef.current.get(instance.id)?.abort()
    const controller = new AbortController()
    controllerRef.current.set(instance.id, controller)
    setResults((prev) => ({ ...prev, [instance.id]: { kind: 'checking' } }))
    const timeout = setTimeout(() => controller.abort(), 8_000)
    try {
      // A homepage check proves reachability only, not individual route availability.
      const payload = await fetchAbsoluteText(instance.url + '/', { signal: controller.signal, accept: 'text/html,application/json' })
      if (controller.signal.aborted || controllerRef.current.get(instance.id) !== controller) return
      if (!payload.trim() || payload.length > 1_000_000) throw new Error('没有收到有效响应')
      setResults((prev) => ({ ...prev, [instance.id]: { kind: 'ok', detail: '可连接 · 路由仍需实际预览', at: Date.now() } }))
    } catch (error) {
      if (controllerRef.current.get(instance.id) !== controller) return
      setResults((prev) => ({
        ...prev, [instance.id]: { kind: 'error',
          detail: controller.signal.aborted ? '连接超时' : error instanceof Error ? error.message : '连接失败',
          at: Date.now() },
      }))
    } finally {
      clearTimeout(timeout)
      if (controllerRef.current.get(instance.id) === controller) controllerRef.current.delete(instance.id)
    }
  }

  return <SettingsShell title="RSSHub 服务" caption="多实例容错 · 自定义服务地址" onBack={onBack}>
    <div className="page-x space-y-3 pt-4">
      <div className="flex items-start gap-2.5 rounded-2xl border border-haze bg-ink-raised/60 px-4 py-3.5">
        <Globe2 size={17} strokeWidth={1.6} className="mt-0.5 shrink-0 text-cinnabar-soft" />
        <p className="text-[12px] leading-[1.8] text-paper-muted">
          RSSHub 通过第三方服务器转换网站更新。勾选的实例会用于订阅检测与公共路由故障回退；不同实例的可用路由可能不同。
          访问与订阅请求可能被实例运营者记录。含私人凭据的路由不会自动跨实例发送。
        </p>
      </div>
      {!list.some((item) => item.enabled) ? (
        <p role="status" className="rounded-xl border border-cinnabar/25 bg-cinnabar/8 px-3.5 py-3 text-[12px] text-cinnabar-soft">
          尚未启用实例：需要启用至少一个实例才能自动发现可用的 RSSHub 订阅。
        </p>
      ) : null}
    </div>

    <SettingsSection title="公共实例">
      <div className="page-x space-y-2 pb-3">
        {list.filter((item) => item.builtin).map((instance) => (
          <InstanceItem key={instance.id} instance={instance} result={results[instance.id]}
            cooldownMs={getRssHubCooldown(instance.id)}
            onToggle={(enabled) => onChange(changeRssHubInstanceEnabled(list, instance.id, enabled))}
            onCheck={() => void check(instance)}
          />
        ))}
      </div>
    </SettingsSection>

    <SettingsSection title="自定义实例">
      <div className="page-x space-y-3 pb-6">
        {list.filter((item) => !item.builtin).map((instance) => (
          <InstanceItem key={instance.id} instance={instance} result={results[instance.id]}
            cooldownMs={getRssHubCooldown(instance.id)}
            onToggle={(enabled) => onChange(changeRssHubInstanceEnabled(list, instance.id, enabled))}
            onCheck={() => void check(instance)}
            onRemove={() => setRemoving(instance)}
          />
        ))}
        <form onSubmit={(event) => { event.preventDefault(); add() }} className="space-y-3 rounded-2xl border border-haze bg-ink-raised/60 p-4">
          <div>
            <label htmlFor="rsshub-instance-name" className="mb-1.5 block font-mono text-[10px] tracking-[0.1em] text-paper-faint">实例名称（可选）</label>
            <input id="rsshub-instance-name" value={name} onChange={(event) => setName(event.target.value)}
              maxLength={40} placeholder="例如 我的 RSSHub"
              className="min-h-11 w-full rounded-xl border border-haze bg-ink/40 px-3.5 text-[13px] text-paper outline-none placeholder:text-paper-faint/60 focus:border-cinnabar/45" />
          </div>
          <div>
            <label htmlFor="rsshub-instance-address" className="mb-1.5 block font-mono text-[10px] tracking-[0.1em] text-paper-faint">HTTPS 服务地址</label>
            <input id="rsshub-instance-address" type="url" value={address} onChange={(event) => { setAddress(event.target.value); setMessage(null) }}
              required placeholder="https://rsshub.example.org"
              className="min-h-11 w-full rounded-xl border border-haze bg-ink/40 px-3.5 font-mono text-[12px] text-paper outline-none placeholder:text-paper-faint/60 focus:border-cinnabar/45" />
          </div>
          {message ? <p role="alert" className="text-[11.5px] text-cinnabar-soft">{message}</p> : null}
          <button type="submit" disabled={!address.trim()}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-full bg-cinnabar px-4 text-[12px] font-medium text-white transition-opacity disabled:opacity-35">
            <Plus size={15} /> 添加服务
          </button>
          <p className="text-[11px] leading-relaxed text-paper-faint">仅支持具有公网域名的 HTTPS 实例。不保存用户名、Cookie 或 API 密钥。</p>
        </form>
      </div>
    </SettingsSection>

    <ConfirmDialog open={Boolean(removing)} title="移除 RSSHub 实例？"
      message="现有订阅不会被删除，但绑定这个地址的订阅可能需要重新选择服务。"
      confirmLabel="移除" danger onCancel={() => setRemoving(null)}
      onConfirm={() => {
        if (removing) onChange(removeRssHubInstance(list, removing.id))
        setRemoving(null)
      }}
    />
  </SettingsShell>
}

function InstanceItem({ instance, result, cooldownMs, onToggle, onCheck, onRemove }: {
  instance: RssHubInstance
  result?: CheckResult
  cooldownMs: number
  onToggle: (enabled: boolean) => void
  onCheck: () => void
  onRemove?: () => void
}) {
  return <div className="rounded-2xl border border-haze bg-ink-raised/70 px-3.5 py-3 shadow-[var(--shadow-lift)]">
    <div className="flex min-h-11 items-center gap-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13.5px] font-medium text-paper">{instance.name}</p>
        <p className="mt-0.5 truncate font-mono text-[10.5px] text-paper-faint">{instance.url}</p>
      </div>
      <label className="inline-flex min-h-10 shrink-0 cursor-pointer items-center gap-2 text-[11px] text-paper-muted">
        <span className="sr-only">{'启用 ' + instance.name}</span>
        <input type="checkbox" aria-label={'启用 ' + instance.name} checked={instance.enabled}
          onChange={(event) => onToggle(event.target.checked)} className="size-4 accent-[var(--color-cinnabar)]" />
        {instance.enabled ? '启用' : '停用'}
      </label>
    </div>
    <div className="mt-2 flex items-center justify-between gap-2 border-t border-haze/70 pt-2">
      <span className="flex min-w-0 items-center gap-1.5 text-[10.5px] text-paper-faint" aria-live="polite">
        {result?.kind === 'ok' ? <CheckCircle2 size={12} className="shrink-0 text-cinnabar-soft" /> :
          result?.kind === 'error' ? <AlertCircle size={12} className="shrink-0 text-cinnabar-soft" /> :
            <Activity size={12} className="shrink-0" />}
        <span className="truncate">{result?.detail || (cooldownMs ? '部分路由正处于冷却期' : '未经连通性检测')}</span>
      </span>
      <div className="flex shrink-0 items-center gap-1">
        <button type="button" disabled={result?.kind === 'checking'} onClick={onCheck}
          className="inline-flex min-h-9 items-center gap-1 rounded-full px-2.5 text-[11px] text-cinnabar-soft transition-colors hover:bg-cinnabar/8 disabled:opacity-35">
          {result?.kind === 'checking' ? <Loader2 size={13} className="animate-spin" /> : null}
          {result?.kind === 'checking' ? '检测中' : '测试连接'}
        </button>
        {onRemove ? <button type="button" onClick={onRemove} aria-label={'移除 ' + instance.name}
          className="grid size-9 place-items-center rounded-full text-paper-faint transition-colors hover:bg-paper/6 hover:text-cinnabar">
          <Trash2 size={14} />
        </button> : null}
      </div>
    </div>
  </div>
}
