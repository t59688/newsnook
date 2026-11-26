import { motion } from 'framer-motion'
import { PhoneFrame } from '../components/app/PhoneFrame'
import { FeedDemo } from '../components/app/FeedDemo'
import { ReaderDemo } from '../components/app/ReaderDemo'
import { SCHEMES } from '../lib/demo'
import { GhostCta, PrimaryCta } from '../portal/Cta'
import { staggerParent, riseChild } from '../portal/variants'

/* 方向 C「网格拼贴」：首屏就是一张报纸版面——多个真实界面片段同时在场，
 * 没有单一主角，标题住在其中一格。 */
export function HeroC() {
  return (
    <section id="top" className="relative min-h-dvh overflow-hidden pt-14">
      {/* 报头 */}
      <div className="page-x mx-auto flex max-w-7xl items-center justify-between border-b border-haze/60 py-3 font-mono text-[10px] tracking-[0.2em] text-paper-faint">
        <span>有所闻 · NEWSNOOK</span>
        <span className="hidden sm:inline">2026 年 11 月 5 日</span>
        <span>v1.9.2 · AGPL-3.0</span>
      </div>

      <motion.div
        variants={staggerParent}
        initial="hidden"
        animate="show"
        className="page-x mx-auto grid max-w-7xl grid-cols-2 gap-3 py-6 md:grid-cols-12"
      >
        {/* 主栏：速闻界面 */}
        <motion.div variants={riseChild} className="col-span-2 md:col-span-5">
          <PhoneFrame className="h-[560px]" time="21:47">
            <FeedDemo />
          </PhoneFrame>
        </motion.div>

        {/* 标题格 */}
        <motion.div
          variants={riseChild}
          className="col-span-2 flex flex-col justify-between border-b border-haze/60 pb-6 md:col-span-4 md:border-b-0 md:border-r md:pb-0 md:pr-5"
        >
          <div>
            <p className="flex items-center gap-2 font-mono text-[10.5px] tracking-[0.22em] text-cinnabar-soft">
              <span className="h-px w-6 bg-cinnabar" aria-hidden />
              本地优先阅读客户端
            </p>
            <h1 className="mt-5 font-display text-[clamp(2.1rem,3.6vw,3.1rem)] leading-[1.25] text-paper">
              把阅读的主权，
              <br />
              放回读者手里。
            </h1>
            <p className="mt-4 text-[14px] leading-[1.85] text-paper-muted">
              订阅由你配置，列表与正文直连上游，在应用内读完。
              算法不替你决定，云不替你保管。
            </p>
          </div>
          <div className="mt-6 flex flex-wrap gap-3">
            <PrimaryCta href="#download">下载 Android 版</PrimaryCta>
            <GhostCta href="#feed">了解功能</GhostCta>
          </div>
        </motion.div>

        {/* 阅读器片段 */}
        <motion.div variants={riseChild} className="col-span-2 overflow-hidden rounded-xl border border-haze/60 md:col-span-3">
          <div className="h-[420px] md:h-[560px]">
            <ReaderDemo />
          </div>
        </motion.div>

        {/* 配色方案格 */}
        <motion.div variants={riseChild} className="col-span-1 md:col-span-3">
          <p className="font-mono text-[10px] tracking-[0.18em] text-paper-faint">六套配色 · 昼/夜</p>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {SCHEMES.map((s) => (
              <div
                key={s.key}
                className="overflow-hidden rounded-lg border border-haze/70"
                style={{ background: s.dark.ink }}
              >
                <div className="px-2 pt-2 font-display text-[11px]" style={{ color: s.dark.paper }}>
                  {s.name}
                </div>
                <div className="mt-1.5 flex items-center gap-1 px-2 pb-2">
                  <span className="h-2 w-2 rounded-full" style={{ background: s.dark.accent }} />
                  <span className="h-px flex-1" style={{ background: `${s.dark.paper}22` }} />
                </div>
              </div>
            ))}
          </div>
        </motion.div>

        {/* 墨水屏片段 */}
        <motion.div variants={riseChild} className="col-span-1 md:col-span-3" data-eink="1">
          <p className="font-mono text-[10px] tracking-[0.18em] text-paper-faint">墨水屏 · 分页阅读</p>
          <div className="mt-3 overflow-hidden rounded-xl border border-haze/70 bg-ink">
            <div className="page-x py-4">
              <span className="flex items-center gap-2 font-mono text-[9px] tracking-[0.16em] text-cinnabar-soft">
                <span className="h-px w-4 bg-cinnabar" aria-hidden />
                第 3 / 11 页
              </span>
              <p className="row-title mt-2 text-[13px] font-medium leading-[1.6] text-paper">
                回到县城的人们：一份持续十年的中部就业观察
              </p>
              <p className="mt-2 line-clamp-4 text-[11.5px] leading-[1.7] text-paper-muted">
                十年前的冬天，陈礼明从东莞的电子厂回到湖南老家时，县城能提供的岗位只有两种：工地，或者开车……
              </p>
            </div>
            <div className="flex items-center justify-between border-t border-haze/50 px-4 py-2 font-mono text-[9px] tracking-[0.14em] text-paper-faint">
              <span>← 上一页</span>
              <span>菜单</span>
              <span>下一页 →</span>
            </div>
          </div>
        </motion.div>

        {/* 分享卡 */}
        <motion.div variants={riseChild} className="col-span-2 md:col-span-3">
          <p className="font-mono text-[10px] tracking-[0.18em] text-paper-faint">零服务端分享</p>
          <article className="mt-3 overflow-hidden rounded-2xl border border-haze bg-ink-raised">
            <span className="block h-px bg-cinnabar/35" aria-hidden />
            <div className="space-y-2 px-4 py-3.5">
              <div className="flex items-center gap-2 font-mono text-[9.5px] tracking-[0.14em] text-paper-faint">
                <span className="truncate text-cinnabar-soft">澎湃·特稿</span>
                <span aria-hidden>·</span>
                <span>2 小时前</span>
              </div>
              <h3 className="line-clamp-2 font-display text-[14.5px] leading-[1.5] text-paper">
                回到县城的人们：一份持续十年的中部就业观察
              </h3>
              <div className="flex items-center gap-2.5 border-t border-haze/60 pt-2.5">
                <span className="font-display flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-cinnabar/15 text-[13px] leading-none text-cinnabar-soft">
                  闻
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[11.5px] text-paper">有所闻 · NewsNook</span>
                  <span className="mt-0.5 block truncate font-mono text-[9.5px] text-paper-faint">
                    news.aizeek.com/a/8fQ2xK
                  </span>
                </span>
              </div>
            </div>
          </article>
        </motion.div>
      </motion.div>
    </section>
  )
}
