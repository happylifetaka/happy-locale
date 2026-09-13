import type { OCRResult, OCRTextBlock } from '~/services/ocr/types'
import type { ImageAsset, SourceIcon, TextRegion } from '~/types/editor'

/** 原文アイコンの参照切れや領域からのはみ出しを検出する。 */
export function sourceIconProblems(region: TextRegion, assets: readonly ImageAsset[]): string[] {
  const problems: string[] = []
  for (const [index, icon] of (region.sourceIcons ?? []).entries()) {
    if (!assets.some(asset => asset.id === icon.assetId))
      problems.push(`アイコン${index + 1}のアセットが見つかりません。`)
    if (![icon.x, icon.y, icon.width, icon.height].every(Number.isFinite)
      || icon.x < 0 || icon.y < 0 || icon.width <= 0 || icon.height <= 0
      || icon.x + icon.width > region.width || icon.y + icon.height > region.height) {
      problems.push(`アイコン${index + 1}が領域からはみ出しています。`)
    }
  }
  return problems
}

/** 二つのOCR矩形が縦方向に重なる割合を求める。 */
function overlap(a: OCRTextBlock, b: OCRTextBlock) {
  return Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
    / Math.max(1, Math.min(a.height, b.height))
}

/** 拡大・余白付きOCRの単語座標を領域内へ戻し、同じ行の所定位置にアイコントークンを挿入する。 */
export function textWithSourceIcons(
  result: OCRResult,
  icons: readonly SourceIcon[],
  assets: readonly ImageAsset[],
  scale = 3,
  padding = 12,
): string {
  if (!icons.length)
    return result.text
  if (!result.words?.length)
    throw new Error('単語の位置を認識できませんでした。OCR結果とアイコンの位置を手動で確認してください。')
  const rows: OCRTextBlock[][] = []
  const words = result.words.map(word => ({
    ...word,
    x: (word.x - padding) / scale,
    y: (word.y - padding) / scale,
    width: word.width / scale,
    height: word.height / scale,
  })).filter(word => word.text.trim())
  for (const word of words.sort((a, b) => a.y - b.y || a.x - b.x)) {
    const row = rows.findLast(items => items.some(item => overlap(item, word) >= 0.5))
    if (row)
      row.push(word)
    else rows.push([word])
  }
  for (const icon of icons) {
    const asset = assets.find(asset => asset.id === icon.assetId)
    if (!asset)
      throw new Error('アイコンに割り当てたアセットが見つかりません。')
    const block: OCRTextBlock = { ...icon, text: `[icon:${asset.name}]`, confidence: null }
    const matchingRows = rows.filter(items => items.some(item => overlap(item, block) >= 0.3))
    matchingRows.sort((a, b) => {
      const center = (items: OCRTextBlock[]) => items.reduce((sum, item) => sum + item.y + item.height / 2, 0) / items.length
      return Math.abs(center(a) - icon.y - icon.height / 2) - Math.abs(center(b) - icon.y - icon.height / 2)
    })
    if (matchingRows[0])
      matchingRows[0].push(block)
    else rows.push([block])
  }
  return rows.sort((a, b) => Math.min(...a.map(item => item.y)) - Math.min(...b.map(item => item.y)))
    .map(row => row.sort((a, b) => a.x - b.x).map(item => item.text.trim()).join(' '))
    .join('\n')
}
