import type { FrameworkId } from '../frameworkDetect/types'
import { catalogDocument } from '../catalogEngine/extractors/domCards'

interface EngineRule { id: FrameworkId; generator: RegExp; signals?: RegExp[] }
const ENGINE_RULES: EngineRule[] = [
  { id: 'maccms', generator: /maccms|苹果cms/i, signals: [/(?:var|let|const)\s+maccms\s*=/, /\bMacPlayer\.(?:Show|PlayUrl|Flag)\b/] },
  { id: 'zanpian', generator: /zanpian|赞片/i, signals: [/(?:var|let|const)\s+zanpian\s*=/, /Powered\s+by\s+ZanPianCMS|(?:src|href)=["'][^"']*zanpiancms/i] },
  { id: 'seacms', generator: /seacms|海洋cms/i, signals: [/Powered\s+by\s+SeaCMS/i] },
  { id: 'fyfcms', generator: /feifei|fyfcms|飞飞/i, signals: [/\b(?:ff_player|cms_player)\b/, /\bvar\s+feifei\s*=/] },
  { id: 'wordpress', generator: /wordpress/i, signals: [/\/wp-content\//i] },
  { id: 'typecho', generator: /typecho/i, signals: [/Powered\s+by\s+Typecho/i] },
  { id: 'dedecms', generator: /dedecms|织梦/i, signals: [/\/include\/dedeajax\d*\.js/i, /Powered\s+by\s+DedeCMS/i] },
  { id: 'empirecms', generator: /empirecms|帝国cms/i, signals: [/Powered\s+by\s+EmpireCMS/i] },
  { id: 'pbootcms', generator: /pbootcms/i, signals: [/Powered\s+by\s+PbootCMS/i] },
  { id: 'eyoucms', generator: /eyoucms|易优cms/i, signals: [/Powered\s+by\s+EyouCMS/i] },
  { id: 'zblog', generator: /z-blog|zblog/i, signals: [/\/zb_system\/script\/common\.js/i] },
  { id: 'drupal', generator: /drupal/i, signals: [/data-drupal-selector=/i, /\bdrupalSettings\b/] },
  { id: 'joomla', generator: /joomla/i, signals: [/\bJoomla\.getOptions\(/i] },
  { id: 'jeecms', generator: /jeecms/i, signals: [/Powered\s+by\s+JEECMS/i] },
  { id: 'hugo', generator: /hugo/i }, { id: 'hexo', generator: /hexo/i }, { id: 'ghost', generator: /ghost/i },
]

export function detectEngineIdentity(html: string, document?: Document): FrameworkId | undefined {
  const doc = document ?? catalogDocument(html)
  const generators = [...doc.querySelectorAll('meta[name]')].filter((node) => node.getAttribute('name')?.toLowerCase() === 'generator').map((node) => node.getAttribute('content') ?? '').join(' ')
  const candidates = ENGINE_RULES.map((rule) => ({
    id: rule.id,
    score: (rule.generator.test(generators) ? 100 : 0) + (rule.signals?.filter((signal) => signal.test(html)).length ?? 0) * 30,
  }))
  // FeiFei v4 templates expose cms + ff-* controls instead of a CMS name.
  if (/\b(?:var|let|const)\s+cms\s*=/.test(html) && doc.querySelector('.ff-search') && /\/Public\/js\/system\.js/i.test(html)) {
    candidates.find((candidate) => candidate.id === 'fyfcms')!.score += 80
  }
  const ranked = candidates.filter((candidate) => candidate.score > 0).sort((a, b) => b.score - a.score)
  if (!ranked.length) return undefined
  if (ranked[1]?.score === ranked[0].score) return 'generic'
  return ranked[0].id
}
