import type { RegionCandidateOptions } from './options'
import type { OCRTextBlock } from '~/types/ocr'

/** 認識文字と寸法・信頼度から編集候補として使える行か判定する。 */
export function isCandidateBlock(
  block: OCRTextBlock,
  options: Required<
    Pick<
      RegionCandidateOptions,
      | 'imageHeight'
      | 'maximumNonAlphanumericRatio'
      | 'minimumConfidence'
      | 'minimumHeightRatio'
      | 'minimumLatinLetters'
    >
  >,
): boolean {
  const text = block.text.trim()
  if (!text || block.width < 2 || block.height < 2)
    return false
  if (
    block.confidence !== null
    && (block.confidence <= 0 || block.confidence < options.minimumConfidence)
  ) {
    return false
  }
  const latinLetters = text.match(/[a-z]/giu)?.length ?? 0
  if (latinLetters < options.minimumLatinLetters)
    return false
  const visibleCharacters = text.replace(/\s/gu, '')
  const alphanumericCharacters
    = visibleCharacters.match(/[a-z0-9]/giu)?.length ?? 0
  const nonAlphanumericRatio
    = visibleCharacters.length === 0
      ? 1
      : 1 - alphanumericCharacters / visibleCharacters.length
  if (nonAlphanumericRatio > options.maximumNonAlphanumericRatio)
    return false
  return block.height / options.imageHeight >= options.minimumHeightRatio
}

/** 信頼度不明は従来どおり選択。低信頼度は検出結果を残し、追加のみ任意にする。 */
export function isInitiallySelected(block: OCRTextBlock): boolean {
  return block.confidence === null || block.confidence > 40
}
