import { detectMaccms } from './adapters/maccms'
import { detectNnyy } from './adapters/nnyy'
import { detectSeacms } from './adapters/seacms'
import { detectFyfcms } from './adapters/fyfcms'
import { detectJeecms } from './adapters/jeecms'
import { detectZanpian } from './adapters/zanpian'
import { detectWordpress } from './adapters/wordpress'
import { detectHugo } from './adapters/hugo'
import { detectHexo } from './adapters/hexo'
import { detectGhost } from './adapters/ghost'
import { detectGenericNextLink } from './adapters/generic'
import type { FrameworkHint } from './types'

export function detectFramework(html: string, pageUrl: string): FrameworkHint | null {
  return (
    detectMaccms(html, pageUrl) ??
    detectNnyy(html, pageUrl) ??
    detectSeacms(html, pageUrl) ??
    detectFyfcms(html, pageUrl) ??
    detectJeecms(html, pageUrl) ??
    detectZanpian(html, pageUrl) ??
    detectWordpress(html, pageUrl) ??
    detectHugo(html, pageUrl) ??
    detectHexo(html, pageUrl) ??
    detectGhost(html, pageUrl) ??
    detectGenericNextLink(html, pageUrl) ??
    null
  )
}
