import { Copy, RotateCw, ShieldCheck, TriangleAlert } from 'lucide-react'
import { LinuxDoApiError } from '../types'
import type { ReadSyncFailure } from '../topic/readSyncDiagnostic'

export function ReadSyncStatus({ failure, busy, onRetry, onVerify, onCopy }: {
  failure: ReadSyncFailure
  busy: boolean
  onRetry: () => void
  onVerify: () => void
  onCopy: () => void
}) {
  const error = failure.error instanceof LinuxDoApiError ? failure.error : undefined
  const detail = error?.diagnostics
  const firstPartyChallenge = error?.kind === 'browser-verification' && detail?.transport === 'browser-firstparty'
  const requiresVerification = error?.kind === 'browser-verification' || error?.kind === 'auth-required'
  const stage = detail?.stage === 'csrf' ? '获取写入会话' : detail?.stage === 'session' ? '检查登录会话' : '提交阅读记录'
  return (
    <aside data-linuxdo-read-sync role="status" className="border-b border-cinnabar/20 bg-cinnabar/[0.06] page-x py-2 text-[11px] text-paper-muted">
      <div className="flex items-start gap-2">
        <TriangleAlert size={14} className="mt-0.5 shrink-0 text-cinnabar" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-paper">{busy ? '正在恢复 Linux.do 会话…' : failure.retrying ? '阅读记录正在等待重试' : '阅读记录尚未同步，蓝点暂时保留'}</p>
          <p className="mt-0.5 break-all font-mono text-[10px]">{stage}{error?.status ? ` · HTTP ${error.status}` : ''}{detail ? ` · ${detail.method} ${detail.path} · ${detail.transport ?? 'unknown'}` : ''}</p>
          <p className="mt-0.5 text-[10px] text-paper-faint">{firstPartyChallenge
            ? 'Linux.do 安全规则拦截了第一方页面中的提交请求；后台请求不会弹出验证页。可打开可见的提交验证页，完成后重试；如仍失败，请复制诊断中的 CF-Ray 交由站点方排查。'
            : requiresVerification ? '普通浏览不受影响；可在应用内恢复同一账号会话，再补传当前阅读记录。' : '待发送记录已保留，不会把失败请求当作已读。'}</p>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {requiresVerification ? <button type="button" data-read-sync-verify disabled={busy} onClick={onVerify} className="linuxdo-control inline-flex items-center gap-1 rounded-full border border-cinnabar/30 px-2.5 py-1 text-cinnabar disabled:opacity-50"><ShieldCheck size={12} />{error?.kind === 'auth-required' ? '在应用内登录' : firstPartyChallenge ? '打开提交验证' : '在应用内验证'}</button> : null}
            <button type="button" disabled={busy} onClick={onRetry} className="linuxdo-control inline-flex items-center gap-1 rounded-full border border-haze px-2.5 py-1 disabled:opacity-50"><RotateCw size={12} />重试同步</button>
            <button type="button" onClick={onCopy} className="linuxdo-control inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-paper-faint"><Copy size={12} />复制诊断</button>
          </div>
        </div>
      </div>
    </aside>
  )
}
