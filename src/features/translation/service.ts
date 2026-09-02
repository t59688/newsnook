import { resolveAiFeatureConfig } from './aiConfig'
import { normalizeChineseVariant } from './chineseVariant'
import { cleanOpenAiTranslation } from './openai'
import { detectLanguage, sampleTextForDetection } from './detectLanguage'
import { createTranslationProvider } from './providers'
import type {
  TranslateArticleOptions,
  TranslatedArticleContent,
  TranslationLanguage,
  TranslationPrefs,
  TranslationProvider,
  TranslationProviderId,
  TranslationSourceLanguage,
} from './types'
import { isLocalTranslationProviderId } from './types'

const SKIP_PARENTS = new Set(['CODE', 'PRE', 'SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG'])
const COMPARISON_BLOCK_SELECTOR =
  'p,li,h1,h2,h3,h4,blockquote,figcaption,td,th,div,section,article'

function shouldTranslate(text: string): boolean {
  const trimmed = text.trim()
  return trimmed.length > 0 && /[\p{L}\p{N}]/u.test(trimmed)
}

function trimParts(text: string): { prefix: string; content: string; suffix: string } {
  const content = text.trim()
  const start = text.indexOf(content)
  return {
    prefix: text.slice(0, start),
    content,
    suffix: text.slice(start + content.length),
  }
}

function isBlocked(element: Element): boolean {
  return [...SKIP_PARENTS].some((tag) => element.closest(tag.toLowerCase()))
}

function finalizeTranslatedText(text: string, targetLanguage: TranslationLanguage): string {
  return normalizeChineseVariant(cleanOpenAiTranslation(text), targetLanguage)
}

export function resolveSourceLanguage(
  sourceLanguage: TranslationSourceLanguage,
  providerId: TranslationProviderId,
  sample: string,
): { sourceLanguage: TranslationSourceLanguage; usedFallback: boolean } {
  if (sourceLanguage !== 'auto') {
    return { sourceLanguage, usedFallback: false }
  }
  if (!isLocalTranslationProviderId(providerId)) {
    return { sourceLanguage: 'auto', usedFallback: false }
  }
  const detected = detectLanguage(sample)
  return { sourceLanguage: detected.language, usedFallback: detected.usedFallback }
}

export class TranslationService {
  private readonly provider: TranslationProvider

  constructor(provider: TranslationProvider) {
    this.provider = provider
  }

  async translateArticle(
    title: string,
    html: string,
    prefs: Pick<TranslationPrefs, 'sourceLanguage' | 'targetLanguage' | 'displayMode'>,
    options?: TranslateArticleOptions,
  ): Promise<TranslatedArticleContent> {
    const sample = sampleTextForDetection(title, html)
    const resolved = resolveSourceLanguage(prefs.sourceLanguage, this.provider.id, sample)
    const resolvedPrefs = {
      ...prefs,
      sourceLanguage: resolved.sourceLanguage,
    }
    const document = new DOMParser().parseFromString(
      `<!doctype html><html><body>${html}</body></html>`,
      'text/html',
    )
    const content =
      prefs.displayMode === 'compare'
        ? await this.translateComparison(document, title, resolvedPrefs, options)
        : await this.translateReplacement(document, title, resolvedPrefs, options)
    return {
      ...content,
      resolvedSourceLanguage: resolved.sourceLanguage,
      usedFallback: resolved.usedFallback,
    }
  }

  private async translateReplacement(
    document: Document,
    title: string,
    prefs: Pick<TranslationPrefs, 'sourceLanguage' | 'targetLanguage'>,
    options?: TranslateArticleOptions,
  ): Promise<TranslatedArticleContent> {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    const nodes: Text[] = []
    const parts: ReturnType<typeof trimParts>[] = []
    let current = walker.nextNode()

    while (current) {
      const node = current as Text
      const parent = node.parentElement
      if (parent && !isBlocked(parent) && shouldTranslate(node.data)) {
        nodes.push(node)
        parts.push(trimParts(node.data))
      }
      current = walker.nextNode()
    }

    const texts = [title.trim(), ...parts.map((part) => part.content)]
    let currentTitle = title
    let completedCount = 0
    let lastPartialAt = 0

    options?.onProgress?.({ completed: 0, total: texts.length })
    const translations = await this.provider.translate({
      texts,
      sourceLanguage: prefs.sourceLanguage,
      targetLanguage: prefs.targetLanguage,
      signal: options?.signal,
      onBatch: (batchTranslations, startIndex) => {
        batchTranslations.forEach((translatedText, i) => {
          const textIndex = startIndex + i
          const normalized = finalizeTranslatedText(translatedText, prefs.targetLanguage)
          if (textIndex === 0) {
            currentTitle = normalized
          } else {
            const nodeIndex = textIndex - 1
            const node = nodes[nodeIndex]
            const part = parts[nodeIndex]
            if (node && part) {
              node.data = `${part.prefix}${normalized}${part.suffix}`
              node.parentElement?.setAttribute('data-translated', 'true')
            }
          }
        })
        completedCount += batchTranslations.length
        options?.onProgress?.({ completed: completedCount, total: texts.length })
        // 序列化整篇 HTML 很贵：约 120ms 节流一次，最后一批必发
        const now = Date.now()
        const isLast = completedCount >= texts.length
        if (options?.onPartial && (isLast || now - lastPartialAt >= 120)) {
          lastPartialAt = now
          options.onPartial({ title: currentTitle, html: document.body.innerHTML })
        }
      },
    })
    if (translations.length !== texts.length) throw new Error('翻译服务返回的段落数量不匹配')

    nodes.forEach((node, index) => {
      const part = parts[index]
      const normalized = finalizeTranslatedText(translations[index + 1], prefs.targetLanguage)
      node.data = `${part.prefix}${normalized}${part.suffix}`
      node.parentElement?.setAttribute('data-translated', 'true')
    })
    options?.onProgress?.({ completed: texts.length, total: texts.length })
    return {
      title: finalizeTranslatedText(translations[0] ?? currentTitle, prefs.targetLanguage),
      html: document.body.innerHTML,
    }
  }

  private async translateComparison(
    document: Document,
    title: string,
    prefs: Pick<TranslationPrefs, 'sourceLanguage' | 'targetLanguage'>,
    options?: TranslateArticleOptions,
  ): Promise<TranslatedArticleContent> {
    // 只选最内层语义块，避免 blockquote > p、li > p 等结构被重复翻译。
    const semanticBlocks = Array.from(
      document.body.querySelectorAll<HTMLElement>(COMPARISON_BLOCK_SELECTOR),
    ).filter(
      (element) =>
        !isBlocked(element) &&
        !element.querySelector(COMPARISON_BLOCK_SELECTOR) &&
        shouldTranslate(element.textContent ?? ''),
    )
    const blocks =
      semanticBlocks.length || !shouldTranslate(document.body.textContent ?? '')
        ? semanticBlocks
        : [document.body]
    const texts = [title.trim(), ...blocks.map((block) => (block.textContent ?? '').trim())]
    let currentTitle = title
    let completedCount = 0
    let lastPartialAt = 0

    options?.onProgress?.({ completed: 0, total: texts.length })
    const translations = await this.provider.translate({
      texts,
      sourceLanguage: prefs.sourceLanguage,
      targetLanguage: prefs.targetLanguage,
      signal: options?.signal,
      onBatch: (batchTranslations, startIndex) => {
        batchTranslations.forEach((translatedText, i) => {
          const textIndex = startIndex + i
          const normalized = finalizeTranslatedText(translatedText, prefs.targetLanguage)
          if (textIndex === 0) {
            currentTitle = normalized
          } else {
            const blockIndex = textIndex - 1
            const block = blocks[blockIndex]
            if (block) {
              let translationSpan = block.querySelector<HTMLElement>(':scope > .reader-translation')
              if (!translationSpan) {
                translationSpan = document.createElement('span')
                translationSpan.className = 'reader-translation'
                translationSpan.lang = prefs.targetLanguage
                block.append(translationSpan)
              }
              translationSpan.textContent = normalized
              block.setAttribute('data-translated', 'true')
            }
          }
        })
        completedCount += batchTranslations.length
        options?.onProgress?.({ completed: completedCount, total: texts.length })
        const now = Date.now()
        const isLast = completedCount >= texts.length
        if (options?.onPartial && (isLast || now - lastPartialAt >= 120)) {
          lastPartialAt = now
          options.onPartial({ title: currentTitle, html: document.body.innerHTML })
        }
      },
    })
    if (translations.length !== texts.length) throw new Error('翻译服务返回的段落数量不匹配')

    blocks.forEach((block, index) => {
      let translationSpan = block.querySelector<HTMLElement>(':scope > .reader-translation')
      if (!translationSpan) {
        translationSpan = document.createElement('span')
        translationSpan.className = 'reader-translation'
        translationSpan.lang = prefs.targetLanguage
        block.append(translationSpan)
      }
      translationSpan.textContent = finalizeTranslatedText(
        translations[index + 1],
        prefs.targetLanguage,
      )
      block.setAttribute('data-translated', 'true')
    })
    options?.onProgress?.({ completed: texts.length, total: texts.length })
    return {
      title: finalizeTranslatedText(translations[0] ?? currentTitle, prefs.targetLanguage),
      html: document.body.innerHTML,
    }
  }
}

export function createTranslationService(prefs: TranslationPrefs): TranslationService {
  const config = isLocalTranslationProviderId(prefs.provider)
    ? undefined
    : prefs.provider === 'openai'
      ? resolveAiFeatureConfig(prefs, 'translation')
      : prefs.cloud[prefs.provider]
  return new TranslationService(createTranslationProvider(prefs.provider, config))
}
