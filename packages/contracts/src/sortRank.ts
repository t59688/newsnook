/**
 * 可插入排序键：客户端在两个相邻 rank 之间生成新键，不必批量重写邻居。
 * 采用短字符串（base36 风格），比较用普通字典序。
 *
 * 这个模块刻意不依赖 zod，客户端可以直接引它而不把 schema 打进 App 包体。
 */

const RANK_DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz'
const RANK_BASE = RANK_DIGITS.length

function digitValue(char: string): number {
  const index = RANK_DIGITS.indexOf(char)
  return index < 0 ? 0 : index
}

export function rankBetween(before: string | null, after: string | null): string {
  const lower = before ?? ''
  const upper = after ?? ''
  let prefix = ''
  let position = 0

  for (;;) {
    const lowDigit = position < lower.length ? digitValue(lower[position]!) : 0
    const highDigit = position < upper.length ? digitValue(upper[position]!) : RANK_BASE
    if (highDigit - lowDigit > 1) {
      const middle = Math.floor((lowDigit + highDigit) / 2)
      return `${prefix}${RANK_DIGITS[middle]}`
    }
    prefix += RANK_DIGITS[lowDigit]
    position += 1
    // 上界与下界在这一位相邻或相等：继续向后一位细分
    if (position > 64) return `${prefix}m`
  }
}

/** 按序号生成初始 rank；同一批次内保持稳定且严格递增 */
export function rankForIndex(index: number): string {
  const normalized = Math.max(0, Math.floor(index)) + 1
  return `${normalized.toString(RANK_BASE).padStart(6, '0')}`
}
