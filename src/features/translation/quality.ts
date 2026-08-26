import { detectLanguage } from './detectLanguage'
import type { TranslationLanguage } from './types'

/**
 * 判断文章标题或内容是否属于需要翻译的外文。
 * 优先检查 title：避免 summary 中的中文版权声明或站名导致英文标题被漏翻。
 */
export function isArticleForeign(
  article: { title: string; summary?: string },
  targetLanguage: TranslationLanguage,
): boolean {
  const title = article.title?.trim() || ''
  const summary = article.summary?.trim() || ''
  if (!title && !summary) return false

  const isTargetChinese = targetLanguage === 'zh-Hans' || targetLanguage === 'zh-Hant'

  // 1. 优先分析标题本身的字符组成与语种
  if (title) {
    const titleHan = (title.match(/[\u4e00-\u9fa5\u3400-\u4dbf]/g) || []).length
    const titleLatin = (title.match(/[a-zA-Z]/g) || []).length
    const titleScriptTotal = titleHan + titleLatin

    if (isTargetChinese) {
      // 目标为中文时：若标题中拉丁字母较多（>= 6 个）且汉字极少（<= 2 个或占比 < 25%），直接判定为外文待翻译
      if (titleLatin >= 6 && (titleHan <= 2 || titleHan / Math.max(1, titleScriptTotal) < 0.25)) {
        return true
      }
      // 标题包含日文假名或韩文谚文
      if (/[\u3040-\u30ff\uac00-\ud7af]/.test(title)) {
        return true
      }
    } else {
      // 目标为非中文（如英文/日文等）：若标题检测出的语种与目标语种不同，则需要翻译
      const titleDetected = detectLanguage(title)
      if (!titleDetected.usedFallback && titleDetected.language !== targetLanguage) {
        return true
      }
    }
  }

  // 2. 结合标题与摘要整体检测
  const combined = `${title} ${summary}`.trim()
  const detected = detectLanguage(combined)

  if (detected.usedFallback) {
    // 样本过短置信不足时的回退是英语，不能据此当成外文——
    // 否则「中文短标题 + 空摘要」会被误判并对已是目标语言的文本发起翻译请求。
    // 按字符构成兜底：仅目标为中文且样本明显是拉丁文时才进翻译队列。
    if (!isTargetChinese) return false
    const han = (combined.match(/[\u4e00-\u9fa5\u3400-\u4dbf]/g) || []).length
    const latin = (combined.match(/[a-zA-Z]/g) || []).length
    return latin >= 6 && han <= 2
  }

  const isDetectedChinese = detected.language === 'zh-Hans' || detected.language === 'zh-Hant'

  if (isTargetChinese) {
    if (!isDetectedChinese) return true
    return false
  }

  return detected.language !== targetLanguage
}

/**
 * 校验翻译结果的质量与完整度，拦截严重残缺、未翻译、或中英夹杂错乱（如音译幻觉残留英文句子）的异常译文。
 */
export function isValidTranslationQuality(
  originalText: string,
  translatedText: string,
  targetLanguage: TranslationLanguage,
): boolean {
  const orig = originalText.trim()
  const trans = translatedText.trim()
  if (!trans || !orig) return false

  // 1. 如果译文与原文完全相同（且原文为明显外文），说明未被翻译
  if (orig.toLowerCase() === trans.toLowerCase()) {
    const origLatin = (orig.match(/[a-zA-Z]/g) || []).length
    if (origLatin >= 8) {
      return false
    }
  }

  const isTargetChinese = targetLanguage === 'zh-Hans' || targetLanguage === 'zh-Hant'
  if (isTargetChinese) {
    const origHan = (orig.match(/[\u4e00-\u9fa5\u3400-\u4dbf]/g) || []).length
    const origLatin = (orig.match(/[a-zA-Z]/g) || []).length
    const transHan = (trans.match(/[\u4e00-\u9fa5\u3400-\u4dbf]/g) || []).length
    const transLatin = (trans.match(/[a-zA-Z]/g) || []).length
    const transLatinWords = (trans.match(/[a-zA-Z]+/g) || []).length
    const transScriptTotal = transHan + transLatin

    // 原文为外文（拉丁字母多且原无汉字）
    if (origLatin >= 8 && origHan <= 2) {
      // (a) 译文中完全没有汉字，且仍是长英文 -> 翻译失败
      if (transHan === 0 && transLatin >= 6) {
        return false
      }

      // (b) 译文只翻译了 1~2 个字，剩下绝大部分依然是长篇英文句子
      // 例如："Wang Gungwu on the lessons of Chinese history and the Cold War" -> "王 gunshot on Chinese history and the Cold War"
      // transHan=1, transLatin=34, transLatinWords=8 -> 典型的分词断裂/未翻译完
      if (transLatinWords >= 4 && transHan <= 2 && transLatin >= 12) {
        return false
      }

      // (c) 比例校验：如果总字符长且拉丁字符占比过高（> 75%）而汉字寥寥无几
      if (transScriptTotal >= 14 && transLatin / transScriptTotal > 0.75 && transHan <= 2) {
        return false
      }
    }
  }

  return true
}
