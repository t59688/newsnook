import { useState } from 'react'
import { PhoneFrame } from '../components/app/PhoneFrame'
import { ReaderDemo } from '../components/app/ReaderDemo'
import { SegmentedControl } from '../components/app/SegmentedControl'
import { Section } from './Section'

/* 站内全文区块：真实阅读器 + 排版控制台（TypographyScreen 同款分段器），
 * 控制项实时改写 --reader-* 变量，正文当场重排。 */
export function ReaderSection() {
  const [scale, setScale] = useState(1)
  const [line, setLine] = useState(1.9)
  const [family, setFamily] = useState<'sans' | 'serif' | 'system'>('sans')

  const vars = {
    ['--reader-font-size' as string]: `${(15.5 * scale).toFixed(2)}px`,
    ['--reader-line-height' as string]: String(line),
    ['--reader-font-family' as string]: `var(--font-reader-${family})`,
  } as React.CSSProperties

  return (
    <Section
      id="reader"
      kicker="站内全文"
      title={
        <>
          打开条目，就在应用内
          <br />
          纯净读完。
        </>
      }
      desc="Readability 与站点定制解析器当场抽取正文与高清大图，过滤一切弹窗与广告，按你的排版偏好重新落地。「打开原文」只是错误态的次要兜底，不是默认阅读方式。调节右侧控制项，实时驱动左侧真机。"
      points={[
        '字号 5 档微调 · 行高 3 档 · 黑体 / 宋体 / 系统字体',
        '中文首行缩进切换 · 译文段落下插对比 · 渐进式图床加载',
        '毫秒级阅读位置自动记忆，再次打开无缝续读',
        '内置 TTS 语音朗读听书条与词汇长按百科速查',
      ]}
      demo={
        <div className="grid gap-5 sm:grid-cols-[250px_1fr] sm:items-center">
          <div style={vars} className="mx-auto w-full max-w-[250px]">
            <PhoneFrame className="h-[520px]" time="23:05">
              <ReaderDemo />
            </PhoneFrame>
          </div>
          <div className="space-y-3.5 rounded-2xl border border-haze bg-ink-raised/50 p-4">
            <SegmentedControl
              label="字号大小"
              value={scale}
              onChange={setScale}
              options={[
                { value: 0.88, label: '小' },
                { value: 0.94, label: '较小' },
                { value: 1, label: '标准' },
                { value: 1.1, label: '较大' },
                { value: 1.22, label: '大' },
              ]}
            />
            <SegmentedControl
              label="阅读行高"
              value={line}
              onChange={setLine}
              options={[
                { value: 1.65, label: '紧凑' },
                { value: 1.9, label: '标准' },
                { value: 2.15, label: '舒展' },
              ]}
            />
            <SegmentedControl
              label="正文字体"
              value={family}
              onChange={setFamily}
              options={[
                { value: 'sans', label: '黑体' },
                { value: 'serif', label: '宋体' },
                { value: 'system', label: '系统' },
              ]}
            />
            <div className="rounded-xl border border-haze/60 bg-ink/60 p-3 font-mono text-[10px] leading-relaxed text-paper-muted space-y-1">
              <div>✓ 与应用设置页「排版定制」同一组档位与令牌</div>
              <div>✓ 手机内部支持捏合手势缩放字号</div>
              <div>✓ 点按正文右上角「听书」即可激活悬浮朗读条</div>
            </div>
          </div>
        </div>
      }
      reverse
    />
  )
}
