import { useEffect } from 'react'
import { Nav } from './portal/Nav'
import { HeroScroll } from './heroes/HeroScroll'
import { NarrativeShowcase } from './portal/NarrativeShowcase'
import { Download } from './portal/Download'
import { Footer } from './portal/Footer'

export default function App() {
  useEffect(() => {
    const target = new URLSearchParams(window.location.search).get('goto')
    if (target) {
      const el = document.getElementById(target)
      if (el) {
        const y = el.getBoundingClientRect().top + window.scrollY - 70
        window.scrollTo({ top: y, behavior: 'auto' })
      }
    }
  }, [])

  return (
    <div className="ink-grain min-h-dvh bg-ink-deep text-paper selection:bg-cinnabar/30 selection:text-paper">
      <Nav />
      <main>
        {/* 首屏导引与真机交互 */}
        <HeroScroll />

        {/* 叙事主线：宽屏右侧吸顶固定手机，左侧章节滚动驱动界面切换；窄屏每章内嵌真机 */}
        <NarrativeShowcase />

        {/* 发版与下载 */}
        <Download />
      </main>
      <Footer />
    </div>
  )
}
