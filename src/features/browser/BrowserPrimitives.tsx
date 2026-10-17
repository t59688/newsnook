import { useState, type ReactNode } from 'react'
import { AlertCircle, ArrowLeft, Globe2, ShieldCheck, X, type LucideIcon } from 'lucide-react'
import { shortcutFaviconUrl } from './browserHistory'
import { useBrowserDialogFocus } from './useBrowserDialogFocus'

export function BrowserIconButton({label, children, onClick, disabled = false, pressed, className = ''}: {
  label: string; children: ReactNode; onClick: () => void; disabled?: boolean
  pressed?: boolean; className?: string
}) {
  return <button type="button" aria-label={label} title={label} aria-pressed={pressed} disabled={disabled} onClick={onClick}
    className={'browser-icon-button ' + className}>
    {children}
  </button>
}

export function BrowserSiteIcon({url, name, size = 'normal', allowRemote = true}: {
  url: string; name?: string; size?: 'small' | 'normal'; allowRemote?: boolean
}) {
  const [failedSource, setFailedSource] = useState<string | null>(null)
  const source = allowRemote ? shortcutFaviconUrl(url) : null
  const failed = source !== null && failedSource === source
  return <span className={'browser-site-icon' + (size === 'small' ? ' browser-site-icon-small' : '')} aria-hidden="true">
    {source && !failed
      ? <img src={source} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailedSource(source)}/>
      : name ? <span>{Array.from(name)[0]?.toUpperCase()}</span> : <Globe2 size={20} strokeWidth={1.8}/>}
  </span>
}

export function BrowserSheet({title, children, onClose}: {title: string; children: ReactNode; onClose: () => void}) {
  const section = useBrowserDialogFocus<HTMLElement>()
  return <div className="browser-overlay absolute inset-0 z-50 flex items-end justify-center bg-black/50" role="presentation" onClick={onClose}>
    <section ref={section} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title}
      className="browser-sheet" onClick={event => event.stopPropagation()}>
      <div className="browser-sheet-handle" aria-hidden="true"/>
      <header className="browser-sheet-header">
        <h2>{title}</h2>
        <BrowserIconButton label={'关闭' + title} onClick={onClose}><X size={20} strokeWidth={1.8}/></BrowserIconButton>
      </header>
      <div className="browser-sheet-content">{children}</div>
    </section>
  </div>
}

export function BrowserPageHeader({title, onBack, children, subtitle}: {
  title: string; onBack: () => void; children?: ReactNode; subtitle?: string
}) {
  return <header className="browser-page-header">
    <BrowserIconButton label="返回浏览器" onClick={onBack}><ArrowLeft size={21} strokeWidth={1.8}/></BrowserIconButton>
    <div className="browser-page-heading">
      <h2>{title}</h2>
      {subtitle && <p>{subtitle}</p>}
    </div>
    {children && <div className="browser-page-actions">{children}</div>}
  </header>
}

export function BrowserEmptyState({icon: Icon, title, description, children}: {
  icon: LucideIcon; title: string; description?: string; children?: ReactNode
}) {
  return <div className="browser-empty-state">
    <span className="browser-empty-icon"><Icon size={26} strokeWidth={1.6} aria-hidden="true"/></span>
    <h3>{title}</h3>
    {description && <p>{description}</p>}
    {children}
  </div>
}

export function BrowserStatusBanner({children, error = false}: {children: ReactNode; error?: boolean}) {
  return <div className={'browser-status-banner' + (error ? ' browser-status-error' : '')}
    role={error ? 'alert' : 'status'}>
    <AlertCircle size={18} strokeWidth={1.8} aria-hidden="true"/>
    <div>{children}</div>
  </div>
}

export function BrowserPrivateNotice({compact = false}: {compact?: boolean}) {
  return <div className={'browser-private-notice' + (compact ? ' browser-private-notice-compact' : '')}>
    <ShieldCheck size={compact ? 18 : 22} strokeWidth={1.8} aria-hidden="true"/>
    <div>
      <p>隐私会话</p>
      {!compact && <span>本次访问不会写入浏览历史，关闭后清除临时网站数据。</span>}
    </div>
  </div>
}
