import { Loader2, ShieldCheck } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { LinuxDoApiError } from '../types'
import { readableError } from './utils'

export interface LinuxDoVerificationOptions {
  url?: string
  readSyncChallenge?: boolean
}

export type LinuxDoVerify = (options?: LinuxDoVerificationOptions) => Promise<boolean>

export function isLinuxDoVerificationError(error: unknown): error is LinuxDoApiError {
  return error instanceof LinuxDoApiError && error.kind === 'browser-verification'
}

/**
 * One first-party verification action for all Linux.do screens.
 * A user-cancelled dialog does not retry, and returning from the dialog never
 * changes the login identity. Only the retried API response proves clearance.
 */
export function LinuxDoVerificationAction({
  onVerify,
  onRetry,
  options,
  busy = false,
  className = '',
  label = '打开安全验证',
  readSync = false,
}: {
  onVerify: LinuxDoVerify
  onRetry: () => void | Promise<void>
  options?: LinuxDoVerificationOptions
  busy?: boolean
  className?: string
  label?: string
  readSync?: boolean
}) {
  const [verifying, setVerifying] = useState(false)
  const [failure, setFailure] = useState('')
  const inFlightRef = useRef(false)
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const act = async () => {
    if (inFlightRef.current || busy) return
    inFlightRef.current = true
    setVerifying(true)
    setFailure('')
    try {
      if (await onVerify(options) && mountedRef.current) await onRetry()
    } catch (error) {
      if (mountedRef.current) setFailure(readableError(error))
    } finally {
      inFlightRef.current = false
      if (mountedRef.current) setVerifying(false)
    }
  }

  return (
    <span className="inline-flex flex-col items-start gap-1.5">
      <button
        type="button"
        data-linuxdo-verify
        data-read-sync-verify={readSync ? '' : undefined}
        aria-label={label}
        disabled={busy || verifying}
        onClick={() => void act()}
        className={'linuxdo-control inline-flex min-h-9 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-cinnabar px-3.5 text-[12px] font-semibold text-white shadow-sm transition-opacity active:scale-[0.98] disabled:opacity-50 ' + className}
      >
        {verifying ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} aria-hidden="true" />}
        {verifying ? '正在验证…' : label}
      </button>
      {failure ? <span className="max-w-72 text-[11px] leading-4 text-cinnabar-soft" role="alert">{failure}</span> : null}
    </span>
  )
}

/** The same layout covers a blocked empty topic and a failed cached-list refresh. */
export function LinuxDoRequestError({
  error,
  onVerify,
  onRetry,
  onLogin,
  busy = false,
  variant = 'inline',
  verificationOptions,
}: {
  error: unknown
  onVerify?: LinuxDoVerify
  onRetry: () => void | Promise<void>
  onLogin?: () => void
  busy?: boolean
  variant?: 'empty' | 'inline'
  verificationOptions?: LinuxDoVerificationOptions
}) {
  const verification = isLinuxDoVerificationError(error)
  const authRequired = error instanceof LinuxDoApiError && error.kind === 'auth-required'
  const empty = variant === 'empty'
  return (
    <section
      data-linuxdo-request-error
      role="alert"
      className={
        'rounded-2xl border border-cinnabar/20 bg-ink-raised/80 text-paper shadow-sm ' +
        (empty ? 'mx-auto mt-12 max-w-sm px-5 py-7 text-center' : 'mb-3 flex items-center gap-3 px-3.5 py-3')
      }
    >
      {empty ? (
        <span className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-2xl bg-cinnabar/10 text-cinnabar">
          <ShieldCheck size={21} aria-hidden="true" />
        </span>
      ) : (
        <ShieldCheck size={17} className="shrink-0 text-cinnabar" aria-hidden="true" />
      )}
      <div className={empty ? '' : 'min-w-0 flex-1'}>
        <p className="text-[13px] font-semibold">{verification ? '需要完成 Linux.do 安全验证' : authRequired ? '请先登录 Linux.do' : '加载失败'}</p>
        <p className={'mt-1 text-[11px] leading-5 text-paper-muted ' + (empty ? '' : 'break-words')}>
          {verification ? '请在 Linux.do 官方页面完成验证，返回后继续加载当前内容。' : readableError(error)}
        </p>
        {verification && error instanceof LinuxDoApiError && error.diagnostics?.cfRay ? (
          <p className="mt-1 select-text break-all font-mono text-[9px] text-paper-faint">CF-Ray · {error.diagnostics.cfRay}</p>
        ) : null}
        <div className={'mt-3 flex flex-wrap gap-2 ' + (empty ? 'justify-center' : '')}>
          {verification && onVerify ? (
            <LinuxDoVerificationAction
              onVerify={onVerify}
              onRetry={onRetry}
              options={verificationOptions}
              busy={busy}
            />
          ) : authRequired && onLogin ? (
            <button type="button" onClick={onLogin} className="linuxdo-control min-h-9 rounded-xl bg-cinnabar px-3.5 text-[12px] font-semibold text-white">登录 Linux.do</button>
          ) : null}
          <button
            type="button"
            disabled={busy}
            onClick={() => void onRetry()}
            className="linuxdo-control min-h-9 rounded-xl border border-haze/70 bg-paper/[0.03] px-3.5 text-[12px] font-medium text-paper-muted disabled:opacity-50"
          >
            重试
          </button>
        </div>
      </div>
    </section>
  )
}
