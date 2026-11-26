import { ExternalLink } from 'lucide-react'
import { openContentLink } from '../../features/browser/browserOpen'

import { SettingsSection, SettingsShell } from '../../components/SettingsShell'
import {
  APP_LICENSE,
  NATIVE_OSS_LICENSES,
  RUNTIME_OSS_LICENSES,
  type OssLicenseEntry,
} from '../../features/oss/licenses'

interface Props {
  onBack: () => void
}

function LicenseRow({ entry }: { entry: OssLicenseEntry }) {
  const content = (
    <>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[14px] font-medium text-paper">{entry.name}</span>
          <span className="inline-flex items-center rounded bg-ink-raised px-1.5 py-0.5 font-mono text-[9px] text-paper-muted">
            {entry.license}
          </span>
        </div>
        {entry.note ? (
          <p className="mt-0.5 text-[11px] text-paper-faint">{entry.note}</p>
        ) : null}
      </div>
      {entry.url ? (
        <ExternalLink size={14} strokeWidth={1.5} className="shrink-0 text-paper-faint" />
      ) : null}
    </>
  )

  if (!entry.url) {
    return <li className="page-x flex items-center gap-3.5 py-3.5">{content}</li>
  }

  return (
    <li className="transition-colors hover:bg-ink-raised/30 active:bg-ink-raised/50">
      <button
        type="button"
        onClick={() => openContentLink(entry.url!)}
        className="page-x flex w-full items-center gap-3.5 py-3.5 text-left"
      >
        {content}
      </button>
    </li>
  )
}

/** 关于 → 开源许可：本软件协议与直接依赖清单 */
export function OpenSourceScreen({ onBack }: Props) {
  return (
    <SettingsShell title="开源许可" caption="本软件与第三方组件" onBack={onBack}>
      <SettingsSection variant="plain" title="本软件">
        <ul className="divide-y divide-haze border-y border-haze bg-ink">
          <LicenseRow
            entry={{
              name: APP_LICENSE.name,
              license: APP_LICENSE.license,
              note: APP_LICENSE.notice,
              url: APP_LICENSE.url,
            }}
          />
        </ul>
      </SettingsSection>

      <SettingsSection variant="plain" title="运行时依赖">
        <ul className="divide-y divide-haze border-y border-haze bg-ink">
          {RUNTIME_OSS_LICENSES.map((entry) => (
            <LicenseRow key={entry.name} entry={entry} />
          ))}
        </ul>
      </SettingsSection>

      <SettingsSection variant="plain" title="原生组件">
        <ul className="divide-y divide-haze border-y border-haze bg-ink">
          {NATIVE_OSS_LICENSES.map((entry) => (
            <LicenseRow key={entry.name} entry={entry} />
          ))}
        </ul>
      </SettingsSection>
    </SettingsShell>
  )
}
