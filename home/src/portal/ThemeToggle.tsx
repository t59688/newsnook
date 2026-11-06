import { useCallback, useEffect, useState } from 'react'
import { Check, ChevronDown, Moon, Sun } from 'lucide-react'
import { SCHEMES, type SchemeKey } from '../lib/demo'

type SchemeId = SchemeKey

interface FeaturedScheme {
  id: SchemeId
  name: string
  caption: string
  accentColor: string
  previewBg: string
}

const FEATURED_SCHEMES: FeaturedScheme[] = SCHEMES.map((scheme) => ({
  id: scheme.key,
  name: scheme.name,
  caption: scheme.caption,
  accentColor: scheme.dark.accent,
  previewBg: scheme.dark.ink,
}))

function getSchemeAccent(id: SchemeId, isLight: boolean): string {
  const scheme = SCHEMES.find((item) => item.key === id) ?? SCHEMES[0]
  return isLight ? scheme.light.accent : scheme.dark.accent
}

function usePortalTheme() {
  const [isLight, setIsLight] = useState(() => {
    if (typeof document === 'undefined') return false
    return document.documentElement.dataset.theme === 'light'
  })

  const [activeScheme, setActiveScheme] = useState<SchemeId>(() => {
    if (typeof document === 'undefined') return 'ink'
    const s = document.documentElement.dataset.scheme
    return SCHEMES.find((item) => item.key === s)?.key ?? 'ink'
  })

  useEffect(() => {
    const handleStorage = () => {
      const s = document.documentElement.dataset.scheme
      const found = SCHEMES.find((item) => item.key === s)
      if (found) setActiveScheme(found.key)
      setIsLight(document.documentElement.dataset.theme === 'light')
    }
    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [])

  const toggleMode = useCallback(() => {
    const root = document.documentElement
    const next = root.dataset.theme === 'light' ? 'dark' : 'light'
    root.classList.add('theme-switching')
    root.dataset.theme = next
    try {
      localStorage.setItem('newsnook-home:theme', next)
    } catch {
      /* ignore */
    }
    window.setTimeout(() => root.classList.remove('theme-switching'), 260)
    setIsLight(next === 'light')
  }, [])

  const setScheme = useCallback((next: SchemeId) => {
    const root = document.documentElement
    root.classList.add('theme-switching')
    root.dataset.scheme = next
    try {
      localStorage.setItem('newsnook-home:scheme', next)
    } catch {
      /* ignore */
    }
    window.setTimeout(() => root.classList.remove('theme-switching'), 260)
    setActiveScheme(next)
    window.dispatchEvent(new CustomEvent('newsnook:scheme-change', { detail: { scheme: next } }))
  }, [])

  return { isLight, toggleMode, activeScheme, setScheme }
}

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { isLight, toggleMode, activeScheme, setScheme } = usePortalTheme()
  const [menuOpen, setMenuOpen] = useState(false)

  const currentSchemeObj = FEATURED_SCHEMES.find((s) => s.id === activeScheme) || FEATURED_SCHEMES[0]

  return (
    <div className="relative flex items-center gap-1.5">
      {/* 六款内置阅读主题，颜色取自产品演示的同一份源数据。 */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setMenuOpen(!menuOpen)}
          aria-expanded={menuOpen}
          aria-label="选择六套阅读主题"
          className="pressable flex h-8 items-center gap-1.5 rounded-full border border-haze bg-ink-raised/60 px-2.5 text-[11px] font-mono text-paper-muted transition-colors hover:border-paper-faint/40 hover:text-paper shadow-2xs"
        >
          <span
            className="h-2 w-2 rounded-full shadow-xs transition-colors"
            style={{ backgroundColor: getSchemeAccent(currentSchemeObj.id, isLight) }}
            aria-hidden="true"
          />
          <span className="font-semibold text-paper">{currentSchemeObj.name}</span>
          <ChevronDown size={11} className={`text-paper-faint transition-transform duration-200 ${menuOpen ? 'rotate-180' : ''}`} />
        </button>

        {/* 方案下拉菜单 */}
        {menuOpen && (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setMenuOpen(false)}
              aria-hidden="true"
            />
            <div className="absolute right-0 top-full z-50 mt-1.5 w-52 overflow-hidden rounded-2xl border border-haze/80 bg-ink-raised p-1.5 shadow-2xl backdrop-blur-xl">
              <div className="px-2.5 py-1.5 font-mono text-[9.5px] tracking-wider text-paper-faint">
                选择阅读主题
              </div>
              <div className="space-y-1">
                {FEATURED_SCHEMES.map((item) => {
                  const isCurrent = item.id === activeScheme
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setScheme(item.id)
                        setMenuOpen(false)
                      }}
                      className={`flex w-full items-center justify-between rounded-xl px-2.5 py-2 text-left transition-colors ${
                        isCurrent
                          ? 'bg-paper/10 text-paper font-semibold'
                          : 'text-paper-muted hover:bg-paper/5 hover:text-paper'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: getSchemeAccent(item.id, isLight) }}
                        />
                        <div className="min-w-0">
                          <div className="text-[12px] leading-tight font-display">{item.name}</div>
                          <div className="text-[9.5px] font-mono text-paper-faint truncate">{item.caption}</div>
                        </div>
                      </div>
                      {isCurrent && <Check size={12} className="text-cinnabar shrink-0 ml-1.5" strokeWidth={2.5} />}
                    </button>
                  )
                })}
              </div>
            </div>
          </>
        )}
      </div>

      {/* 昼读 / 夜读切换 */}
      <button
        type="button"
        onClick={toggleMode}
        aria-label={isLight ? '切换到夜读' : '切换到昼读'}
        className={`pressable group relative flex items-center gap-1.5 rounded-full border border-haze bg-ink-raised/60 text-paper-muted transition-colors hover:border-paper-faint/40 hover:text-paper shadow-2xs ${
          compact ? 'h-8 px-2' : 'h-8 px-2.5'
        }`}
      >
        <Sun size={12} strokeWidth={2} className={isLight ? 'text-cinnabar' : 'opacity-40'} />
        <span className="hidden font-mono text-[10px] tracking-wider sm:inline text-paper">
          {isLight ? '昼读' : '夜读'}
        </span>
        <Moon size={12} strokeWidth={2} className={!isLight ? 'text-cinnabar' : 'opacity-40'} />
      </button>
    </div>
  )
}
