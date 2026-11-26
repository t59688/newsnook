import { useEffect, useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { openContentLink } from '../../features/browser/browserOpen'

import { MarkdownBody } from '../../components/MarkdownBody'
import { SettingsHint, SettingsShell } from '../../components/SettingsShell'
import { fetchReleaseNotes, releaseTagUrl } from '../../features/appUpdate/github'

interface Props {
  onBack: () => void
}

type LoadState =
  | { status: 'loading' }
  | { status: 'ok'; body: string; tagName: string }
  | { status: 'empty'; tagName: string }
  | { status: 'error'; message: string }

/** 展示当前安装版本对应的 GitHub Release 说明 */
export function ChangelogScreen({ onBack }: Props) {
  const version = __APP_VERSION__
  const [state, setState] = useState<LoadState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    void fetchReleaseNotes(version).then((result) => {
      if (cancelled) return
      if (result.status === 'ok') {
        setState({ status: 'ok', body: result.body, tagName: result.tagName })
        return
      }
      if (result.status === 'empty') {
        setState({ status: 'empty', tagName: result.tagName })
        return
      }
      setState({ status: 'error', message: result.message })
    })
    return () => {
      cancelled = true
    }
  }, [version])

  const releaseUrl = releaseTagUrl(version)

  return (
    <SettingsShell title="更新日志" caption={`当前版本 v${version}`} onBack={onBack}>
      <div className="page-x pt-4 pb-2">
        {state.status === 'loading' ? (
          <p className="font-mono text-[12px] text-paper-faint">正在加载…</p>
        ) : null}

        {state.status === 'ok' ? <MarkdownBody markdown={state.body} /> : null}

        {state.status === 'empty' ? (
          <p className="text-[13px] leading-relaxed text-paper-muted">该版本暂无发布说明。</p>
        ) : null}

        {state.status === 'error' ? (
          <div className="space-y-3">
            <p className="text-[13px] leading-relaxed text-paper-muted">{state.message}</p>
            <button
              type="button"
              onClick={() => {
                setState({ status: 'loading' })
                void fetchReleaseNotes(version).then((result) => {
                  if (result.status === 'ok') {
                    setState({ status: 'ok', body: result.body, tagName: result.tagName })
                    return
                  }
                  if (result.status === 'empty') {
                    setState({ status: 'empty', tagName: result.tagName })
                    return
                  }
                  setState({ status: 'error', message: result.message })
                })
              }}
              className="rounded-full border border-haze px-3 py-1.5 font-mono text-[11px] text-paper-muted transition-colors hover:text-paper"
            >
              重试
            </button>
          </div>
        ) : null}
      </div>

      <SettingsHint>
        <button
          type="button"
          onClick={() => openContentLink(releaseUrl)}
          className="inline-flex items-center gap-1.5 text-left text-paper-faint transition-colors hover:text-paper-muted"
        >
          <ExternalLink size={12} strokeWidth={1.6} />
          <span>在 GitHub 查看完整 Release</span>
        </button>
      </SettingsHint>
    </SettingsShell>
  )
}
