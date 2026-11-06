import { motion, useMotionValueEvent, useScroll } from 'framer-motion'
import { useState, useEffect } from 'react'
import { ThemeToggle } from './ThemeToggle'

const NAV_LINKS = [
  { href: '#feed', label: '速闻' },
  { href: '#presets', label: '预设' },
  { href: '#reader', label: '阅读' },
  { href: '#speedread', label: '速读' },
  { href: '#search', label: '搜索' },
  { href: '#store', label: '订阅' },
  { href: '#appearance', label: '外观' },
  { href: '#browser', label: '浏览器' },
  { href: '#cms', label: 'CMS' },
  { href: '#eink', label: '墨水屏' },
  { href: '#recommend', label: '推荐' },
  { href: '#sync', label: '同步' },
  { href: '#media', label: '媒体' },
  { href: '#workspaces', label: '工作区' },
]

export function Nav() {
  const { scrollY } = useScroll()
  const [solid, setSolid] = useState(false)
  const [activeSection, setActiveSection] = useState('feed')

  useMotionValueEvent(scrollY, 'change', (y) => setSolid(y > 20))

  useEffect(() => {
    const handleScroll = () => {
      const scrollPos = window.scrollY + 160
      for (let i = NAV_LINKS.length - 1; i >= 0; i--) {
        const id = NAV_LINKS[i].href.slice(1)
        const el = document.getElementById(id)
        if (el && el.offsetTop <= scrollPos) {
          setActiveSection(id)
          return
        }
      }
      setActiveSection('')
    }

    window.addEventListener('scroll', handleScroll, { passive: true })
    handleScroll()
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  return (
    <motion.header
      initial={{ y: -56, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      className={`fixed inset-x-0 top-0 z-50 transition-colors duration-300 ${
        solid
          ? 'border-b border-haze/60 bg-ink/90 backdrop-blur-xl shadow-md'
          : 'border-b border-transparent bg-transparent'
      }`}
    >
      <div className="page-x mx-auto flex h-14 max-w-6xl items-center justify-between gap-3">
        {/* 品牌 Logo */}
        <a href="#top" className="flex items-center gap-2 group shrink-0" aria-label="有所闻首页">
          <span className="h-2 w-2 rounded-full bg-cinnabar shadow-[0_0_10px_rgb(var(--tone-cinnabar-rgb)/0.6)]" aria-hidden />
          <span className="font-display text-[16px] tracking-[0.04em] text-paper group-hover:text-cinnabar transition-colors">
            有所闻
          </span>
          <span className="hidden font-mono text-[9.5px] tracking-[0.16em] text-paper-muted sm:inline">
            NEWSNOOK
          </span>
        </a>

        {/* 导航锚点 */}
        <nav
          className="hidden items-center gap-0.5 xl:flex overflow-x-auto scroll-hidden py-1"
          aria-label="页面导航"
        >
          {NAV_LINKS.map((l) => {
            const isActive = activeSection === l.href.slice(1)
            return (
              <a
                key={l.href}
                href={l.href}
                className={`relative rounded-full px-2.5 py-1 font-mono text-[10.5px] tracking-[0.06em] transition-colors ${
                  isActive
                    ? 'font-bold text-cinnabar-soft bg-cinnabar/15'
                    : 'text-paper-muted hover:bg-paper/5 hover:text-paper'
                }`}
              >
                {l.label}
              </a>
            )
          })}
        </nav>

        {/* 快捷动作 */}
        <div className="flex items-center gap-2 shrink-0">
          <ThemeToggle compact />
          <a
            href="#download"
            className="pressable flex h-8 items-center rounded-full border border-cinnabar bg-cinnabar px-3.5 font-mono text-[11px] font-bold text-ink-deep transition-all hover:bg-cinnabar-soft shadow-sm"
          >
            下载 App
          </a>
        </div>
      </div>
    </motion.header>
  )
}
