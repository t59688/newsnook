import { useCallback, useEffect, useId, useRef, useState, type MutableRefObject } from 'react'
import { Check, X } from 'lucide-react'

import { lockBodyScroll } from '../lib/bodyScrollLock'
import {
  cancelScheduledPreview,
  previewThemeScheme,
  schedulePreviewThemeScheme,
  schemeOnboardingOptions,
} from '../lib/schemeOnboarding'
import type { CustomSchemePrefs } from '../lib/customScheme'
import type { ThemeScheme, ThemeSchemeSwatch } from '../lib/theme'

/**
 * 风格选择：只出现一次，形态靠近同步介绍。
 * 点选只改 data-scheme 做预览；确认才写入偏好，「稍后再说」把画面拨回打开前。
 * 预览延后一帧写入（见 schedulePreviewThemeScheme），点击帧只画卡片的选中态。
 */
interface Props {
  open: boolean
  initialScheme: ThemeScheme
  customScheme?: CustomSchemePrefs
  onConfirm: (scheme: ThemeScheme) => void
  onDismiss: () => void
  closeRef?: MutableRefObject<(() => boolean) | null>
}

function SchemeSwatchPane({ swatch }: { swatch: ThemeSchemeSwatch }) {
  return (
    <span className="relative flex-1" style={{ backgroundColor: swatch.ink }}>
      <span
        className="absolute left-1.5 top-1.5 h-2.5 w-2/3 rounded-[2px]"
        style={{ backgroundColor: swatch.raised }}
        aria-hidden
      />
      <span
        className="absolute bottom-1 left-1.5 font-display leading-none"
        style={{ color: swatch.paper, fontSize: 13 }}
        aria-hidden
      >
        Aa
      </span>
      <span
        className="absolute bottom-1.5 right-1.5 h-[2px] w-3.5 rounded-full"
        style={{ backgroundColor: swatch.accent }}
        aria-hidden
      />
    </span>
  )
}

export function SchemeOnboardingPrompt({
  open,
  initialScheme,
  customScheme,
  onConfirm,
  onDismiss,
  closeRef,
}: Props) {
  const titleId = useId()
  const descriptionId = useId()
  const baselineRef = useRef<ThemeScheme>(initialScheme)
  const openedRef = useRef(false)
  const [selected, setSelected] = useState<ThemeScheme>(initialScheme)

  if (open && !openedRef.current) {
    baselineRef.current = initialScheme
    openedRef.current = true
  }
  if (!open && openedRef.current) {
    openedRef.current = false
  }

  const restoreBaseline = useCallback(() => {
    cancelScheduledPreview()
    previewThemeScheme(baselineRef.current, customScheme)
  }, [customScheme])

  const dismiss = useCallback(() => {
    restoreBaseline()
    onDismiss()
  }, [onDismiss, restoreBaseline])

  const confirm = useCallback(() => {
    // 确认后由偏好落盘统一套用方案；来不及落地的预览直接作废，免得两边抢写 data-scheme
    cancelScheduledPreview()
    onConfirm(selected)
  }, [onConfirm, selected])

  useEffect(() => {
    if (!open) return
    setSelected(initialScheme)
    return () => cancelScheduledPreview()
  }, [open, initialScheme])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismiss()
    }
    const unlock = lockBodyScroll()
    window.addEventListener('keydown', onKey)
    return () => {
      unlock()
      window.removeEventListener('keydown', onKey)
    }
  }, [open, dismiss])

  useEffect(() => {
    if (!closeRef) return
    if (!open) {
      closeRef.current = null
      return
    }
    closeRef.current = () => {
      dismiss()
      return true
    }
    return () => {
      closeRef.current = null
    }
  }, [open, closeRef, dismiss])

  if (!open) return null

  const options = schemeOnboardingOptions()

  return (
    <div
      className="fixed inset-0 z-[65] flex items-end justify-center bg-black/50 px-4 md:items-center"
      style={{ paddingBottom: 'calc(var(--sab) + 84px)' }}
      role="presentation"
      onClick={dismiss}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="w-full max-w-md rounded-2xl border border-haze bg-ink-raised p-4 shadow-[var(--shadow-lift)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p id={titleId} className="text-[14px] font-medium text-paper">
              选择阅读风格
            </p>
            <p id={descriptionId} className="mt-1.5 text-[11.5px] leading-relaxed text-paper-faint">
              这版新增「现代优雅」，接近卡片白。先挑一套用着，之后可在「我的 → 外观」随时更换。
            </p>
          </div>
          <button
            type="button"
            onClick={dismiss}
            aria-label="关闭"
            className="-mr-1 -mt-1 shrink-0 p-1 text-paper-faint hover:text-paper"
          >
            <X size={15} strokeWidth={1.6} />
          </button>
        </div>

        <ul aria-label="选择外观风格" className="mt-3 grid grid-cols-3 gap-2">
          {options.map((item) => {
            const checked = item.id === selected
            const isNew = item.id === 'pearl'
            return (
              <li key={item.id}>
                <button
                  type="button"
                  aria-label={`选择${item.label}风格`}
                  aria-pressed={checked}
                  onClick={() => {
                    setSelected(item.id)
                    schedulePreviewThemeScheme(item.id)
                  }}
                  className={`flex w-full flex-col gap-1.5 rounded-xl border p-2 text-left ${
                    checked ? 'border-cinnabar/60 bg-ink' : 'border-haze bg-ink/40'
                  }`}
                >
                  <span
                    className={`relative flex h-12 overflow-hidden rounded-md border ${
                      checked ? 'border-cinnabar/40' : 'border-haze'
                    }`}
                  >
                    <SchemeSwatchPane swatch={item.swatch.light} />
                    <span className="w-px shrink-0 bg-black/25" aria-hidden />
                    <SchemeSwatchPane swatch={item.swatch.dark} />
                  </span>
                  <span className="flex items-start justify-between gap-1">
                    <span className="min-w-0">
                      <span className="block truncate text-[12px] leading-tight text-paper">
                        {item.label}
                      </span>
                      {isNew && (
                        <span className="mt-0.5 block font-mono text-[9px] tracking-wide text-cinnabar-soft">
                          新
                        </span>
                      )}
                    </span>
                    {checked && (
                      <Check size={13} strokeWidth={2.2} className="mt-0.5 shrink-0 text-cinnabar" aria-hidden />
                    )}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>

        <div className="mt-3 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={dismiss}
            className="rounded-full border border-haze px-4 py-1.5 font-mono text-[11px] text-paper-muted"
          >
            稍后再说
          </button>
          <button
            type="button"
            onClick={confirm}
            className="rounded-full border border-cinnabar/70 bg-cinnabar/15 px-4 py-1.5 font-mono text-[11px] font-medium text-cinnabar-soft"
          >
            就用这个
          </button>
        </div>
      </div>
    </div>
  )
}
