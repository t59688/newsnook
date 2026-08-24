/**
 * 生成 public/og-default.png：分享卡片的品牌兜底图（1200x630）。
 *
 * 社交平台只认「大图卡」里的 og:image；上游抓不到首图时边缘卡片
 * 会退回这张图，所以它必须入库、随静态资产部署到 news.aizeek.com。
 *
 * 一次性生成并提交产物；改设计后重跑本脚本即可。
 * 需要本机有 CJK 字体（如 fonts-noto-cjk），否则中文会渲染成方块。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')
const markPathFile = path.join(projectRoot, 'assets/android-icon/mark-path.txt')
const outFile = path.join(projectRoot, 'public/og-default.png')

const WIDTH = 1200
const HEIGHT = 630
/** 与 favicon 同一套对角蓝渐变，聊天缩略图里也认得出品牌 */
const GRADIENT = { start: '#0038FF', mid: '#0066FF', end: '#00A8E8' }

const markPath = fs.readFileSync(markPathFile, 'utf8').trim()

// 纸翼标在左，文字在右：微信/WhatsApp 缩略裁切时中央内容仍完整
const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <defs>
    <linearGradient id="bg" x1="90" y1="580" x2="1110" y2="50" gradientUnits="userSpaceOnUse">
      <stop stop-color="${GRADIENT.start}"/>
      <stop offset="0.45" stop-color="${GRADIENT.mid}"/>
      <stop offset="1" stop-color="${GRADIENT.end}"/>
    </linearGradient>
  </defs>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)"/>
  <g transform="translate(208 315) scale(0.26) translate(-540 -540)">
    <path fill-rule="evenodd" clip-rule="evenodd" fill="#FFFFFF" d="${markPath}"/>
  </g>
  <text x="392" y="342" font-family="Noto Serif CJK SC" font-weight="700" font-size="150" fill="#FFFFFF">有所闻</text>
  <text x="398" y="432" font-family="Noto Sans CJK SC" font-size="40" fill="#FFFFFF" fill-opacity="0.82">News Nook · 点开链接站内读全文</text>
</svg>
`

const sharp = (await import('sharp')).default
await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(outFile)
const { size } = fs.statSync(outFile)
console.log(`wrote ${path.relative(projectRoot, outFile)} (${WIDTH}x${HEIGHT}, ${(size / 1024).toFixed(1)} KB)`)
