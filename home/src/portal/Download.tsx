import { ArrowUpRight, Code2, Globe, Smartphone } from 'lucide-react'
import { Reveal } from './Reveal'

const CLOUD_APK = 'https://news-update.aizeek.com/newsnook/beta/latest-cloud.apk'
const LOCAL_APK = 'https://news-update.aizeek.com/newsnook/beta/latest-local.apk'
const RELEASES = 'https://github.com/t59688/newsnook/releases'
const WEB = 'https://news.aizeek.com'

/* 下载区：两个真实变体（大小取自 README 实测）+ Web 版。 */
export function Download() {
  return (
    <section id="download" className="relative py-24 sm:py-32">
      <div className="page-x mx-auto max-w-6xl">
        <Reveal>
          <p className="flex items-center gap-2 font-mono text-[10.5px] tracking-[0.22em] text-paper-muted">
            <span className="h-px w-6 bg-cinnabar" aria-hidden />
            开始读
          </p>
          <h2 className="mt-4 max-w-[22ch] font-display text-[clamp(2rem,4.6vw,3.2rem)] leading-[1.25] text-paper">
            装好就有今天的新闻，
            <br />
            <span className="text-cinnabar-soft">不必告诉任何人你是谁。</span>
          </h2>
        </Reveal>

        <div className="mt-10 grid gap-4 md:grid-cols-3">
          <Reveal delay={0.05}>
            <a
              href={CLOUD_APK}
              target="_blank"
              rel="noreferrer"
              className="group pressable-card flex h-full flex-col justify-between rounded-2xl border border-cinnabar/50 bg-cinnabar/10 p-6 transition-colors hover:bg-cinnabar/15"
            >
              <div>
                <div className="flex items-center justify-between">
                  <Smartphone size={21} strokeWidth={1.7} className="text-cinnabar" />
                  <ArrowUpRight size={16} strokeWidth={1.7} className="text-cinnabar-soft transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                </div>
                <p className="mt-4 font-display text-[19px] text-paper">轻量版 Cloud</p>
                <p className="mt-1 font-mono text-[10.5px] tracking-[0.08em] text-paper-muted">Universal APK · ~6 MB</p>
                <p className="mt-3 text-[12.5px] leading-[1.75] text-paper-muted">
                  极致轻巧；在线翻译引擎与 OpenAI 兼容模型翻译。
                </p>
              </div>
              <p className="mt-5 font-mono text-[11px] text-cinnabar-soft">latest-cloud.apk →</p>
            </a>
          </Reveal>

          <Reveal delay={0.12}>
            <a
              href={LOCAL_APK}
              target="_blank"
              rel="noreferrer"
              className="group pressable-card flex h-full flex-col justify-between rounded-2xl border border-haze bg-ink-raised/50 p-6 transition-colors hover:border-paper-faint/40"
            >
              <div>
                <div className="flex items-center justify-between">
                  <Smartphone size={21} strokeWidth={1.7} className="text-paper-muted" />
                  <ArrowUpRight size={16} strokeWidth={1.7} className="text-paper-faint transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                </div>
                <p className="mt-4 font-display text-[19px] text-paper">完整版 Local</p>
                <p className="mt-1 font-mono text-[10.5px] tracking-[0.08em] text-paper-muted">arm64-v8a · ~33 MB</p>
                <p className="mt-3 text-[12.5px] leading-[1.75] text-paper-muted">
                  内置 ML Kit 与 Bergamot 离线神经网络翻译，完全离线可用。
                </p>
              </div>
              <p className="mt-5 font-mono text-[11px] text-paper-muted">latest-local.apk →</p>
            </a>
          </Reveal>

          <Reveal delay={0.19}>
            <a
              href={WEB}
              target="_blank"
              rel="noreferrer"
              className="group pressable-card flex h-full flex-col justify-between rounded-2xl border border-haze bg-ink-raised/50 p-6 transition-colors hover:border-paper-faint/40"
            >
              <div>
                <div className="flex items-center justify-between">
                  <Globe size={18} strokeWidth={1.7} className="text-paper-muted" />
                  <ArrowUpRight size={16} strokeWidth={1.7} className="text-paper-faint transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                </div>
                <p className="mt-4 font-display text-[19px] text-paper">Web 网页版</p>
                <p className="mt-1 font-mono text-[10.5px] tracking-[0.08em] text-paper-muted">news.aizeek.com</p>
                <p className="mt-3 text-[12.5px] leading-[1.75] text-paper-muted">
                  浏览器直接打开；分享短链在站内读全文。
                </p>
              </div>
              <p className="mt-5 font-mono text-[11px] text-paper-muted">无需安装 →</p>
            </a>
          </Reveal>
        </div>

        <Reveal delay={0.24}>
          <p className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-[10.5px] tracking-[0.1em] text-paper-muted">
            <span className="flex items-center gap-1.5">
              <Code2 size={12} strokeWidth={1.8} />
              github.com/t59688/newsnook
            </span>
            <span aria-hidden>·</span>
            <span>AGPL-3.0-or-later</span>
            <span aria-hidden>·</span>
            <span>Stable / Beta 双通道 · 应用内增量更新</span>
            <span aria-hidden>·</span>
            <a
              href={RELEASES}
              target="_blank"
              rel="noreferrer"
              className="text-paper-faint underline decoration-paper-faint/30 underline-offset-4 hover:text-paper"
            >
              GitHub Releases 历史版本 →
            </a>
          </p>
        </Reveal>
      </div>
    </section>
  )
}
