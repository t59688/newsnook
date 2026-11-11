import { memo, useMemo } from 'react'
import type { Article } from '../lib/types'
import {
  getEditorialCoverConfig,
  type EditorialCoverConfig,
  type EditorialMotif,
} from '../lib/editorialCover'

interface Props {
  article: Partial<Article>
  read?: boolean
  className?: string
  showUnreadDot?: boolean
  showVideoBadge?: boolean
}

/**
 * 形式化多样的编辑期刊封面占位组件 (Editorial Procedural Cover Placeholder)
 *
 * 当文章没有配图时，根据文章 ID/标题确定性生成一张高雅、独特且形式严谨的期刊封面。
 * 解决移动端双列与桌面网格中，无图卡片高度坍缩导致排版高低参差的痛点，
 * 实现视觉高度完全对齐与人文装帧美学。
 */
export const EditorialCoverPlaceholder = memo(function EditorialCoverPlaceholder({
  article,
  read = false,
  className = 'aspect-[4/3]',
  showUnreadDot = true,
  showVideoBadge = true,
}: Props) {
  const config = useMemo(() => getEditorialCoverConfig(article), [article])
  const hasExplicitPosition = /\b(?:absolute|fixed|sticky|static)\b/.test(className)

  return (
    <span
      className={`editorial-cover-root ${hasExplicitPosition ? '' : 'relative '}block w-full select-none overflow-hidden bg-ink-deep/30 transition-[opacity,filter] duration-300 ${
        read ? 'opacity-[0.76] saturate-[0.72] contrast-[0.96]' : 'opacity-[0.98]'
      } ${className}`}
      aria-hidden="true"
    >
      <EditorialVectorScene config={config} />

      {/* 封面微型排印层：右上角期刊号 */}
      <span className="editorial-cover-tag pointer-events-none absolute right-2.5 top-2 z-10 font-mono text-[9px] font-medium tracking-[0.14em] opacity-60">
        {config.issueTag}
      </span>

      {/* 封面微型排印层：左下角信源刊印水印 */}
      <span className="editorial-cover-watermark pointer-events-none absolute bottom-2 left-2.5 z-10 flex items-center gap-1 font-mono text-[8.5px] tracking-[0.12em] opacity-50">
        <span className="inline-block h-1 w-1 rounded-full bg-current opacity-70" />
        <span className="truncate max-w-[105px]">{config.imprintLabel}</span>
      </span>

      {/* 未读朱砂圆点（与常规图片封面位置与投影完全对齐） */}
      {!read && showUnreadDot && (
        <span
          className="absolute left-2 top-2 z-20 h-1.5 w-1.5 rounded-full bg-cinnabar shadow-[0_0_0_2px_rgb(var(--tone-ink-rgb)/0.66)]"
          aria-label="未读"
        />
      )}

      {/* 视频类型角标 */}
      {article.contentType === 'video' && showVideoBadge && (
        <span className="absolute bottom-2 right-2 z-20 rounded-full border border-white/12 bg-black/55 px-1.5 py-0.5 font-mono text-[9px] tracking-[0.08em] text-white/85 backdrop-blur-sm">
          视频
        </span>
      )}
    </span>
  )
})

interface VectorSceneProps {
  config: EditorialCoverConfig
}

/** 纯矢量场景：响应昼夜主题与墨水屏，0 外部图片依赖，100% 离线与矢量锐利 */
const EditorialVectorScene = memo(function EditorialVectorScene({ config }: VectorSceneProps) {
  const { palette, motif, gradientAngle, seed } = config
  const patternId = `ec-p-${seed}`
  const gradId = `ec-g-${seed}`
  const radialId = `ec-r-${seed}`

  return (
    <svg
      viewBox="0 0 240 180"
      preserveAspectRatio="xMidYMid slice"
      className="editorial-scene-svg h-full w-full"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        {/* 深色模式背景线性渐变 */}
        <linearGradient id={`${gradId}-dark`} gradientTransform={`rotate(${gradientAngle})`}>
          <stop offset="0%" stopColor={palette.dark.bgStart} />
          <stop offset="100%" stopColor={palette.dark.bgEnd} />
        </linearGradient>

        {/* 浅色模式背景线性渐变 */}
        <linearGradient id={`${gradId}-light`} gradientTransform={`rotate(${gradientAngle})`}>
          <stop offset="0%" stopColor={palette.light.bgStart} />
          <stop offset="100%" stopColor={palette.light.bgEnd} />
        </linearGradient>

        {/* 柔光径向渐变（天体与包豪斯光晕） */}
        <radialGradient id={radialId} cx="55%" cy="45%" r="65%">
          <stop offset="0%" stopColor="var(--ec-accent, currentColor)" stopOpacity="0.22" />
          <stop offset="100%" stopColor="var(--ec-accent, currentColor)" stopOpacity="0" />
        </radialGradient>

        {/* 纸质微网格点阵 (Subtle Matrix) */}
        <pattern id={patternId} width="16" height="16" patternUnits="userSpaceOnUse">
          <circle cx="8" cy="8" r="0.65" fill="var(--ec-line-subtle, rgba(255,255,255,0.08))" />
        </pattern>
      </defs>

      {/* 动态主题 CSS 变量绑定：昼夜无缝切换，墨水屏自动纯化 */}
      <style>{`
        .editorial-scene-svg {
          --ec-bg-grad: url(#${gradId}-dark);
          --ec-accent: ${palette.dark.accent};
          --ec-accent-soft: ${palette.dark.accentSoft};
          --ec-line: ${palette.dark.line};
          --ec-line-subtle: ${palette.dark.lineSubtle};
          --ec-text: ${palette.dark.text};
        }
        :root[data-theme='light'] .editorial-scene-svg,
        [data-theme='light'] .editorial-scene-svg {
          --ec-bg-grad: url(#${gradId}-light);
          --ec-accent: ${palette.light.accent};
          --ec-accent-soft: ${palette.light.accentSoft};
          --ec-line: ${palette.light.line};
          --ec-line-subtle: ${palette.light.lineSubtle};
          --ec-text: ${palette.light.text};
        }
        [data-eink] .editorial-scene-svg {
          --ec-bg-grad: #ffffff;
          --ec-accent: #000000;
          --ec-accent-soft: #000000;
          --ec-line: rgba(0, 0, 0, 0.45);
          --ec-line-subtle: rgba(0, 0, 0, 0.15);
          --ec-text: #000000;
        }
        [data-eink] .editorial-cover-root {
          background-color: #ffffff !important;
          border-color: rgba(0,0,0,0.6) !important;
        }
        [data-eink] .editorial-cover-tag,
        [data-eink] .editorial-cover-watermark {
          color: #000000 !important;
          opacity: 0.9 !important;
        }
      `}</style>

      {/* 渐变底图 */}
      <rect width="240" height="180" fill="var(--ec-bg-grad)" />

      {/* 微弱纸感点阵层 */}
      <rect width="240" height="180" fill={`url(#${patternId})`} />

      {/* 居中偏右的漫反射光晕 */}
      <rect width="240" height="180" fill={`url(#${radialId})`} />

      {/* 核心形式美学图形渲染 */}
      <MotifGraphics motif={motif} config={config} />
    </svg>
  )
})

interface MotifGraphicsProps {
  motif: EditorialMotif
  config: EditorialCoverConfig
}

/** 8 大形式美学原型组件分发 */
const MotifGraphics = memo(function MotifGraphics({ motif, config }: MotifGraphicsProps) {
  switch (motif) {
    case 'seal':
      return <SealMotif config={config} />
    case 'celestial':
      return <CelestialMotif config={config} />
    case 'grid-swiss':
      return <GridSwissMotif config={config} />
    case 'waves':
      return <WavesMotif config={config} />
    case 'bauhaus':
      return <BauhausMotif config={config} />
    case 'fluted':
      return <FlutedMotif config={config} />
    case 'halftone':
      return <HalftoneMotif config={config} />
    case 'bookplate':
      return <BookplateMotif config={config} />
    default:
      return <SealMotif config={config} />
  }
})

/** Motif 1: 金石朱印 · Classical Seal Monogram */
function SealMotif({ config }: { config: EditorialCoverConfig }) {
  const { monogram } = config
  return (
    <g>
      {/* 45 度微细背景斜纹水印 */}
      <line x1="20" y1="160" x2="220" y2="20" stroke="var(--ec-line-subtle)" strokeWidth="0.75" />
      <line x1="40" y1="170" x2="230" y2="30" stroke="var(--ec-line-subtle)" strokeWidth="0.5" strokeDasharray="3,3" />

      {/* 四角金石界线规（Corner registration marks） */}
      <path d="M 28,34 L 28,24 L 38,24" fill="none" stroke="var(--ec-line)" strokeWidth="0.8" />
      <path d="M 212,34 L 212,24 L 202,24" fill="none" stroke="var(--ec-line)" strokeWidth="0.8" />
      <path d="M 28,146 L 28,156 L 38,156" fill="none" stroke="var(--ec-line)" strokeWidth="0.8" />
      <path d="M 212,146 L 212,156 L 202,156" fill="none" stroke="var(--ec-line)" strokeWidth="0.8" />

      {/* 外围金石方环 */}
      <rect
        x="88"
        y="58"
        width="64"
        height="64"
        rx="8"
        fill="none"
        stroke="var(--ec-line)"
        strokeWidth="0.75"
      />
      {/* 内部微印倒角框 */}
      <rect
        x="93"
        y="63"
        width="54"
        height="54"
        rx="5"
        fill="var(--ec-accent-soft)"
        fillOpacity="0.18"
        stroke="var(--ec-accent)"
        strokeWidth="1.2"
      />

      {/* 衬线宋体核心印字（严格对齐几何中心 120, 90） */}
      <text
        x="120"
        y="90"
        textAnchor="middle"
        dominantBaseline="central"
        fill="var(--ec-text)"
        fontSize="28"
        fontFamily="var(--font-display), 'Noto Serif SC', serif"
        fontWeight="600"
        letterSpacing="0"
      >
        {monogram}
      </text>

      {/* 印章下方小号题记 */}
      <text
        x="120"
        y="134"
        textAnchor="middle"
        fill="var(--ec-accent)"
        fontSize="7.5"
        fontFamily="var(--font-mono), monospace"
        letterSpacing="0.22em"
        opacity="0.85"
      >
        IMPRINT // 墨印
      </text>
    </g>
  )
}

/** Motif 2: 天体星轨 · Celestial Orbitals */
function CelestialMotif({ config }: { config: EditorialCoverConfig }) {
  const cx = 132
  const cy = 84

  return (
    <g>
      {/* 穿透画面的 30° 切线 */}
      <line x1="25" y1="160" x2="225" y2="25" stroke="var(--ec-line-subtle)" strokeWidth="0.75" />

      {/* 多重天体轨道 */}
      <circle cx={cx} cy={cy} r="64" fill="none" stroke="var(--ec-line-subtle)" strokeWidth="0.75" />
      <circle cx={cx} cy={cy} r="46" fill="none" stroke="var(--ec-line)" strokeWidth="0.9" strokeDasharray="3,3" />
      <circle cx={cx} cy={cy} r="26" fill="none" stroke="var(--ec-accent)" strokeWidth="1.1" />

      {/* 轨道交点上的发光星芒 */}
      <circle cx={cx + 32} cy={cy - 33} r="4" fill="var(--ec-accent)" />
      <circle cx={cx + 32} cy={cy - 33} r="7.5" fill="none" stroke="var(--ec-accent)" strokeWidth="0.6" strokeDasharray="2,2" />

      {/* 中心恒星与极细经纬 */}
      <circle cx={cx} cy={cy} r="3" fill="var(--ec-text)" />
      <line x1={cx - 10} y1={cy} x2={cx + 10} y2={cy} stroke="var(--ec-line)" strokeWidth="0.75" />
      <line x1={cx} y1={cy - 10} x2={cx} y2={cy + 10} stroke="var(--ec-line)" strokeWidth="0.75" />

      {/* 悬浮副标刻度 */}
      <text
        x="42"
        y="142"
        fill="var(--ec-accent)"
        fontSize="8"
        fontFamily="var(--font-mono), monospace"
        letterSpacing="0.18em"
        opacity="0.8"
      >
        {config.volumeTag} · ORBIT
      </text>
    </g>
  )
}

/** Motif 3: 瑞士精密网格 · Swiss Typographic Grid */
function GridSwissMotif({ config }: { config: EditorialCoverConfig }) {
  return (
    <g>
      {/* 背景 24px 精密辅助格线 */}
      {[44, 68, 92, 116, 140].map((y) => (
        <line key={`h-${y}`} x1="20" y1={y} x2="220" y2={y} stroke="var(--ec-line-subtle)" strokeWidth="0.5" />
      ))}
      {[44, 76, 108, 140, 172, 204].map((x) => (
        <line key={`v-${x}`} x1={x} y1="36" x2={x} y2="148" stroke="var(--ec-line-subtle)" strokeWidth="0.5" />
      ))}

      {/* 顶部标尺与刻度齿 */}
      <line x1="24" y1="36" x2="216" y2="36" stroke="var(--ec-line)" strokeWidth="0.8" />
      {Array.from({ length: 17 }).map((_, i) => (
        <line
          key={`tick-${i}`}
          x1={24 + i * 12}
          y1="36"
          x2={24 + i * 12}
          y2={i % 4 === 0 ? "42" : "39"}
          stroke="var(--ec-line)"
          strokeWidth="0.75"
        />
      ))}

      {/* 中心 45 度菱形与十字游标 */}
      <polygon
        points="120,60 148,88 120,116 92,88"
        fill="var(--ec-accent-soft)"
        fillOpacity="0.2"
        stroke="var(--ec-accent)"
        strokeWidth="1.2"
      />
      <circle cx="120" cy="88" r="4.5" fill="none" stroke="var(--ec-text)" strokeWidth="1" />
      <line x1="104" y1="88" x2="136" y2="88" stroke="var(--ec-line)" strokeWidth="0.6" />
      <line x1="120" y1="72" x2="120" y2="104" stroke="var(--ec-line)" strokeWidth="0.6" />

      {/* 坐标记号 */}
      <text
        x="120"
        y="138"
        textAnchor="middle"
        fill="var(--ec-text)"
        fontSize="7.5"
        fontFamily="var(--font-mono), monospace"
        letterSpacing="0.2em"
        opacity="0.85"
      >
        [ SYS // {config.volumeTag} ]
      </text>
    </g>
  )
}

/** Motif 4: 水墨等高线 · Topographic Ink Waves */
function WavesMotif({ config }: { config: EditorialCoverConfig }) {
  return (
    <g>
      {/* 3 条起伏平缓的贝塞尔流线 */}
      <path
        d="M 16,68 C 65,42 105,92 160,62 C 190,46 215,66 224,60"
        fill="none"
        stroke="var(--ec-line-subtle)"
        strokeWidth="1.2"
      />
      <path
        d="M 16,92 C 60,66 110,118 165,82 C 195,62 215,86 224,80"
        fill="none"
        stroke="var(--ec-accent)"
        strokeWidth="1.4"
      />
      <path
        d="M 16,116 C 55,90 115,142 170,102 C 198,82 218,106 224,100"
        fill="none"
        stroke="var(--ec-line)"
        strokeWidth="0.9"
        strokeDasharray="4,4"
      />

      {/* 散布在谷峰的墨滴/星尘 */}
      <circle cx="95" cy="62" r="2.5" fill="var(--ec-accent)" />
      <circle cx="145" cy="116" r="1.8" fill="var(--ec-text)" />
      <circle cx="188" cy="72" r="2" fill="var(--ec-line)" />

      {/* 左侧垂直微型指示标与文本 */}
      <line x1="28" y1="52" x2="28" y2="132" stroke="var(--ec-line-subtle)" strokeWidth="0.75" />
      <circle cx="28" cy="92" r="3" fill="none" stroke="var(--ec-accent)" strokeWidth="0.8" />
      <text
        x="195"
        y="140"
        textAnchor="end"
        fill="var(--ec-accent)"
        fontSize="7.5"
        fontFamily="var(--font-mono), monospace"
        letterSpacing="0.16em"
        opacity="0.8"
      >
        {config.volumeTag} · WAVE
      </text>
    </g>
  )
}

/** Motif 5: 包豪斯构成 · Bauhaus Abstract Harmony */
function BauhausMotif({ config }: { config: EditorialCoverConfig }) {
  return (
    <g>
      {/* 左侧半圆拱门 */}
      <path
        d="M 70,122 A 36,36 0 0,1 142,122 Z"
        fill="var(--ec-accent-soft)"
        fillOpacity="0.22"
        stroke="var(--ec-accent)"
        strokeWidth="1"
      />

      {/* 倾斜悬浮的细方框 */}
      <rect
        x="122"
        y="46"
        width="44"
        height="44"
        transform="rotate(18 144 68)"
        fill="none"
        stroke="var(--ec-line)"
        strokeWidth="1"
      />

      {/* 纯粹的实心几何圆与贯通线 */}
      <circle cx="148" cy="74" r="7" fill="var(--ec-accent)" />
      <line x1="24" y1="122" x2="216" y2="122" stroke="var(--ec-line)" strokeWidth="0.8" />

      {/* 右侧微型构图文字 */}
      <text
        x="195"
        y="114"
        textAnchor="end"
        fill="var(--ec-text)"
        fontSize="7.5"
        fontFamily="var(--font-mono), monospace"
        letterSpacing="0.16em"
        opacity="0.8"
      >
        FORM // {config.volumeTag}
      </text>
    </g>
  )
}

/** Motif 6: 建筑光栅柱镜 · Architectural Fluted Louver */
function FlutedMotif({ config }: { config: EditorialCoverConfig }) {
  const { monogram } = config
  return (
    <g>
      {/* 渐变菲涅尔竖纹列阵（中疏边密） */}
      {[36, 52, 70, 90, 112, 136, 158, 178, 194, 206].map((x) => (
        <line
          key={`louver-${x}`}
          x1={x}
          y1="34"
          x2={x}
          y2="148"
          stroke="var(--ec-line)"
          strokeWidth="0.85"
        />
      ))}

      {/* 中心透光圆形镂空 */}
      <circle cx="120" cy="90" r="32" fill="var(--ec-bg-grad)" stroke="var(--ec-accent)" strokeWidth="1.2" />

      {/* 镂空内部的精致字母（严格对齐圆心 120, 90） */}
      <text
        x="120"
        y="90"
        textAnchor="middle"
        dominantBaseline="central"
        fill="var(--ec-text)"
        fontSize="22"
        fontFamily="var(--font-display), 'Noto Serif SC', serif"
        fontWeight="600"
      >
        {monogram}
      </text>

      <circle cx="120" cy="90" r="26" fill="none" stroke="var(--ec-line-subtle)" strokeWidth="0.6" strokeDasharray="2,2" />
    </g>
  )
}

/** Motif 7: 丝网星尘 · Stardust Halftone Matrix */
function HalftoneMotif({ config }: { config: EditorialCoverConfig }) {
  return (
    <g>
      {/* 5x5 微型网点阵列（半径由外至内渐变） */}
      {[-2, -1, 0, 1, 2].map((row) =>
        [-2, -1, 0, 1, 2].map((col) => {
          const dist = Math.sqrt(row * row + col * col)
          const r = Math.max(0.7, 3.2 - dist * 0.8)
          return (
            <circle
              key={`dot-${row}-${col}`}
              cx={120 + col * 16}
              cy={90 + row * 16}
              r={r}
              fill="var(--ec-accent)"
              opacity={Math.max(0.2, 0.9 - dist * 0.2)}
            />
          )
        }),
      )}

      {/* 阶梯状 45 度引导线与微型星标 */}
      <path
        d="M 52,142 L 52,90 L 104,90 L 104,38 L 188,38"
        fill="none"
        stroke="var(--ec-line)"
        strokeWidth="0.8"
      />
      <circle cx="188" cy="38" r="2.5" fill="var(--ec-text)" />

      {/* 右下方十字光芒与文本 */}
      <path
        d="M 188,124 L 188,140 M 180,132 L 196,132"
        stroke="var(--ec-accent)"
        strokeWidth="1"
      />
      <text
        x="52"
        y="154"
        fill="var(--ec-text)"
        fontSize="7.5"
        fontFamily="var(--font-mono), monospace"
        letterSpacing="0.16em"
        opacity="0.8"
      >
        {config.issueTag} · MATRIX
      </text>
    </g>
  )
}

/** Motif 8: 典雅藏书票 · Ex Libris Bookplate */
function BookplateMotif({ config }: { config: EditorialCoverConfig }) {
  const { monogram } = config
  return (
    <g>
      {/* 外圈精细双线装饰边框 */}
      <rect x="26" y="24" width="188" height="132" fill="none" stroke="var(--ec-line)" strokeWidth="0.75" />
      <rect x="31" y="29" width="178" height="122" fill="none" stroke="var(--ec-line-subtle)" strokeWidth="0.5" />

      {/* 四角古典花角折线 */}
      {[[26, 24], [214, 24], [26, 156], [214, 156]].map(([x, y], i) => (
        <circle key={`corner-${i}`} cx={x} cy={y} r="2.5" fill="var(--ec-accent)" />
      ))}

      {/* 顶部古典标题条 */}
      <text
        x="120"
        y="46"
        textAnchor="middle"
        fill="var(--ec-accent)"
        fontSize="7"
        fontFamily="var(--font-mono), monospace"
        letterSpacing="0.28em"
        opacity="0.9"
      >
        EX LIBRIS // 藏书志
      </text>

      {/* 中心菱形双线勋标 */}
      <polygon
        points="120,62 144,90 120,118 96,90"
        fill="var(--ec-accent-soft)"
        fillOpacity="0.18"
        stroke="var(--ec-accent)"
        strokeWidth="1.1"
      />

      {/* 核心字标（严格对齐菱形勋标中心 120, 90） */}
      <text
        x="120"
        y="90"
        textAnchor="middle"
        dominantBaseline="central"
        fill="var(--ec-text)"
        fontSize="20"
        fontFamily="var(--font-display), 'Noto Serif SC', serif"
        fontWeight="600"
      >
        {monogram}
      </text>

      {/* 底部编目信息 */}
      <text
        x="120"
        y="140"
        textAnchor="middle"
        fill="var(--ec-text)"
        fontSize="7.5"
        fontFamily="var(--font-mono), monospace"
        letterSpacing="0.16em"
        opacity="0.75"
      >
        {config.issueTag} · CHRONICLE
      </text>
    </g>
  )
}
