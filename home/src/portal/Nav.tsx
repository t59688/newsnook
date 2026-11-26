import { useEffect, useState } from 'react'
import { motion, useMotionValueEvent, useReducedMotion, useScroll } from 'framer-motion'
import { ArrowUpRight } from 'lucide-react'
import { BrandLogo } from '../components/app/BrandLogo'
import { ThemeToggle } from './ThemeToggle'

const NAV_LINKS = [
  { href: '#feed', label: '产品体验' },
  { href: '#reader', label: '沉浸阅读' },
  { href: '#store', label: '发现内容' },
  { href: '#browser', label: '内置浏览器' },
  { href: '#workspaces', label: '更多能力' },
]

export function Nav() {
  const reduced = useReducedMotion()
  const { scrollY } = useScroll()
  const [solid, setSolid] = useState(false)
  const [activeSection, setActiveSection] = useState('')

  useMotionValueEvent(scrollY, 'change', (y) => setSolid(y > 24))

  useEffect(() => {
    const update = () => {
      const cutoff = window.scrollY + 168
      let current = ''
      for (const link of NAV_LINKS) {
        const node = document.getElementById(link.href.slice(1))
        if (node && node.getBoundingClientRect().top + window.scrollY <= cutoff) current = link.href
      }
      setActiveSection(current)
    }
    update()
    window.addEventListener('scroll', update, { passive: true })
    return () => window.removeEventListener('scroll', update)
  }, [])

  return (
    <motion.header
      initial={reduced ? false : { y: -32, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.52, ease: [0.22, 1, 0.36, 1] }}
      className={solid ? 'portal-nav is-scrolled' : 'portal-nav'}
    >
      <div className="portal-nav-inner page-x mx-auto flex max-w-6xl items-center justify-between">
        <a href="#top" className="portal-brand group" aria-label="有所闻首页">
          <span className="portal-brand-mark"><BrandLogo size={24} /></span>
          <span className="portal-brand-name">有所闻</span>
          <span className="portal-brand-sub">NEWSNOOK</span>
        </a>

        <nav className="portal-nav-links" aria-label="页面主要栏目">
          {NAV_LINKS.map((link) => (
            <a
              href={link.href}
              key={link.href}
              aria-current={activeSection === link.href ? 'location' : undefined}
              className={activeSection === link.href ? 'is-active' : undefined}
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="portal-nav-actions">
          <ThemeToggle compact />
          <a className="portal-nav-download pressable" href="#download">
            下载应用 <ArrowUpRight size={14} strokeWidth={1.75} aria-hidden="true" />
          </a>
        </div>
      </div>
    </motion.header>
  )
}
