import type { FolderProjectCard, GlossaryEntry, ImageAsset, TextRegion } from '~/types/editor'
import { findUnresolvedAssetNames } from '~/utils/assets'
import { translationNumberDifferences } from '~/utils/translation-number-differences'

export interface ReusableTranslation {
  translation: string
  sources: string[]
}

/** Only layout whitespace is ignored. Case, punctuation, numbers and icon names matter. */
function sourceKey(text: string) {
  return text.trim().split(/(\[icon:[^\]\r\n]+\])/gu).map((part, index) => index % 2 ? part : part.replace(/\s+/gu, ' ')).join('')
}

/** 同じ原文の訳を用語集・他領域から集め、同一の訳文には参照元だけを追加する。 */
export function findReusableTranslations(
  region: TextRegion,
  cardId: string,
  cards: readonly FolderProjectCard[],
  glossary: readonly GlossaryEntry[],
): ReusableTranslation[] {
  const key = sourceKey(region.originalText)
  if (!key)
    return []
  const matches = new Map<string, ReusableTranslation>()
  const add = (source: string, translation: string, label: string) => {
    if (sourceKey(source) !== key || !translation.trim())
      return
    const existing = matches.get(translation)
    if (existing)
      existing.sources.push(label)
    else matches.set(translation, { translation, sources: [label] })
  }
  glossary.forEach(entry => add(entry.source, entry.translation, `用語集: ${entry.source}`))
  cards.forEach(card => card.regions.forEach((item) => {
    if (card.id === cardId && item.id === region.id)
      return
    add(item.originalText, item.translatedText, `${card.imageName} / ${item.role || item.regionId}（${item.translationStatus === 'reviewed' ? '確認済み' : '下書き'}）`)
  }))
  return [...matches.values()]
}

/** 内容の正誤は判定せず、未登録アイコンや機械的な個数・数値差分を確認材料として返す。 */
export function translationConsistencyWarnings(source: string, translation: string, assets: readonly ImageAsset[]): string[] {
  if (!translation.trim())
    return []
  const warnings: string[] = []
  const tokens = (text: string) => [...text.matchAll(/\[icon:([^\]\r\n]+)\]/gu)].map(match => match[0]).sort()
  if (tokens(source).length > 0 && JSON.stringify(tokens(source)) !== JSON.stringify(tokens(translation)))
    warnings.push('原文と訳文でアイコンの名前・個数が異なります。')
  const unknown = findUnresolvedAssetNames(translation, assets)
  if (unknown.length)
    warnings.push(`未登録のアイコン: ${unknown.join('、')}`)
  const numberDifferences = translationNumberDifferences(source, translation)
  if (numberDifferences.length)
    warnings.push(`${numberDifferences.join('\n')}\n誤検知や自然な言い換えの場合は修正不要です。`)
  return warnings
}
