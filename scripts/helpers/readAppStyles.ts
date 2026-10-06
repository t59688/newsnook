import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

/** 按入口中的导入顺序读取应用样式，供样式契约测试使用。 */
export function readAppStyles(file = resolve('src/index.css')): string {
  const css = readFileSync(file, 'utf8')
  return css.replace(
    /@import\s+['"](\.\.?\/[^'"]+)['"];\s*/g,
    (_, relativePath: string) => readAppStyles(resolve(dirname(file), relativePath)),
  )
}
