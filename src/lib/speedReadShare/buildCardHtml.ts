import { parseSpeedReadMarkdown } from './parse'
import { getShareLogoSrc } from './assets'
import { displayArticleTitle } from '../displayArticleTitle'
import { speedReadBodyForExport } from '../../features/speedRead/serialize'
import { SPEED_READ_SECTION_TITLES } from '../../features/speedRead/sections'
import type { ParsedSpeedRead, SpeedReadImageInput, SpeedReadShareStyle } from './types'

const S = SPEED_READ_SECTION_TITLES

const PCLIP_SVG =
  '<svg class="pclip" width="30" height="62" viewBox="0 0 30 62" fill="none" aria-hidden="true"><path d="M9 16 V46 a6.5 6.5 0 0 0 13 0 V12 a9.5 9.5 0 0 0 -19 0 V44" stroke="#98a1ac" stroke-width="3.4" stroke-linecap="round" fill="none"/></svg>'

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function formatInline(text: string, mode: 'v1' | 'b' | 'mark'): string {
  const parts: string[] = []
  const re = /\*\*(.+?)\*\*/g
  let last = 0
  let match: RegExpExecArray | null
  let alt = 0

  while ((match = re.exec(text)) !== null) {
    parts.push(escapeHtml(text.slice(last, match.index)))
    const inner = escapeHtml(match[1])
    if (mode === 'b') parts.push(`<b>${inner}</b>`)
    else if (mode === 'mark') parts.push(`<mark>${inner}</mark>`)
    else {
      alt += 1
      parts.push(alt % 2 === 1 ? `<mark class="r">${inner}</mark>` : `<mark>${inner}</mark>`)
    }
    last = match.index + match[0].length
  }
  parts.push(escapeHtml(text.slice(last)))
  return parts.join('')
}

function formatTitleHtml(title: string, style: SpeedReadShareStyle): string {
  const escaped = escapeHtml(title)
  if (style === 'warm-paper') {
    return escaped.replace(/(「[^」]+」)/g, '<span class="hw">$1</span>')
  }
  return escaped.replace(/(「[^」]+」)/g, '<em>$1</em>')
}

function formatDateDots(date = new Date()): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}.${month}.${day}`
}

function formatDateCn(date = new Date()): string {
  return date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })
}

function commentText(value: string): string {
  return value.trim() || '—'
}

function commentsBand(content: ParsedSpeedRead, mode: 'v1' | 'b' | 'mark'): string {
  const rows: Array<[string, string]> = [
    [S.satire, content.satire],
    [S.structure, content.structure],
    [S.situation, content.situation],
  ]
  const items = rows
    .map(
      ([label, text]) =>
        `<div class="triad-row"><span class="triad-lab">${escapeHtml(label)}</span><p>${formatInline(commentText(text), mode)}</p></div>`,
    )
    .join('')
  return `<section class="triad" aria-label="三评">${items}</section>`
}

function buildMeta(model: string | undefined, withDate: boolean): string {
  const parts: string[] = []
  if (model?.trim()) parts.push(`模型 ${model.trim()}`)
  parts.push('仅供于当前原文')
  if (withDate) parts.push(formatDateDots())
  return parts.join(' · ')
}

function brandBlock(lightLogo: boolean): string {
  const src = getShareLogoSrc(lightLogo)
  return `<div class="brand"><span class="logo"><img src="${src}" alt="" width="38" height="38" /></span><div class="bt"><b>有所闻 · NewsNook</b><i>本地优先 · 无算法推荐新闻阅读</i></div></div>`
}

function footerBlock(lightLogo: boolean, dateCn: string): string {
  return `<footer class="foot">${brandBlock(lightLogo)}<div class="from-col"><span class="from-chip">来自有所闻</span><span class="date">${dateCn} · AI 速读</span></div></footer>`
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** 竖排印章：避免 writing-mode 在 html-to-image / WebView 上排版不一致 */
function verticalSealHtml(text: string, charClass: string): string {
  return text
    .split('')
    .map((ch) => `<span class="${charClass}">${escapeHtml(ch)}</span>`)
    .join('')
}

function buildWarmPaper(
  title: string,
  meta: string,
  content: ParsedSpeedRead,
  dateCn: string,
): string {
  const keyItems = content.keyPoints
    .map((item) => `<li>${formatInline(item, 'v1')}</li>`)
    .join('')
  const warnItems = content.warnings
    .map((item) => `<li>${formatInline(item, 'v1')}</li>`)
    .join('')

  return `<article class="card v1">
    <div class="v1-top"><span class="tag-red">AI 速读</span></div>
    <div class="seal" aria-hidden="true"><span class="seal-stack">${verticalSealHtml('有所闻', 'seal-char')}</span></div>
    <h1>${title}</h1>
    <p class="meta">${escapeHtml(meta)}</p>
    <hr class="v1-rule">
    <section class="v1-note">
      <span class="tape" aria-hidden="true"></span>
      <h3>${S.conclusion}</h3>
      <p>${formatInline(content.conclusion || '—', 'v1')}</p>
    </section>
    ${commentsBand(content, 'v1')}
    <div class="v1-sec"><span class="sq"></span><h3>${S.keyPoints}</h3><span class="cnt">${content.keyPoints.length} 条</span><span class="ln"></span></div>
    <ul class="key">${keyItems || '<li>—</li>'}</ul>
    <div class="v1-sec amber"><span class="sq"></span><h3>${S.warnings}</h3><span class="cnt">${content.warnings.length} 条</span><span class="ln"></span></div>
    <ul class="wrn">${warnItems || '<li>—</li>'}</ul>
    ${footerBlock(false, dateCn)}
  </article>`
}

function buildEditorial(
  title: string,
  meta: string,
  content: ParsedSpeedRead,
  dateCn: string,
): string {
  const keyItems = content.keyPoints
    .map((item, index) => `<li><span class="n">${pad2(index + 1)}</span><p>${formatInline(item, 'b')}</p></li>`)
    .join('')
  const warnItems = content.warnings
    .map((item, index) => `<li><span class="n">${pad2(index + 1)}</span><p>${formatInline(item, 'b')}</p></li>`)
    .join('')

  return `<article class="card v2">
    <div class="v2-mast"><span class="k">AI 速读</span><span class="d">${formatDateDots()}</span></div>
    <h1>${title}</h1>
    <p class="meta">${escapeHtml(meta)}</p>
    <div class="v2-quote">
      <p class="lab">${S.conclusion} / SUOWEN</p>
      <p>${formatInline(content.conclusion || '—', 'b')}</p>
    </div>
    ${commentsBand(content, 'b')}
    <div class="v2-h"><span class="no">02</span><h3>${S.keyPoints}</h3><span class="en">Key Thread</span><span class="ln"></span></div>
    <ol>${keyItems || '<li><span class="n">01</span><p>—</p></li>'}</ol>
    <div class="v2-h"><span class="no">03</span><h3>${S.warnings}</h3><span class="en">Notes</span><span class="ln"></span></div>
    <ol class="wrn">${warnItems || '<li><span class="n">01</span><p>—</p></li>'}</ol>
    ${footerBlock(false, dateCn)}
  </article>`
}

function buildDusk(title: string, meta: string, content: ParsedSpeedRead, dateCn: string): string {
  const keyItems = content.keyPoints
    .map((item, index) => `<li><span class="n">${pad2(index + 1)}</span>${formatInline(item, 'b')}</li>`)
    .join('')
  const warnItems = content.warnings
    .map((item) => `<li>${formatInline(item, 'b')}</li>`)
    .join('')

  return `<article class="card v3">
    <div class="v3-top"><span class="pill">AI 速读</span><span class="date-top">${formatDateDots()}</span></div>
    <h1>${title}</h1>
    <p class="meta">${escapeHtml(meta)}<span class="ln"></span></p>
    <div class="v3-quote">
      <span class="lab">${S.conclusion}</span>
      <p>${formatInline(content.conclusion || '—', 'b')}</p>
    </div>
    ${commentsBand(content, 'b')}
    <div class="v3-h"><span class="bar"></span><h3>${S.keyPoints}</h3><span class="cnt">${content.keyPoints.length} 条</span></div>
    <ul class="key">${keyItems || '<li>—</li>'}</ul>
    <div class="v3-h"><span class="bar"></span><h3>${S.warnings}</h3><span class="cnt">${content.warnings.length} 条</span></div>
    <ul class="wrn">${warnItems || '<li>—</li>'}</ul>
    ${footerBlock(true, dateCn)}
  </article>`
}

function buildJournal(title: string, meta: string, content: ParsedSpeedRead, dateCn: string): string {
  const keyItems = content.keyPoints
    .map((item, index) => `<li><span class="n">${index + 1}</span><p>${formatInline(item, 'mark')}</p></li>`)
    .join('')
  const warnItems = content.warnings
    .map((item) => `<li>${formatInline(item, 'mark')}</li>`)
    .join('')

  return `<article class="card v4">
    <section class="v4-head">
      ${PCLIP_SVG}
      <div class="v4-tags"><span class="tag-red">AI 速读</span><span class="tag-ghost">${formatDateDots()}</span></div>
      <h1>${title}</h1>
      <p class="meta">${escapeHtml(meta)}</p>
    </section>
    <section class="v4-note">
      <span class="tape" aria-hidden="true"></span>
      <span class="lab">${S.conclusion} ✎</span>
      <p>${formatInline(content.conclusion || '—', 'mark')}</p>
    </section>
    ${commentsBand(content, 'mark')}
    <section class="v4-points">
      <div class="lab" data-count="${content.keyPoints.length} 条"><span class="dot"></span>${S.keyPoints}</div>
      <ol>${keyItems || '<li><span class="n">1</span><p>—</p></li>'}</ol>
    </section>
    <section class="v4-warn">
      <span class="tape" aria-hidden="true"></span>
      <div class="lab"><span class="tri"></span>${S.warnings}</div>
      <ul>${warnItems || '<li>—</li>'}</ul>
    </section>
    <div class="strip">
      ${brandBlock(false)}
      <div class="m4"><b>来自有所闻</b> · ${dateCn} · AI 速读</div>
      <div class="stamp" aria-hidden="true"><span class="stamp-stack">${verticalSealHtml('有所闻', 'stamp-char')}</span></div>
    </div>
  </article>`
}

export function buildCardHtml(input: SpeedReadImageInput, style: SpeedReadShareStyle): string {
  const content = parseSpeedReadMarkdown(speedReadBodyForExport(input.markdown))
  const title = formatTitleHtml(
    displayArticleTitle(input.articleTitle, {
      sourceName: input.sourceName,
      sourceLabel: input.sourceLabel,
    }),
    style,
  )
  const meta = buildMeta(input.model, style === 'warm-paper')
  const dateCn = formatDateCn()

  let card = ''
  switch (style) {
    case 'warm-paper':
      card = buildWarmPaper(title, meta, content, dateCn)
      break
    case 'editorial':
      card = buildEditorial(title, meta, content, dateCn)
      break
    case 'dusk':
      card = buildDusk(title, meta, content, dateCn)
      break
    case 'journal':
      card = buildJournal(title, meta, content, dateCn)
      break
  }

  return `<div class="sr-share-root">${card}</div>`
}
