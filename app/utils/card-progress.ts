import type { TextRegion } from '~/types/editor'

export interface CardProgress {
  regions: number
  originalText: number
  translatedText: number
  reviewed: number
}

/** 領域・原文・訳文・確認状態からカードの編集進捗を数える。 */
export function cardProgress(
  regions: readonly Pick<
    TextRegion,
    'originalText' | 'translatedText' | 'translationStatus'
  >[],
): CardProgress {
  return {
    regions: regions.length,
    originalText: regions.filter(region => region.originalText.trim()).length,
    translatedText: regions.filter(region => region.translatedText.trim()).length,
    reviewed: regions.filter(region => region.translationStatus === 'reviewed').length,
  }
}

/** 件数を一覧用の進捗ラベルへ変換する。 */
export function progressLabel(
  completed: number,
  total: number,
): string {
  return total === 0 ? '—' : `${completed}/${total}`
}
