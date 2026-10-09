import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { Capacitor } from '@capacitor/core'

import { useReducedMotion } from '../hooks/useReducedMotion'
import './StartupSplash.css'

export type SplashMode = 'full' | 'static'

/** 完整动效按 splash.html 的分镜时长编排 */
const FULL_DURATION_MS = 6000
/** 静态启动页取「新闻已整理成竖排、品牌已就位」的那一帧 */
const STATIC_FREEZE_MS = 3900
/** 日常后续启动停留时间（轻快平滑接驳） */
const STATIC_DURATION_MS = 360
const PARTICLE_COUNT = 48
/** 漩涡阶段每个粒子公转的弧度系数，越大吸入感越强 */
const VORTEX_TURNS = 2.4
/** 全部新闻线都铺开时的竖排高度占比，用来推算固定行距 */
const LINE_STACK_SPAN = 0.52
/** 顶部三分之一的线条不进入竖排，整理阶段随噪音一起散去 */
const LINE_DROP_RATIO = 1 / 3

/** 各分镜的起止时刻（毫秒），与 splash.html 的 timeline 一一对应 */
const STAGE = {
  particlesIn: [0, 700],
  vortex: [0, 2000],
  adsBurst: [2000, 2600],
  organize: [2400, 3600],
  centerLineIn: [2300, 3300],
  centerLineOut: [4550, 5050],
  collapse: [4350, 5250],
  goldOut: [5250, 5700],
} as const satisfies Record<string, readonly [number, number]>

interface SplashParticle {
  isAd: boolean
  /** 未入列的多余线条：整理阶段原地淡出，不参与竖排与最终压缩 */
  dissolves: boolean
  angle: number
  radiusX: number
  radiusY: number
  speed: number
  width: number
  height: number
  opacity: number
  lineY: number
  lineWidth: number
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0

  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 4294967296
  }
}

function createParticles(count: number): SplashParticle[] {
  const random = seededRandom(0x4e455753)
  const particles = Array.from({ length: count }, () => {
    const isAd = random() < 0.2

    return {
      isAd,
      dissolves: false,
      angle: random() * Math.PI * 2,
      radiusX: 0.12 + random() * 0.36,
      radiusY: 0.08 + random() * 0.27,
      speed: 0.55 + random() * 0.75,
      width: isAd ? 12 + random() * 25 : 18 + random() * 38,
      height: isAd ? 2 + random() * 4 : 1 + random() * 2,
      opacity: 0.38 + random() * 0.48,
      lineY: 0,
      lineWidth: 62 + random() * 72,
    }
  })

  const newsParticles = particles.filter((particle) => !particle.isAd)
  const rowGap = LINE_STACK_SPAN / Math.max(1, newsParticles.length - 1)
  const dropCount = Math.round(newsParticles.length * LINE_DROP_RATIO)

  newsParticles.slice(0, dropCount).forEach((particle) => {
    particle.dissolves = true
  })

  // 行距沿用铺满时的节奏，只是列变短，因此整体重新居中以保持构图平衡
  const stacked = newsParticles.slice(dropCount)
  const stackSpan = (stacked.length - 1) * rowGap
  stacked.forEach((particle, index) => {
    particle.lineY = index * rowGap - stackSpan / 2
  })

  return particles
}

const PARTICLES = createParticles(PARTICLE_COUNT)
const STACKED_PARTICLES = PARTICLES.filter((particle) => !particle.isAd && !particle.dissolves)
/** 竖排可见线条的高度占比（相对画布高度），用于静态页整体垂直居中 */
const STACK_SPAN =
  STACKED_PARTICLES.length > 1
    ? Math.max(...STACKED_PARTICLES.map((particle) => particle.lineY)) -
      Math.min(...STACKED_PARTICLES.map((particle) => particle.lineY))
    : 0
/** 静态页线条底边到品牌文案的间距 */
const STATIC_BRAND_GAP_PX = 44

/** 预烘焙坍缩阶段的 25 阶颜色查找表 (LUT)，彻底消除每帧动态拼接 rgb 字符串与 GC 压力 */
const COLLAPSE_COLOR_LUT = Array.from({ length: 25 }, (_, i) => {
  const t = i / 24
  const r = Math.round(242 + (232 - 242) * t)
  const g = Math.round(241 + (185 - 241) * t)
  const b = Math.round(238 + (77 - 238) * t)
  return `rgb(${r} ${g} ${b})`
})

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function stageProgress(elapsed: number, [start, end]: readonly [number, number]): number {
  return clamp01((elapsed - start) / (end - start))
}

function segment(value: number, start: number, end: number): number {
  return clamp01((value - start) / (end - start))
}

function easeOutCubic(value: number): number {
  return 1 - Math.pow(1 - value, 3)
}

function easeInCubic(value: number): number {
  return value * value * value
}

function easeInOutCubic(value: number): number {
  return value < 0.5
    ? 4 * value * value * value
    : 1 - Math.pow(-2 * value + 2, 3) / 2
}

function lerp(from: number, to: number, progress: number): number {
  return from + (to - from) * progress
}

function orbitPosition(
  particle: SplashParticle,
  vortex: number,
  centerX: number,
  centerY: number,
  compositionWidth: number,
  height: number,
) {
  const angle = particle.angle + vortex * particle.speed * VORTEX_TURNS
  // 半径随时间收拢，对应原型里漩涡吸入阶段
  const shrink = lerp(1, 0.82, vortex)

  return {
    x: centerX + Math.cos(angle) * particle.radiusX * shrink * compositionWidth,
    y: centerY + Math.sin(angle) * particle.radiusY * shrink * height,
    rotation: angle + Math.PI / 2,
  }
}

/** 接近水平时走无 transform 快路径，避免每粒子 save/rotate/restore */
function drawParticle(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  rotation: number,
  width: number,
  height: number,
  color: string,
  opacity: number,
): void {
  if (opacity <= 0.005 || width <= 0.5) return

  context.globalAlpha = opacity
  context.fillStyle = color

  // |sinθ| 很小 ≈ 水平短条，整理/收束阶段绝大多数帧走这里
  if (Math.abs(Math.sin(rotation)) < 0.035) {
    context.fillRect(x - width / 2, y - height / 2, width, height)
    return
  }

  context.save()
  context.translate(x, y)
  context.rotate(rotation)
  context.fillRect(-width / 2, -height / 2, width, height)
  context.restore()
}

interface Props {
  mode: SplashMode
  /** App 已就绪且启动页放完：开始淡出，交接由 BootstrapRoot 在淡出结束后卸载 */
  leaving: boolean
  onComplete: () => void
}

export function StartupSplash({ mode, leaving, onComplete }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const brandRef = useRef<HTMLDivElement>(null)
  const reducedMotion = useReducedMotion()
  const isStatic = mode === 'static' || reducedMotion
  const [nativeVisible, setNativeVisible] = useState(() => {
    if (!Capacitor.isNativePlatform()) return true
    return Boolean(
      (window as Window & { __newsnookNativeVisible?: boolean }).__newsnookNativeVisible,
    )
  })
  /**
   * 完整动效必须等 WebView 真正上屏才起跑，否则时间轴会在黑屏里空转；
   * 静态页没有时间轴，立刻画好停住即可，等待只会换来一段黑屏。
   */
  const running = isStatic || nativeVisible

  useEffect(() => {
    if (running || !Capacitor.isNativePlatform()) return

    const start = () => setNativeVisible(true)
    window.addEventListener('newsnook:native-visible', start, { once: true })
    const fallbackTimer = window.setTimeout(start, 600)

    return () => {
      window.removeEventListener('newsnook:native-visible', start)
      window.clearTimeout(fallbackTimer)
    }
  }, [running])

  // 静态页的竖排位置和品牌文案的 top 都在这里算，必须早于首帧绘制，
  // 否则文案会先按默认流位置露一帧再跳到居中位置。
  useLayoutEffect(() => {
    if (!running) return

    const canvas = canvasRef.current
    const brand = brandRef.current
    const context =
      canvas?.getContext('2d', {
        alpha: true,
        desynchronized: true,
      }) ?? null
    if (!canvas || !context) {
      const timer = window.setTimeout(onComplete, STATIC_DURATION_MS)
      return () => window.clearTimeout(timer)
    }

    let width = 0
    let height = 0
    let timelineGradient: CanvasGradient | null = null
    /** 静态页：线条区中心 Y；完整动画始终取画布中点 */
    let centerY = 0

    const layoutStatic = () => {
      const brandHeight = brand?.getBoundingClientRect().height ?? 96
      const stackHeight = STACK_SPAN * height
      const groupHeight = stackHeight + STATIC_BRAND_GAP_PX + brandHeight
      const groupTop = Math.max(0, (height - groupHeight) / 2)
      centerY = groupTop + stackHeight / 2

      if (brand) {
        brand.style.top = `${groupTop + stackHeight + STATIC_BRAND_GAP_PX}px`
        brand.style.bottom = 'auto'
      }

      const lineTop = groupTop
      const lineBottom = groupTop + stackHeight
      timelineGradient = context.createLinearGradient(0, lineTop, 0, lineBottom)
      timelineGradient.addColorStop(0, 'rgba(255,255,255,0)')
      timelineGradient.addColorStop(0.5, 'rgba(255,255,255,0.34)')
      timelineGradient.addColorStop(1, 'rgba(255,255,255,0)')
    }

    const resize = () => {
      const bounds = canvas.getBoundingClientRect()
      width = Math.max(1, bounds.width)
      height = Math.max(1, bounds.height)
      // 完整动效持续 6s，Android WebView 上 2x 像素过贵；静态页仍可用更高清
      const pixelRatio = Math.min(
        window.devicePixelRatio || 1,
        isStatic ? 2 : 1.25,
      )

      canvas.width = Math.round(width * pixelRatio)
      canvas.height = Math.round(height * pixelRatio)
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)

      if (isStatic) {
        layoutStatic()
      } else {
        centerY = height / 2
        timelineGradient = context.createLinearGradient(0, height * 0.2, 0, height * 0.7)
        timelineGradient.addColorStop(0, 'rgba(255,255,255,0)')
        timelineGradient.addColorStop(0.5, 'rgba(255,255,255,0.34)')
        timelineGradient.addColorStop(1, 'rgba(255,255,255,0)')
      }
    }

    const drawFrame = (elapsed: number) => {
      const centerX = width / 2
      const compositionWidth = Math.min(width, 460)

      const appear = easeOutCubic(stageProgress(elapsed, STAGE.particlesIn))
      const vortex = stageProgress(elapsed, STAGE.vortex)
      const adsBurst = easeInCubic(stageProgress(elapsed, STAGE.adsBurst))
      const organize = easeOutCubic(stageProgress(elapsed, STAGE.organize))
      const collapse = easeInOutCubic(stageProgress(elapsed, STAGE.collapse))
      const goldOut = easeInCubic(stageProgress(elapsed, STAGE.goldOut))
      const centerLine =
        easeOutCubic(stageProgress(elapsed, STAGE.centerLineIn)) -
        easeOutCubic(stageProgress(elapsed, STAGE.centerLineOut))

      const collapseBucket = Math.min(24, Math.max(0, (collapse * 24) | 0))
      const collapseColor = COLLAPSE_COLOR_LUT[collapseBucket]

      context.globalAlpha = 1
      context.clearRect(0, 0, width, height)

      if (timelineGradient && centerLine > 0.005) {
        const lineTop = isStatic ? centerY - (STACK_SPAN * height) / 2 : height * 0.2
        const lineHeight = isStatic ? STACK_SPAN * height : height * 0.5
        context.globalAlpha = centerLine * 0.9
        context.fillStyle = timelineGradient
        context.fillRect(centerX - 0.5, lineTop, 1, lineHeight)
        context.globalAlpha = 1
      }

      const finalWidth = Math.min(compositionWidth * 0.44, 184)

      for (let i = 0; i < PARTICLES.length; i += 1) {
        const particle = PARTICLES[i]
        const orbit = orbitPosition(
          particle,
          vortex,
          centerX,
          centerY,
          compositionWidth,
          height,
        )

        if (particle.isAd) {
          drawParticle(
            context,
            orbit.x,
            orbit.y,
            orbit.rotation + adsBurst * Math.PI,
            particle.width * (1 + adsBurst * 0.75),
            particle.height,
            '#ef4444',
            particle.opacity * appear * (1 - adsBurst),
          )
          continue
        }

        if (particle.dissolves) {
          drawParticle(
            context,
            orbit.x,
            orbit.y,
            orbit.rotation,
            particle.width,
            particle.height,
            '#f2f1ee',
            particle.opacity * appear * (1 - organize),
          )
          continue
        }

        const lineY = centerY + particle.lineY * height
        const organizedX = lerp(orbit.x, centerX, organize)
        const organizedY = lerp(orbit.y, lineY, organize)
        const organizedRotation = lerp(orbit.rotation, 0, organize)
        const organizedWidth = lerp(particle.width, particle.lineWidth, organize)

        drawParticle(
          context,
          lerp(organizedX, centerX, collapse),
          lerp(organizedY, centerY, collapse),
          lerp(organizedRotation, 0, collapse),
          lerp(organizedWidth, finalWidth, collapse) * lerp(1, 0.4, goldOut),
          lerp(particle.height, 3, collapse),
          collapseColor,
          lerp(particle.opacity * appear, 1, organize) *
            (0.9 + collapse * 0.1) *
            (1 - goldOut),
        )
      }

      const goldAlpha = segment(collapse, 0.7, 1) * (1 - goldOut)
      if (goldAlpha > 0.005) {
        const barWidth = finalWidth * lerp(1, 0.4, goldOut)
        // 用半透明加宽条替代 shadowBlur，避免 Android WebView 上昂贵的阴影光栅
        context.globalAlpha = goldAlpha * 0.35
        context.fillStyle = '#e8b94d'
        context.fillRect(centerX - barWidth / 2 - 4, centerY - 3.5, barWidth + 8, 7)
        context.globalAlpha = goldAlpha
        context.fillRect(centerX - barWidth / 2, centerY - 1.5, barWidth, 3)
        context.globalAlpha = 1
      }
    }

    resize()

    if (isStatic) {
      const redraw = () => {
        resize()
        drawFrame(STATIC_FREEZE_MS)
      }

      drawFrame(STATIC_FREEZE_MS)
      window.addEventListener('resize', redraw)
      const timer = window.setTimeout(onComplete, STATIC_DURATION_MS)

      return () => {
        window.removeEventListener('resize', redraw)
        window.clearTimeout(timer)
        if (brand) {
          brand.style.top = ''
          brand.style.bottom = ''
        }
      }
    }

    let frameId = 0
    const startTime = performance.now()

    const step = (now: number) => {
      const elapsed = now - startTime
      drawFrame(Math.min(elapsed, FULL_DURATION_MS))

      if (elapsed < FULL_DURATION_MS) {
        frameId = window.requestAnimationFrame(step)
      } else {
        onComplete()
      }
    }

    window.addEventListener('resize', resize)
    frameId = window.requestAnimationFrame(step)

    return () => {
      window.cancelAnimationFrame(frameId)
      window.removeEventListener('resize', resize)
    }
  }, [isStatic, onComplete, running])

  const className = [
    'startup-splash',
    `startup-splash--${isStatic ? 'static' : 'full'}`,
    running && 'startup-splash--running',
    leaving && 'startup-splash--leaving',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      className={className}
      role="status"
      aria-live="polite"
      aria-label="有所闻正在启动"
      onClick={isStatic ? onComplete : undefined}
      style={{ '--splash-duration': `${FULL_DURATION_MS}ms` } as CSSProperties}
    >
      <div className="startup-splash__glow" aria-hidden />
      <canvas ref={canvasRef} className="startup-splash__canvas" aria-hidden />

      <div ref={brandRef} className="startup-splash__brand" aria-hidden>
        <div className="startup-splash__title">
          有所闻 <span>·</span> 阅读工具
        </div>
        <div className="startup-splash__subtitle">有所闻 有所不闻</div>
      </div>
    </div>
  )
}
