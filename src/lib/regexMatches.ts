/**
 * RegExp#exec iterator compatible with older Android WebViews (including Chromium 69).
 * Unlike String#matchAll, this does not require a newer built-in prototype method.
 */
export function regexMatches(input: string, expression: RegExp): RegExpExecArray[] {
  const flags = expression.flags.indexOf('g') >= 0 ? expression.flags : expression.flags + 'g'
  const matcher = new RegExp(expression.source, flags)
  const matches: RegExpExecArray[] = []
  let match: RegExpExecArray | null
  while ((match = matcher.exec(input)) !== null) {
    matches.push(match)
    if (!match[0].length) matcher.lastIndex += 1
  }
  return matches
}
