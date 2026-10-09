function isDigit(char: string | undefined): boolean {
  return Boolean(char && char >= '0' && char <= '9')
}

/**
 * 知乎大量内容 ID 已超过 Number.MAX_SAFE_INTEGER。直接 JSON.parse 会在 DTO 解码前
 * 悄悄把 19 位 ID 四舍五入，随后点卡片会请求一个根本不存在的回答/问题。
 *
 * 这里只把 JSON 文本中的“整数 token”在进入 JSON.parse 前按需转成字符串；字符串、
 * 小数、指数、时间戳等都保持原样。这样领域层始终把上游 ID 当不透明字符串处理。
 */
export function preserveUnsafeJsonIntegers(source: string): string {
  let output = ''
  let index = 0
  let inString = false
  let escaped = false

  while (index < source.length) {
    const char = source[index]!

    if (inString) {
      output += char
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      index += 1
      continue
    }

    if (char === '"') {
      inString = true
      output += char
      index += 1
      continue
    }

    if (char === '-' || isDigit(char)) {
      const start = index
      if (char === '-') index += 1
      while (isDigit(source[index])) index += 1

      let integerOnly = true
      if (source[index] === '.') {
        integerOnly = false
        index += 1
        while (isDigit(source[index])) index += 1
      }
      if (source[index] === 'e' || source[index] === 'E') {
        integerOnly = false
        index += 1
        if (source[index] === '+' || source[index] === '-') index += 1
        while (isDigit(source[index])) index += 1
      }

      const token = source.slice(start, index)
      if (integerOnly && /^-?\d+$/.test(token) && !Number.isSafeInteger(Number(token))) {
        output += `"${token}"`
      } else {
        output += token
      }
      continue
    }

    output += char
    index += 1
  }

  return output
}

export function parseZhihuJson(source: string): unknown {
  return JSON.parse(preserveUnsafeJsonIntegers(source)) as unknown
}
