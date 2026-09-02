export interface SpeedReadImageInput {
  articleTitle: string
  sourceName: string
  model?: string
  markdown: string
}

type BlockType = 'bullet' | 'paragraph'

interface ContentBlock {
  type: BlockType
  text: string
}

interface Section {
  title: string
  blocks: ContentBlock[]
  highlight?: boolean
}

interface TextLine {
  text: string
  x: number
  y: number
  font: string
  color: string
  drawBullet?: boolean
}

interface SectionLayout {
  title: string
  highlight: boolean
  boxY: number
  boxHeight: number
  titleY: number
  lines: TextLine[]
}

interface CardLayout {
  height: number
  titleLines: TextLine[]
  metaDividerY: number
  sections: SectionLayout[]
  footerY: number
}

const WIDTH = 1080
const OUTER_PAD = 40
const CARD_X = 40
const CARD_W = WIDTH - CARD_X * 2
const CARD_PAD = 44
const INNER_W = CARD_W - CARD_PAD * 2
const FOOTER_H = 120
const CARD_TOP = OUTER_PAD

const TYPE = {
  title: 40,
  titleLine: 62,
  sectionLabel: 22,
  body: 32,
  highlight: 36,
  meta: 17,
  bulletLine: 52,
  bodyLine: 56,
  highlightLine: 60,
  blockGap: 16,
  sectionGap: 28,
  sectionPadX: 34,
  sectionPadY: 32,
  sectionTitleGap: 40,
}

/** 昼读纸色主题，便于社交平台阅读 */
const C = {
  canvasTop: '#e7dfd2',
  canvasBottom: '#f4efe6',
  card: '#fffcf7',
  cardEdge: '#e8dfd2',
  shadow: 'rgba(72, 58, 38, 0.14)',
  accent: '#b43d26',
  accentSoft: '#be4a33',
  accentTintStrong: 'rgba(180, 61, 38, 0.12)',
  title: '#1a1815',
  body: '#3a352d',
  muted: '#736b5c',
  faint: '#9a9186',
  sectionBg: '#f6f1e8',
  highlightBg: '#f3e8e4',
  footerBg: '#efe8dc',
}

const FONT = {
  display: '"Noto Serif SC", "Songti SC", "PingFang SC", serif',
  body: '"Noto Serif SC", "PingFang SC", sans-serif',
  mono: 'ui-monospace, "SF Mono", Menlo, monospace',
}

/** 纸色卡片用深色版品牌标（与 BrandLogo 昼读逻辑一致） */
const BRAND_LOGO_SRC = '/logo-dark.svg'

let brandLogoPromise: Promise<HTMLImageElement> | null = null

async function loadBrandLogo(): Promise<HTMLImageElement> {
  if (!brandLogoPromise) {
    brandLogoPromise = new Promise((resolve, reject) => {
      const img = new Image()
      img.decoding = 'async'
      img.onload = () => resolve(img)
      img.onerror = () => {
        brandLogoPromise = null
        reject(new Error('无法加载品牌标识'))
      }
      img.src = BRAND_LOGO_SRC
    })
  }
  return brandLogoPromise
}

function drawBrandMark(
  ctx: CanvasRenderingContext2D,
  logo: HTMLImageElement | null,
  x: number,
  y: number,
  size: number,
) {
  roundRect(ctx, x, y, size, size, size * 0.24)
  ctx.fillStyle = '#ffffff'
  ctx.fill()
  ctx.strokeStyle = 'rgba(115, 107, 92, 0.14)'
  ctx.lineWidth = 1
  ctx.stroke()

  const pad = size * 0.13
  if (logo) {
    ctx.drawImage(logo, x + pad, y + pad, size - pad * 2, size - pad * 2)
    return
  }

  ctx.font = `700 ${Math.round(size * 0.5)}px ${FONT.display}`
  ctx.fillStyle = C.accent
  ctx.fillText('闻', x + size * 0.28, y + size * 0.67)
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const radius = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + w, y, x + w, y + h, radius)
  ctx.arcTo(x + w, y + h, x, y + h, radius)
  ctx.arcTo(x, y + h, x, y, radius)
  ctx.arcTo(x, y, x + w, y, radius)
  ctx.closePath()
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  if (!text) return []
  const lines: string[] = []
  let current = ''
  for (const char of text) {
    const next = current + char
    if (ctx.measureText(next).width > maxWidth && current) {
      lines.push(current)
      current = char === ' ' ? '' : char
    } else {
      current = next
    }
  }
  if (current.trim()) lines.push(current.trim())
  return lines.length ? lines : ['']
}

function parseSections(markdown: string): Section[] {
  const sections: Section[] = []
  let current: Section | null = null

  for (const line of markdown.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (trimmed.startsWith('## ')) {
      if (current) sections.push(current)
      const title = trimmed.slice(3).trim()
      current = {
        title,
        blocks: [],
        highlight: title.includes('一句话结论'),
      }
      continue
    }
    if (!current) current = { title: '摘要', blocks: [] }
    if (/^[-*]\s+/.test(trimmed)) {
      current.blocks.push({ type: 'bullet', text: trimmed.replace(/^[-*]\s+/, '').trim() })
    } else {
      current.blocks.push({ type: 'paragraph', text: trimmed })
    }
  }
  if (current) sections.push(current)
  return sections
}

function layoutSection(
  ctx: CanvasRenderingContext2D,
  section: Section,
  startY: number,
): SectionLayout {
  const highlight = Boolean(section.highlight)
  const boxPadX = TYPE.sectionPadX
  const boxPadY = TYPE.sectionPadY
  const contentWidth = INNER_W - boxPadX * 2
  const bulletIndent = 28
  const lines: TextLine[] = []
  const textX = CARD_X + CARD_PAD + boxPadX

  const titleY = startY + boxPadY + 20
  let y = titleY + TYPE.sectionTitleGap

  for (const block of section.blocks) {
    const font =
      block.type === 'bullet'
        ? `400 ${TYPE.body}px ${FONT.body}`
        : highlight
          ? `500 ${TYPE.highlight}px ${FONT.body}`
          : `400 ${TYPE.body}px ${FONT.body}`
    ctx.font = font
    const maxWidth = block.type === 'bullet' ? contentWidth - bulletIndent : contentWidth
    const parts = wrapText(ctx, block.text, maxWidth)
    for (let index = 0; index < parts.length; index += 1) {
      lines.push({
        text: parts[index],
        x: textX + (block.type === 'bullet' ? bulletIndent : 0),
        y,
        font,
        color: highlight ? C.title : C.body,
        drawBullet: block.type === 'bullet' && index === 0,
      })
      if (block.type === 'bullet') y += TYPE.bulletLine
      else if (highlight) y += TYPE.highlightLine
      else y += TYPE.bodyLine
    }
    y += TYPE.blockGap
  }

  const minHeight = highlight ? 132 : 108
  const boxHeight = Math.max(y - startY + boxPadY, minHeight)
  return { title: section.title, highlight, boxY: startY, boxHeight, titleY, lines }
}

function displayTitle(title: string, sourceName?: string): string {
  let value = title.trim()
  const source = sourceName?.trim()
  if (source) {
    for (const suffix of [` - ${source}`, `-${source}`, ` | ${source}`, `｜${source}`]) {
      if (value.endsWith(suffix)) {
        value = value.slice(0, -suffix.length).trim()
        break
      }
    }
  }
  return value || '一篇文章'
}

function buildLayout(ctx: CanvasRenderingContext2D, input: SpeedReadImageInput): CardLayout {
  const textX = CARD_X + CARD_PAD
  const title = displayTitle(input.articleTitle, input.sourceName)
  const titleFont = `700 ${TYPE.title}px ${FONT.display}`
  ctx.font = titleFont

  let y = CARD_TOP + 84
  const titleLines: TextLine[] = []
  for (const text of wrapText(ctx, title, INNER_W)) {
    titleLines.push({ text, x: textX, y, font: titleFont, color: C.title })
    y += TYPE.titleLine
  }

  y += 12
  if (input.model?.trim()) y += 26
  const metaDividerY = y + 14
  y = metaDividerY + 34

  const sections = parseSections(input.markdown).map((section) => {
    const layout = layoutSection(ctx, section, y)
    y += layout.boxHeight + TYPE.sectionGap
    return layout
  })

  const footerY = y + 20
  const height = footerY + FOOTER_H + OUTER_PAD
  return { height, titleLines, metaDividerY, sections, footerY }
}

function drawBackground(ctx: CanvasRenderingContext2D, height: number) {
  const gradient = ctx.createLinearGradient(0, 0, WIDTH, height)
  gradient.addColorStop(0, C.canvasTop)
  gradient.addColorStop(0.55, C.canvasBottom)
  gradient.addColorStop(1, '#ece4d8')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, WIDTH, height)

  ctx.save()
  ctx.globalAlpha = 0.03
  for (let i = 0; i < 2200; i += 1) {
    ctx.fillStyle = i % 2 === 0 ? C.title : C.muted
    ctx.fillRect((i * 89) % WIDTH, (i * 47) % height, 1, 1)
  }
  ctx.restore()
}

function drawCardShell(ctx: CanvasRenderingContext2D, height: number) {
  const cardH = height - OUTER_PAD * 2

  ctx.save()
  ctx.shadowColor = C.shadow
  ctx.shadowBlur = 40
  ctx.shadowOffsetY = 18
  roundRect(ctx, CARD_X, CARD_TOP + 10, CARD_W, cardH, 34)
  ctx.fillStyle = 'rgba(72, 58, 38, 0.1)'
  ctx.fill()
  ctx.restore()

  roundRect(ctx, CARD_X, CARD_TOP, CARD_W, cardH, 34)
  ctx.fillStyle = C.card
  ctx.fill()
  ctx.strokeStyle = C.cardEdge
  ctx.lineWidth = 2
  ctx.stroke()

  ctx.fillStyle = C.accent
  roundRect(ctx, CARD_X + 40, CARD_TOP, CARD_W - 80, 5, 2.5)
  ctx.fill()
}

function drawHeader(
  ctx: CanvasRenderingContext2D,
  input: SpeedReadImageInput,
  layout: CardLayout,
  logo: HTMLImageElement | null,
) {
  const x = CARD_X + CARD_PAD
  const headerLogoSize = 42
  drawBrandMark(
    ctx,
    logo,
    CARD_X + CARD_W - CARD_PAD - headerLogoSize,
    CARD_TOP + 26,
    headerLogoSize,
  )

  roundRect(ctx, x, CARD_TOP + 28, 118, 30, 15)
  ctx.fillStyle = C.accentTintStrong
  ctx.fill()
  ctx.strokeStyle = 'rgba(180, 61, 38, 0.22)'
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.font = `600 16px ${FONT.mono}`
  ctx.fillStyle = C.accent
  ctx.fillText('AI 速读', x + 18, CARD_TOP + 48)

  for (const line of layout.titleLines) {
    ctx.font = line.font
    ctx.fillStyle = line.color
    ctx.fillText(line.text, line.x, line.y)
  }

  const metaY = layout.titleLines.at(-1)?.y ?? CARD_TOP + 110
  if (input.model?.trim()) {
    ctx.font = `400 ${TYPE.meta}px ${FONT.mono}`
    ctx.fillStyle = C.muted
    ctx.fillText(input.model.trim(), x, metaY + 24)
  }

  ctx.strokeStyle = 'rgba(115, 107, 92, 0.18)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(x, layout.metaDividerY)
  ctx.lineTo(x + INNER_W, layout.metaDividerY)
  ctx.stroke()
}

function drawSections(ctx: CanvasRenderingContext2D, sections: SectionLayout[]) {
  const boxX = CARD_X + CARD_PAD
  for (const section of sections) {
    roundRect(ctx, boxX, section.boxY, INNER_W, section.boxHeight, 22)
    ctx.fillStyle = section.highlight ? C.highlightBg : C.sectionBg
    ctx.fill()

    if (section.highlight) {
      ctx.fillStyle = C.accent
      roundRect(ctx, boxX + 5, section.boxY + 20, 5, section.boxHeight - 40, 2.5)
      ctx.fill()
    }

    ctx.font = `600 ${TYPE.sectionLabel}px ${FONT.mono}`
    ctx.fillStyle = section.highlight ? C.accent : C.muted
    ctx.fillText(section.title, boxX + (section.highlight ? 30 : 24), section.titleY)

    for (const line of section.lines) {
      if (line.drawBullet) {
        ctx.fillStyle = C.accentSoft
        ctx.beginPath()
        ctx.arc(line.x - 16, line.y - 10, 4, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.font = line.font
      ctx.fillStyle = line.color
      ctx.fillText(line.text, line.x, line.y)
    }
  }
}

function drawFooter(
  ctx: CanvasRenderingContext2D,
  footerY: number,
  height: number,
  logo: HTMLImageElement | null,
) {
  const cardH = height - OUTER_PAD * 2
  const footerH = CARD_TOP + cardH - footerY

  ctx.save()
  roundRect(ctx, CARD_X, CARD_TOP, CARD_W, cardH, 34)
  ctx.clip()
  ctx.fillStyle = C.footerBg
  ctx.fillRect(CARD_X, footerY, CARD_W, footerH)
  ctx.restore()

  ctx.strokeStyle = 'rgba(115, 107, 92, 0.16)'
  ctx.beginPath()
  ctx.moveTo(CARD_X + CARD_PAD, footerY + 1)
  ctx.lineTo(CARD_X + CARD_W - CARD_PAD, footerY + 1)
  ctx.stroke()

  const logoX = CARD_X + CARD_PAD
  const logoY = footerY + 28
  const footerLogoSize = 54
  drawBrandMark(ctx, logo, logoX, logoY, footerLogoSize)

  const textX = logoX + footerLogoSize + 16
  ctx.font = `700 26px ${FONT.display}`
  ctx.fillStyle = C.title
  ctx.fillText('有所闻', textX, logoY + 22)
  ctx.font = `500 18px ${FONT.mono}`
  ctx.fillStyle = C.muted
  ctx.fillText('NewsNook', textX, logoY + 46)
  ctx.font = `400 17px ${FONT.mono}`
  ctx.fillStyle = C.faint
  ctx.fillText('本地优先 · 无算法推荐的新闻阅读', textX, logoY + 72)

  const date = new Date().toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
  ctx.textAlign = 'right'
  ctx.font = `400 16px ${FONT.mono}`
  ctx.fillStyle = C.faint
  ctx.fillText(`来自有所闻  ·  ${date}`, CARD_X + CARD_W - CARD_PAD, logoY + 30)
  ctx.textAlign = 'left'
}

function drawCard(
  ctx: CanvasRenderingContext2D,
  input: SpeedReadImageInput,
  layout: CardLayout,
  logo: HTMLImageElement | null,
) {
  drawBackground(ctx, layout.height)
  drawCardShell(ctx, layout.height)
  drawHeader(ctx, input, layout, logo)
  drawSections(ctx, layout.sections)
  drawFooter(ctx, layout.footerY, layout.height, logo)
}

export async function renderSpeedReadImageBlob(input: SpeedReadImageInput): Promise<Blob> {
  const logo = await loadBrandLogo().catch(() => null)

  const measureCanvas = document.createElement('canvas')
  const measureCtx = measureCanvas.getContext('2d')
  if (!measureCtx) throw new Error('无法创建图片')

  const layout = buildLayout(measureCtx, input)
  const canvas = document.createElement('canvas')
  canvas.width = WIDTH
  canvas.height = Math.max(layout.height, 920)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建图片')

  drawCard(ctx, input, layout, logo)

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('图片生成失败'))
        return
      }
      resolve(blob)
    }, 'image/png')
  })
}

export function speedReadImageFileName(articleTitle: string): string {
  const base = articleTitle
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 48)
  return `有所闻-速读-${base || 'newsnook'}.png`
}
