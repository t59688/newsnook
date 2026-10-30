import { useId, useState } from 'react'
import { ChevronDown, SlidersHorizontal } from 'lucide-react'
import type { CatalogCapabilities } from './abilities/types'

interface Props {
  capabilities: CatalogCapabilities
  loading: boolean
  onChoose: (controlId: string, choiceId: string) => void
  onOpenOriginal: () => void
}

/** UI renders observed actions only; protocol and URL construction stay in the feature layer. */
export function CatalogControls({ capabilities, loading, onChoose, onOpenOriginal }: Props) {
  const [expanded, setExpanded] = useState(false)
  const panelId = useId()
  const controls = capabilities.controls
  const blocked = capabilities.issues.some(issue => issue.reason === 'javascript-control' || issue.reason === 'session-field' || issue.reason === 'unsupported-form')
  if (!controls.length && !blocked) return null
  const selected = controls.flatMap(control => control.choices.filter(choice => choice.selected && !/^(?:全部|不限|所有|all|any)$/i.test(choice.title)).map(choice => choice.title))
  return (
    <section className="border-t border-haze/30" aria-label="目录筛选">
      {controls.length > 0 && (
        <button
          type="button"
          aria-label={expanded ? '收起筛选与排序' : '展开筛选与排序'}
          aria-expanded={expanded}
          aria-controls={panelId}
          onClick={() => setExpanded(value => !value)}
          className="page-x flex min-h-11 w-full items-center gap-2 text-left text-[12px] text-paper-muted transition-colors hover:bg-paper/4"
        >
          <SlidersHorizontal size={14} strokeWidth={1.8} className="shrink-0" />
          <span className="shrink-0 font-medium text-paper">筛选与排序</span>
          <span className="min-w-0 flex-1 truncate text-[11px] text-paper-faint">{selected.join(' · ') || `${controls.length} 项`}</span>
          <ChevronDown size={14} className={`shrink-0 transition-transform motion-reduce:transition-none ${expanded ? 'rotate-180' : ''}`} />
        </button>
      )}
      {expanded && controls.length > 0 && (
        <div id={panelId} className="page-x max-h-[38vh] space-y-2 overflow-y-auto overscroll-contain pb-3" aria-busy={loading}>
          {controls.map(control => (
            <div key={control.id} data-catalog-control={control.semantic} role="group" aria-label={control.title} className="flex min-w-0 items-start gap-2">
              <span className="mt-2 w-12 shrink-0 break-words text-[11px] leading-4 text-paper-faint">{control.title}{control.selection === 'multiple' ? '（多选）' : ''}</span>
              <div className="flex min-w-0 flex-1 flex-wrap gap-1">
                {control.choices.map(choice => (
                  <button
                    key={choice.id}
                    type="button"
                    aria-pressed={choice.selected}
                    disabled={loading}
                    onClick={() => onChoose(control.id, choice.id)}
                    className={`min-h-9 max-w-full rounded-lg px-2.5 py-1.5 text-[12px] leading-5 transition-colors active:scale-[0.98] motion-reduce:transform-none disabled:cursor-wait disabled:opacity-50 ${choice.selected ? 'bg-cinnabar/12 font-medium text-cinnabar' : 'text-paper-muted hover:bg-paper/6 hover:text-paper'}`}
                  >{choice.title}</button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      {blocked && (
        <div className="page-x flex items-center justify-between gap-2 pb-2 text-[11px] text-paper-faint">
          <span>部分筛选需在原站操作</span>
          <button type="button" onClick={onOpenOriginal} className="shrink-0 rounded px-2 py-1 text-cinnabar hover:bg-cinnabar/8">打开原站</button>
        </div>
      )}
    </section>
  )
}
