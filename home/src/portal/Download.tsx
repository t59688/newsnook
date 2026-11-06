import { ArrowUpRight, Code2, Globe2, Smartphone } from 'lucide-react'
import { Reveal } from './Reveal'

const CLOUD_APK = 'https://news-update.aizeek.com/newsnook/beta/latest-cloud.apk'
const LOCAL_APK = 'https://news-update.aizeek.com/newsnook/beta/latest-local.apk'
const RELEASES = 'https://github.com/t59688/newsnook/releases'
const WEB = 'https://news.aizeek.com'

/** 门户尾章：安装选择按读者的需要排列，而不是三张等权功能卡。 */
export function Download() {
  return (
    <section id="download" className="portal-download">
      <div className="page-x mx-auto max-w-6xl">
        <Reveal className="portal-download-header">
          <p className="portal-overline">
            <span className="portal-overline-mark" aria-hidden="true" />
            从这里，开始阅读
          </p>
          <h2>让世界更近一点。<br />让阅读更自由一点。</h2>
          <p className="mt-6 max-w-[37rem] text-[15px] leading-[1.85] text-paper-muted">
            不必建立账户，也不必改变自己的阅读习惯。选一个适合你的版本，打开有所闻。
          </p>
        </Reveal>

        <div className="portal-download-choices" aria-label="选择有所闻使用方式">
          <a className="portal-download-choice pressable-card group" href={CLOUD_APK} target="_blank" rel="noreferrer">
            <div>
              <Smartphone size={22} strokeWidth={1.55} className="text-cinnabar mb-7" aria-hidden="true" />
              <h3 className="portal-download-choice-title">Android 轻量版</h3>
              <p className="portal-download-choice-meta mt-2">Cloud · Universal APK · 约 6 MB</p>
              <p className="portal-download-choice-desc">轻巧安装，即刻开始。适合日常阅读与在线翻译。</p>
            </div>
            <span className="portal-download-choice-bottom">
              下载轻量版 <ArrowUpRight size={18} strokeWidth={1.7} aria-hidden="true" />
            </span>
          </a>

          <a className="portal-download-choice pressable-card group" href={LOCAL_APK} target="_blank" rel="noreferrer">
            <div>
              <Smartphone size={21} strokeWidth={1.55} className="text-paper-muted mb-7" aria-hidden="true" />
              <h3 className="portal-download-choice-title">Android 离线版</h3>
              <p className="portal-download-choice-meta mt-2">Local · arm64-v8a · 约 33 MB</p>
              <p className="portal-download-choice-desc">包含离线神经网络翻译组件，少一分网络依赖。</p>
            </div>
            <span className="portal-download-choice-bottom">
              下载离线版 <ArrowUpRight size={18} strokeWidth={1.7} aria-hidden="true" />
            </span>
          </a>

          <a className="portal-download-choice pressable-card group" href={WEB} target="_blank" rel="noreferrer">
            <div>
              <Globe2 size={21} strokeWidth={1.55} className="text-paper-muted mb-7" aria-hidden="true" />
              <h3 className="portal-download-choice-title">在浏览器中阅读</h3>
              <p className="portal-download-choice-meta mt-2">news.aizeek.com</p>
              <p className="portal-download-choice-desc">无需安装，从网页开始探索和阅读内容。</p>
            </div>
            <span className="portal-download-choice-bottom">
              打开网页版 <ArrowUpRight size={18} strokeWidth={1.7} aria-hidden="true" />
            </span>
          </a>
        </div>

        <Reveal delay={0.12}>
          <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3 text-[12px] leading-relaxed text-paper-muted">
            <span className="flex items-center gap-2"><Code2 size={14} strokeWidth={1.5} aria-hidden="true" />开源 · AGPL-3.0-or-later</span>
            <span>下载链接指向 Beta 最新版</span>
            <a href={RELEASES} target="_blank" rel="noreferrer" className="underline decoration-paper-faint/50 underline-offset-4 transition-colors hover:text-paper">
              在 GitHub 查看历史版本
            </a>
          </div>
        </Reveal>
      </div>
    </section>
  )
}
