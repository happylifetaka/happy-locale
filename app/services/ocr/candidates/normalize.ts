import type { RegionCandidateOptions } from './options'
import type { OCRTextBlock } from '~/types/ocr'
import { isCandidateBlock } from './filter'
import { refineLabel, trimHeadingDecorations } from './headings'
import { candidateDetectionSettings } from './settings'

/** 装飾・画像補正→縮尺復元→フィルタの順序と、補正済み行の同一性を維持する。 */
export function normalizeCandidateBlocks(blocks: readonly OCRTextBlock[], options: RegionCandidateOptions) {
  const settings = candidateDetectionSettings(options.settings)
  const scale = Math.max(1, options.scale ?? 1)
  const filters = {
    imageHeight: options.imageHeight,
    minimumConfidence: options.minimumConfidence ?? settings.minimumConfidence,
    minimumLatinLetters: options.minimumLatinLetters ?? settings.minimumLatinLetters,
    maximumNonAlphanumericRatio: options.maximumNonAlphanumericRatio ?? settings.maximumNonAlphanumericRatio,
    minimumHeightRatio: options.minimumHeightRatio ?? settings.minimumHeightRatio,
  }
  const trimmedLines = new WeakSet<OCRTextBlock>()
  const normalized = blocks
    .map((original) => {
      const confirmedLabel = options.labelBounds?.includes(original) ?? false
      const decoratedHeadings = settings.headingDecorations === 'uppercase-latin'
      const trimmed = decoratedHeadings && options.words ? trimHeadingDecorations(original, options.words, options.refineHeadingBounds) : original
      let block = trimmed !== original && options.refineHeadingBounds ? options.refineHeadingBounds(trimmed) : trimmed
      // 装飾の誤読パターンに一致しなくても、大文字ラベルは画像で裏付けて補正する。
      // 認識文字自体は変更しない。暗い背景の種別や曖昧な画像では元の枠を維持する。
      if (decoratedHeadings && block === original)
        block = refineLabel(original, options)
      if (confirmedLabel)
        block = original
      if (!confirmedLabel && block === original && options.refineTextBounds)
        block = options.refineTextBounds(original)
      const normalized = {
        ...block,
        x: block.x / scale,
        y: block.y / scale,
        width: block.width / scale,
        height: block.height / scale,
      }
      if (block !== original || confirmedLabel)
        trimmedLines.add(normalized)
      return normalized
    })
    .filter(block => isCandidateBlock(block, filters))
    .sort((a, b) => a.y - b.y || a.x - b.x)

  return { lines: normalized, trimmedLines }
}
