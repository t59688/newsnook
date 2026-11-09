import { readAppStyles } from './helpers/readAppStyles'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseHTML } from 'linkedom'

import {
  CUSTOM_TOKEN_KEYS,
  DEFAULT_CUSTOM_SCHEME,
  contrastRatio,
  deriveSchemeTokens,
  ensureAccentContrast,
  isHexColor,
  normalizeCustomScheme,
  normalizeHexColor,
  parseHexColor,
  mixHex,
  rgbToHex,
} from '../src/lib/customScheme'
import {
  DEFAULT_THEME_SCHEME,
  THEME_SCHEMES,
  THEME_SURFACE,
  applyThemeScheme,
  isThemeScheme,
  schemeSeedColors,
  themeSurface,
  type ResolvedTheme,
} from '../src/lib/theme'
import {
  DEFAULT_PREFERENCES,
  normalizePreferences,
  selectThemeScheme,
  setCustomSchemeColors,
  setThemeScheme,
} from '../src/sources/preferences'

const RESOLVED: ResolvedTheme[] = ['light', 'dark']

// —— 偏好：默认值、持久化往返、脏数据清洗、幂等更新 ——

assert.equal(DEFAULT_THEME_SCHEME, 'ink')
assert.equal(DEFAULT_PREFERENCES.scheme, 'ink', '默认方案应为墨问')
assert.equal(normalizePreferences({}).scheme, 'ink')
assert.equal(normalizePreferences(null).scheme, 'ink')
assert.equal(normalizePreferences({ scheme: 'celadon' }).scheme, 'celadon')
assert.equal(normalizePreferences({ scheme: 'pearl' }).scheme, 'pearl')
assert.equal(normalizePreferences({ scheme: 'amber' }).scheme, 'amber')
assert.equal(normalizePreferences({ scheme: 'forest' }).scheme, 'ink', '已下线方案应清洗回墨问')
assert.equal(normalizePreferences({ scheme: 'dusk' }).scheme, 'dusk')
assert.equal(normalizePreferences({ scheme: 'buer' }).scheme, 'buer')
assert.equal(normalizePreferences({ scheme: 'custom' }).scheme, 'custom')
assert.equal(normalizePreferences({ scheme: 'neon' }).scheme, 'ink', '未知方案应清洗回墨问')
assert.equal(normalizePreferences({ scheme: 'pine' }).scheme, 'ink', '已下线方案应清洗回墨问')
assert.equal(normalizePreferences({ scheme: 42 }).scheme, 'ink', '非字符串方案应清洗回墨问')

const themed = setThemeScheme(DEFAULT_PREFERENCES, 'celadon')
assert.equal(themed.scheme, 'celadon')
assert.equal(themed.theme, DEFAULT_PREFERENCES.theme, '方案与明暗正交，不应互改')
assert.equal(setThemeScheme(themed, 'celadon'), themed, '重复设置同一方案应幂等')
assert.equal(setThemeScheme(themed, 'ink').scheme, 'ink')

const roundTrip = normalizePreferences(JSON.parse(JSON.stringify(themed)))
assert.equal(roundTrip.scheme, 'celadon', '方案应随偏好持久化往返')

// 自定义配色：首次选择从当前方案播种；选了自定义但无数据时 normalize 补默认
const seeded = selectThemeScheme(themed, 'custom')
assert.equal(seeded.scheme, 'custom')
assert.deepEqual(seeded.customScheme, schemeSeedColors('celadon'), '应从天青 swatch 播种')
assert.equal(selectThemeScheme(seeded, 'custom'), seeded, '已有配色时重复选择应幂等')

const customWithoutColors = normalizePreferences({ scheme: 'custom' })
assert.deepEqual(customWithoutColors.customScheme, DEFAULT_CUSTOM_SCHEME, '自定义缺数据应补墨问种子')

const dirtyCustom = normalizePreferences({
  scheme: 'custom',
  customScheme: { light: { ink: '#zzz', accent: '#A34E1B' }, dark: 'nope' },
})
assert.equal(dirtyCustom.customScheme?.light.accent, '#a34e1b', '合法 hex 保留并小写化')
assert.equal(dirtyCustom.customScheme?.light.ink, DEFAULT_CUSTOM_SCHEME.light.ink, '脏值回落默认')
assert.deepEqual(dirtyCustom.customScheme?.dark, DEFAULT_CUSTOM_SCHEME.dark, '整档非法回落默认')

const recolored = setCustomSchemeColors(seeded, 'dark', { ink: '#101820', accent: '#7ea8dd' })
assert.equal(recolored.customScheme?.dark.ink, '#101820')
assert.equal(recolored.customScheme?.light, seeded.customScheme?.light, '另一档不应被波及')
assert.equal(
  setCustomSchemeColors(recolored, 'dark', { ink: '#101820', accent: '#7ea8dd' }),
  recolored,
  '相同颜色重复设置应幂等',
)

console.log('theme-scheme prefs: ok')

// —— 注册表：id 唯一、swatch 完备、表面色齐全（custom 无静态表面色，走运行时取色） ——

assert.equal(THEME_SCHEMES.length, 7)
assert.deepEqual(
  THEME_SCHEMES.map((item) => item.id),
  ['ink', 'celadon', 'pearl', 'amber', 'dusk', 'buer', 'custom'],
)
assert.equal(new Set(THEME_SCHEMES.map((item) => item.id)).size, THEME_SCHEMES.length)
assert.ok(THEME_SCHEMES.every((item) => isThemeScheme(item.id)))

const HEX = /^#[0-9a-f]{6}$/i
const STATIC_SCHEMES = THEME_SCHEMES.filter((item) => item.id !== 'custom')
for (const item of THEME_SCHEMES) {
  assert.ok(item.label && item.caption, `${item.id} 缺少文案`)
  for (const mode of RESOLVED) {
    const swatch = item.swatch[mode]
    assert.ok(swatch, `${item.id} 缺少 ${mode} swatch`)
    for (const [key, value] of Object.entries(swatch)) {
      assert.match(value, HEX, `${item.id}/${mode}/${key} 应为 #rrggbb 色值`)
    }
    assert.match(
      themeSurface(item.id, mode),
      HEX,
      `${item.id}/${mode} 表面色应为 #rrggbb 色值`,
    )
  }
}
assert.equal(Object.keys(THEME_SURFACE).length, STATIC_SCHEMES.length)
// 未注入自定义配色时，custom 表面色兜底墨问
assert.equal(themeSurface('custom', 'dark'), THEME_SURFACE.ink.dark)
assert.equal(themeSurface('custom', 'light'), THEME_SURFACE.ink.light)

console.log('theme-scheme registry: ok')

// —— CSS 完备性：内置方案块都要定义完整 token 组，且与注册表 swatch 同步 ——

const css = readAppStyles()

/** 取选择器到块结尾的文本，用于断言块内 token */
function blockOf(selector: string): string {
  const start = css.indexOf(selector)
  assert.ok(start >= 0, `index.css 缺少选择器 ${selector}`)
  const end = css.indexOf('\n}', start)
  assert.ok(end > start, `${selector} 块不完整`)
  return css.slice(start, end)
}

const REQUIRED_TOKENS = [
  '--tone-ink:',
  '--tone-ink-raised:',
  '--tone-ink-deep:',
  '--tone-paper:',
  '--tone-paper-muted:',
  '--tone-paper-faint:',
  '--tone-cinnabar:',
  '--tone-cinnabar-soft:',
  '--tone-haze:',
  '--tone-body-text:',
  '--tone-quote-text:',
  '--lead-veil:',
  '--shadow-lift:',
  '--dim-hidden:',
  '--color-ink:',
  '--color-ink-raised:',
  '--color-ink-deep:',
  '--color-paper:',
  '--color-paper-muted:',
  '--color-paper-faint:',
  '--color-cinnabar:',
  '--color-cinnabar-soft:',
  '--color-haze:',
  'color-scheme:',
]

for (const item of STATIC_SCHEMES) {
  for (const mode of RESOLVED) {
    // 墨问走默认 [data-theme] 块；其余方案走自己的 data-scheme 块（取首次出现，即根块）
    const selector =
      item.id === 'ink' ? `[data-theme='${mode}']` : `[data-scheme='${item.id}'][data-theme='${mode}']`
    const block = blockOf(selector).toLowerCase()
    for (const token of REQUIRED_TOKENS) {
      assert.ok(block.includes(token), `${item.id}/${mode} 块缺少 ${token}`)
    }
    // 注册表 swatch 必须与 CSS 色值同步（rgba 派生色除外，四个纯色直接断言）
    const swatch = item.swatch[mode]
    for (const value of [swatch.ink, swatch.raised, swatch.paper, swatch.accent]) {
      assert.ok(
        block.includes(value.toLowerCase()),
        `${item.id}/${mode} 块与注册表 swatch 不同步：${value}`,
      )
    }
    // 表面色与 --tone-ink 同值
    assert.ok(
      block.includes(themeSurface(item.id, mode).toLowerCase()),
      `${item.id}/${mode} 表面色未出现在 CSS 块中`,
    )
    // 全产品可读性底线：来源、时间、设置说明在页面和浮层均不得过浅。
    const textFaint = block.match(/--tone-paper-faint:\s*(#[0-9a-f]{6})/)
    const surfaces = ['--tone-ink:', '--tone-ink-raised:'].map((token) => {
      const value = block.match(new RegExp(`${token}\\s*(#[0-9a-f]{6})`))
      assert.ok(value, `${item.id}/${mode} 缺少底色 ${token}`)
      return value[1]
    })
    assert.ok(textFaint, `${item.id}/${mode} 缺少辅助文字色`)
    for (const background of surfaces) {
      assert.ok(
        contrastRatio(textFaint[1], background) >= 4.5,
        `${item.id}/${mode} 辅助文字 ${textFaint[1]} 在 ${background} 上不够清晰`,
      )
    }
  }
}

// 自定义方案没有静态块；token 全部来自运行时内联（见下方推导断言）
assert.ok(!css.includes("[data-scheme='custom']"), 'custom 方案不应有静态 CSS 块')

const html = readFileSync(resolve('index.html'), 'utf8')
for (const id of STATIC_SCHEMES.map((item) => item.id).filter((id) => id !== 'ink')) {
  assert.ok(html.includes(`scheme === '${id}'`), `index.html 防闪白名单缺少 ${id}`)
}
assert.ok(html.includes("scheme === 'custom'"), 'index.html 防闪白名单缺少 custom')

console.log('theme-scheme css: ok')

// 不二昼读：从语义 token 直接取得可读前景色，不能仅在局部 CSS 中修补亮绿文字。
const buerCss = readFileSync(resolve('src/styles/buer.css'), 'utf8')
const buerLight = blockOf("[data-scheme='buer'][data-theme='light']").toLowerCase()
for (const [alias, semantic] of [
  ['--buer-accent-text', '--tone-cinnabar'],
  ['--buer-accent-text-soft', '--tone-cinnabar-soft'],
]) {
  assert.ok(buerCss.includes(`${alias}: var(${semantic});`), `不二 ${alias} 未绑定语义颜色`)
  const match = buerLight.match(new RegExp(`${semantic}:\\s*(#[0-9a-f]{6})`))
  assert.ok(match, `不二昼读缺少 ${semantic}`)
  for (const background of ['#FFFFFF', '#FAFAFC', '#EEF6CE']) {
    assert.ok(
      contrastRatio(match[1], background) >= 4.5,
      `不二 ${semantic} 与浅色背景 ${background} 的对比度不足`,
    )
  }
}
assert.ok(buerCss.includes('.nn-annotation-context .nn-annotation-primary'), '不二标注按钮未使用信号绿与独立前景色')
assert.ok(buerCss.includes('color: var(--buer-signal-ink) !important'), '不二标注按钮不能继承浅色背景前景色')
assert.ok(buerCss.includes(".group:hover [class*='group-hover:text-cinnabar']"), '不二文章标题悬停态未覆盖')
assert.ok(buerCss.includes("[class*='hover:text-cinnabar']:hover"), '不二普通链接悬停态未覆盖')
assert.ok(buerCss.includes("[class*=' text-cinnabar/']"), '不二透明度文字未覆盖')
assert.ok(contrastRatio('#000000', '#C8F008') >= 4.5, '荧光绿按钮必须使用黑色文字')
assert.ok(contrastRatio('#69717D', '#FFFFFF') >= 4.5, '不二昼读辅助信息需达到可读对比度')
assert.ok(contrastRatio('#777C86', '#090A0C') >= 4.5, '不二夜读辅助信息需达到可读对比度')
// 编辑式布局属于全应用，不应继续限制在单一主题内。
const editorialCss = readFileSync(resolve('src/styles/editorial-system.css'), 'utf8')
assert.ok(readFileSync(resolve("src/index.css"), "utf8").includes("@import './styles/editorial-system.css'"), '缺少全局编辑式样式入口')
for (const selector of [
  '.editorial-feed-timeline',
  '.editorial-article-row',
  '.editorial-article-title',
  '.editorial-article-meta',
  '.editorial-article-summary',
  '.editorial-reader-toolbar',
  '.editorial-reader-column',
  '.editorial-reader-heading',
]) {
  assert.ok(editorialCss.includes(selector), `全局编辑式布局缺少 ${selector}`)
}
for (const [file, marker] of [
  ['src/screens/FeedScreen.tsx', 'editorial-feed-timeline'],
  ['src/screens/ReaderScreen.tsx', 'editorial-reader-toolbar'],
  ['src/components/ArticleItem.tsx', 'editorial-article-title'],
  ['src/components/DesktopSidebar.tsx', 'editorial-desktop-sidebar'],
  ['src/components/AppShell.tsx', 'editorial-app-shell'],
  ['src/screens/SiteScreen.tsx', 'editorial-site-screen'],
  ['src/features/rssCatalog/RssCatalogBrowser.tsx', 'editorial-rss-catalog'],
  ['src/features/zhihu/ui/ZhihuWorkspace.tsx', 'editorial-zhihu-workspace'],
]) {
  assert.ok(readFileSync(resolve(file), 'utf8').includes(marker), `${file} 缺少全局布局节点 ${marker}`)
}
assert.ok(editorialCss.includes('[data-eink=\'1\']'), '阅读器微调不得影响墨水屏分页')

// 杂志排版属于共享布局，不能绑定某个配色，也不能破坏 Android 9 WebView 69。
const magazineCss = readFileSync(resolve('src/styles/editorial-magazine.css'), 'utf8')
assert.ok(readFileSync(resolve('src/index.css'), 'utf8').includes("@import './styles/editorial-magazine.css'"), '缺少杂志布局入口')
for (const selector of [
  '.editorial-lead-mobile',
  '.editorial-lead-spread',
  '.editorial-desktop-card-grid',
  '.editorial-mobile-card-grid',
  '.editorial-feed-day',
  '.editorial-reader-heading',
]) {
  assert.ok(magazineCss.includes(selector), `杂志布局缺少 ${selector}`)
}
for (const [file, marker] of [
  ['src/screens/FeedScreen.tsx', 'editorial-mobile-card-grid'],
  ['src/screens/FeedScreen.tsx', 'editorial-desktop-card-grid'],
  ['src/components/ArticleItem.tsx', 'editorial-lead-spread'],
  ['src/components/ArticleItem.tsx', 'editorial-card-title'],
]) {
  assert.ok(readFileSync(resolve(file), 'utf8').includes(marker), `${file} 缺少 ${marker}`)
}
assert.ok(!magazineCss.includes("[data-scheme='buer']"), '杂志版式不得限定在不二主题')
assert.ok(!/:has\(|\bclamp\(/.test(magazineCss), '杂志布局不能依赖 WebView 69 不支持的选择器或尺寸函数')
assert.ok(magazineCss.includes("html:not([data-eink='1']) .editorial-reader-heading"), '杂志阅读页必须隔离墨水屏')

console.log('buer contrast + global editorial and magazine layouts: ok')

// —— 颜色工具与推导：hex 往返、混合、对比度兜底 ——

assert.deepEqual(parseHexColor('#0e0f12'), { r: 14, g: 15, b: 18 })
assert.equal(rgbToHex({ r: 14, g: 15, b: 18 }), '#0e0f12')
assert.equal(normalizeHexColor('#ABC'), '#aabbcc', '3 位 hex 应展开')
assert.equal(normalizeHexColor('#a1b2c3'), '#a1b2c3')
assert.equal(normalizeHexColor('rgb(1,2,3)'), undefined)
assert.equal(mixHex('#000000', '#ffffff', 0.5), '#808080')
assert.ok(isHexColor('#d07a3a'))

for (const mode of RESOLVED) {
  const tokens = deriveSchemeTokens({ ink: '#101820', accent: '#7ea8dd' }, mode)
  for (const key of CUSTOM_TOKEN_KEYS) {
    assert.ok(tokens[key], `推导缺少 ${key}`)
  }
  // 文字与底色的对比度底线：任何输入都要可读
  assert.ok(
    contrastRatio(tokens['--tone-paper'], tokens['--tone-ink']) >= 7,
    `${mode} 文字对比度不足`,
  )
  assert.ok(
    contrastRatio(tokens['--tone-cinnabar'], tokens['--tone-ink']) >= 3.2,
    `${mode} 强调色对比度不足`,
  )
}

// 极端输入：昼读档选纯黑底，文字色应兜底回中性深色
const extreme = deriveSchemeTokens({ ink: '#000000', accent: '#ffff00' }, 'light')
assert.ok(contrastRatio(extreme['--tone-paper'], '#000000') >= 7, '极端底色应有可读文字')

// 强调色修正：白底配近白强调色 → 必须压深到达标
const fixed = ensureAccentContrast('#f5f5f2', '#eeeeee')
assert.ok(fixed.adjusted, '低对比强调色应被修正')
assert.ok(contrastRatio(fixed.accent, '#f5f5f2') >= 3.2, '修正后应达标')
const untouched = ensureAccentContrast('#0e0f12', '#c45c4a')
assert.equal(untouched.adjusted, false, '达标的强调色不应被改动')

// 用户可以在任一档选择反常明暗；修正方向必须跟实际底色走，而不是跟档位走
for (const [mode, ink, accent] of [
  ['light', '#000000', '#000000'],
  ['dark', '#ffffff', '#ffffff'],
] as const) {
  const corrected = ensureAccentContrast(ink, accent)
  assert.ok(corrected.adjusted, `${mode} 反常底色的低对比强调色应被修正`)
  assert.ok(contrastRatio(corrected.accent, ink) >= 3.2, `${mode} 反常底色修正后应达标`)

  const tokens = deriveSchemeTokens({ ink, accent }, mode)
  assert.ok(
    contrastRatio(tokens['--tone-cinnabar'], tokens['--tone-ink']) >= 3.2,
    `${mode} 反常底色的推导强调色应达标`,
  )
}

// normalizeCustomScheme：整体非法 → undefined；部分合法 → 保留并补全
assert.equal(normalizeCustomScheme(undefined), undefined)
assert.equal(normalizeCustomScheme('custom'), undefined)
const partial = normalizeCustomScheme({ dark: { ink: '#101820' } })
assert.equal(partial?.dark.ink, '#101820')
assert.equal(partial?.dark.accent, DEFAULT_CUSTOM_SCHEME.dark.accent)
assert.deepEqual(partial?.light, DEFAULT_CUSTOM_SCHEME.light)

console.log('custom-scheme derive: ok')

// —— DOM 应用：在 linkedom 中真实验证方案、内联 token 与 theme-color ——

const { document: testDocument } = parseHTML(
  '<html data-theme="light"><head><meta name="theme-color" content="#000000"></head><body></body></html>',
)
Object.defineProperty(globalThis, 'document', {
  value: testDocument,
  configurable: true,
})

applyThemeScheme('celadon')
assert.equal(document.documentElement.dataset.scheme, 'celadon')
assert.equal(
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.getAttribute('content'),
  THEME_SURFACE.celadon.light,
)

applyThemeScheme('pearl')
assert.equal(document.documentElement.dataset.scheme, 'pearl')
assert.equal(
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.getAttribute('content'),
  THEME_SURFACE.pearl.light,
)

applyThemeScheme('custom', {
  custom: {
    light: { ink: '#f6f2e9', accent: '#b43d26' },
    dark: { ink: '#101820', accent: '#7ea8dd' },
  },
})
assert.equal(document.documentElement.dataset.scheme, 'custom')
assert.equal(document.documentElement.style.getPropertyValue('--tone-ink'), '#f6f2e9')
assert.equal(
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.getAttribute('content'),
  '#f6f2e9',
)

document.documentElement.dataset.theme = 'dark'
applyThemeScheme('custom')
assert.equal(document.documentElement.style.getPropertyValue('--tone-ink'), '#101820')
assert.equal(
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.getAttribute('content'),
  '#101820',
)

applyThemeScheme('ink')
assert.equal(
  document.documentElement.style.getPropertyValue('--tone-ink'),
  '',
  '切回内置方案应移除内联 token',
)
assert.equal(document.documentElement.style.getPropertyValue('color-scheme'), '')
assert.equal(
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.getAttribute('content'),
  THEME_SURFACE.ink.dark,
)

document.documentElement.dataset.boot = 'splash'
applyThemeScheme('celadon')
assert.equal(
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.getAttribute('content'),
  THEME_SURFACE.ink.dark,
  '启动页期间 theme-color 应固定墨问夜读',
)
delete document.documentElement.dataset.boot

console.log('theme-scheme dom: ok')

console.log('\nALL THEME SCHEME CHECKS PASSED')
