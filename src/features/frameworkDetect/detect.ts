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
import { detectEngineIdentity } from '../siteCatalog/detection'

export function detectFramework(html: string, pageUrl: string, document?: Document): FrameworkHint | null {
  const identity = detectEngineIdentity(html, document)
  if (identity) {
    const detectors = { maccms: detectMaccms, seacms: detectSeacms, fyfcms: detectFyfcms, zanpian: detectZanpian, wordpress: detectWordpress, hugo: detectHugo, hexo: detectHexo, ghost: detectGhost, jeecms: detectJeecms }
    const detector = detectors[identity as keyof typeof detectors]
    const hint = detector?.(html, pageUrl)
    return hint ?? { framework: identity, paginationPattern: { kind: 'next-link' } }
  }
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
