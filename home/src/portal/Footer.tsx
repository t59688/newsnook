import { ArrowUpRight } from 'lucide-react'
import { BrandLogo } from '../components/app/BrandLogo'

const LINKS = [
  { label: '项目源码', href: 'https://github.com/t59688/newsnook' },
  { label: '使用指南', href: 'https://github.com/t59688/newsnook/blob/main/docs/user-guide.md' },
  { label: '在线阅读', href: 'https://news.aizeek.com' },
]

export function Footer() {
  return (
    <footer className="portal-footer border-t border-haze/50">
      <div className="page-x mx-auto flex max-w-6xl flex-col justify-between gap-8 py-12 sm:flex-row sm:items-start sm:py-16">
        <div className="max-w-sm">
          <div className="flex items-center gap-2.5 text-paper">
            <BrandLogo size={24} />
            <span className="font-display text-[20px] tracking-[-0.03em]">有所闻</span>
            <span className="ml-1 font-mono text-[10px] tracking-[0.16em] text-paper-muted">NEWSNOOK</span>
          </div>
          <p className="mt-4 text-[14px] leading-[1.85] text-paper-muted">
            一个安静的地方，容得下整个世界。
          </p>
        </div>
        <nav className="flex flex-wrap gap-x-7 gap-y-4 text-[13px] text-paper-muted" aria-label="其他资源">
          {LINKS.map(link => (
            <a
              key={link.href}
              href={link.href}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 transition-colors hover:text-paper"
            >
              {link.label}<ArrowUpRight size={13} strokeWidth={1.65} aria-hidden="true" />
            </a>
          ))}
        </nav>
      </div>

      <div className="page-x mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-haze/50 py-5 text-[11.5px] text-paper-muted">
        <span>NewsNook · 有所闻</span>
        <span>界面中的文章内容用于产品演示 · AGPL-3.0-or-later</span>
      </div>
    </footer>
  )
}
