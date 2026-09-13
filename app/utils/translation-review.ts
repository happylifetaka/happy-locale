import type { FolderProjectCard, ImageAsset, TextRegion } from '~/types/editor'
import type { TranslationMatchResult } from '~/utils/csv'
import { findUnresolvedAssetNames } from '~/utils/assets'
import { translationConsistencyWarnings } from '~/utils/translation-reuse'

export interface TranslationReviewRow {
  key: string
  cardId: string
  cardName: string
  region: TextRegion
  translation: string
  selected: boolean
  importWarnings: string[]
  error: string
}

/** 未選択の変更が残る場合は一覧を閉じず、反映対象の変更行だけを返す。 */
export function reviewApplySelection(rows: readonly TranslationReviewRow[]) {
  const changed = rows.filter(row => row.translation !== row.region.translatedText)
  const selected = changed.filter(row => row.selected)
  return { rows: selected, closeAfterApply: selected.length > 0 && selected.length === changed.length }
}

/** 確認画面専用の下書きを作り、入力途中の訳文が元のカードへ流れ込まないようにする。 */
export function createTranslationReviewRows(cards: readonly FolderProjectCard[]): TranslationReviewRow[] {
  return cards.flatMap(card => card.regions.map(region => ({
    key: JSON.stringify([card.id, region.id]),
    cardId: card.id,
    cardName: card.imageName,
    region: JSON.parse(JSON.stringify(region)),
    translation: region.translatedText,
    selected: false,
    importWarnings: [],
    error: '',
  })))
}

/** 一行の翻訳下書きから原文・訳文・アイコン等の確認事項を集める。 */
export function reviewWarnings(row: TranslationReviewRow, assets: readonly ImageAsset[]): string[] {
  const warnings = [...row.importWarnings]
  if (!row.region.originalText.trim())
    warnings.push('原文がありません。')
  if (!row.translation.trim())
    warnings.push('未翻訳です。')
  warnings.push(...translationConsistencyWarnings(row.region.originalText, row.translation, assets))
  const unknownSource = findUnresolvedAssetNames(row.region.originalText, assets)
  if (unknownSource.length)
    warnings.push(`原文の未登録アセット: ${unknownSource.join('、')}`)
  for (const [label, text] of [['原文', row.region.originalText], ['訳文', row.translation]]) {
    if (/\[\s*icon\b/iu.test(text!.replace(/\[icon:[^[\]\r\n]+\]/gu, '')))
      warnings.push(`${label}のアセット記法が壊れています。挿入メニューから入れ直してください。`)
  }
  if (row.error)
    warnings.push(row.error)
  return warnings
}

/** CSVが指定した行だけを更新する。CSVの原文不一致・重複がある行は自動選択しない。 */
export function mergeReviewImport(rows: TranslationReviewRow[], result: TranslationMatchResult) {
  for (const row of rows) {
    const value = result.translationsByCard.get(row.cardId)?.get(row.region.regionId)
    if (value === undefined)
      continue
    row.translation = value
    row.error = ''
    row.importWarnings = result.issues.filter(issue => issue.cardId === row.cardId && issue.regionId === row.region.regionId).map(issue =>
      issue.kind === 'original-mismatch' ? `CSVの原文が一致しません: ${issue.importedOriginal}` : 'CSVに重複行があります。最後の行の訳文です。',
    )
    row.selected = row.importWarnings.length === 0 && value !== row.region.translatedText
  }
}

/** 確認画面を開いた後の原文・訳文の変更を検出し、古い下書きによる上書きを防ぐ。 */
export function reviewRowsAreCurrent(rows: readonly TranslationReviewRow[], cards: readonly FolderProjectCard[]) {
  return rows.every((row) => {
    const region = cards.find(card => card.id === row.cardId)?.regions.find(region => region.id === row.region.id)
    return region && region.regionId === row.region.regionId
      && region.originalText === row.region.originalText && region.translatedText === row.region.translatedText
  })
}
