/**
 * WebView / Chrome 69 CSS post-process helpers shared by vite build + tests.
 *
 * Tailwind v4 relies on `@property` initial values and `:where()` selectors.
 * Our build strips `@property` for Chrome < 85; lightningcss does not unwrap
 * `:where()` even when targeting Chrome 69. Without these fixes, utilities like
 * `divide-y` / `divide-haze` silently drop on Android WebView.
 */

/**
 * Replace `:where(inner)` with `inner`, balancing parentheses so nested
 * selectors like `:not(:last-child)` survive.
 */
export function unwrapWhereSelectors(css: string): string {
  let out = ''
  let i = 0
  while (i < css.length) {
    if (css.startsWith(':where(', i)) {
      const start = i + ':where('.length
      let depth = 1
      let j = start
      while (j < css.length && depth > 0) {
        const ch = css[j]
        if (ch === '(') depth += 1
        else if (ch === ')') depth -= 1
        j += 1
      }
      out += css.slice(start, j - 1)
      i = j
      continue
    }
    out += css[i]
    i += 1
  }
  return out
}

/**
 * After `@property` is stripped, Tailwind's variable defaults live only inside a
 * complex `@supports` gate that some Android WebViews do not match. Inject an
 * unconditional fallback so border/divide/space utilities keep working.
 */
export const TW_VAR_FALLBACK_CSS =
  '*,:before,:after,::backdrop{--tw-border-style:solid;--tw-divide-y-reverse:0;--tw-space-y-reverse:0;--tw-space-x-reverse:0;--tw-gradient-position:initial;--tw-gradient-from:#0000;--tw-gradient-via:#0000;--tw-gradient-to:#0000;--tw-gradient-stops:initial;--tw-gradient-via-stops:initial;--tw-gradient-from-position:0%;--tw-gradient-via-position:50%;--tw-gradient-to-position:100%}'

export function applyWebViewCssCompat(css: string): string {
  return `${unwrapWhereSelectors(css)}\n${TW_VAR_FALLBACK_CSS}\n`
}
