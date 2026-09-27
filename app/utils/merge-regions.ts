import type { TextRegion } from '~/types/editor'
import { reconcileInlineAssetStyles } from '~/utils/inline-assets'
import { reconcileTextStyles } from '~/utils/text-styles'
import { statusForTranslation } from '~/utils/translation-status'

export interface MergeOptions {
  baseId: string
  separator: string
  originalText?: string
  translatedText?: string
}

/** 選択順に文章を連結し、画像上の位置と文字装飾を維持して基準領域へまとめる。 */
export function mergeTextRegions(regions: readonly TextRegion[], options: MergeOptions): TextRegion {
  const base = regions.find(region => region.id === options.baseId)
  if (regions.length < 2 || new Set(regions.map(region => region.id)).size !== regions.length || !base)
    throw new Error('結合する領域を2つ以上選んでください。')
  const x = Math.min(...regions.map(region => region.x))
  const y = Math.min(...regions.map(region => region.y))
  const joined = regions.filter(region => region.translatedText.length)
  let offset = 0
  const styles = joined.map((region, index) => {
    if (index)
      offset += options.separator.length
    const start = offset
    offset += region.translatedText.length
    return {
      text: region.textStyles.map(style => ({ ...style, start: start + style.start, end: start + style.end })),
      assets: region.inlineAssetStyles.map(style => ({ ...style, start: start + style.start, end: start + style.end })),
    }
  })
  const before = joined.map(region => region.translatedText).join(options.separator)
  const translatedText = options.translatedText ?? before
  return {
    ...base,
    x,
    y,
    width: Math.max(...regions.map(region => region.x + region.width)) - x,
    height: Math.max(...regions.map(region => region.y + region.height)) - y,
    originalText: options.originalText ?? regions.map(region => region.originalText).filter(Boolean).join(options.separator),
    translatedText,
    translationStatus: statusForTranslation(translatedText),
    textStyles: reconcileTextStyles(before, translatedText, styles.flatMap(style => style.text)),
    inlineAssetStyles: reconcileInlineAssetStyles(before, translatedText, styles.flatMap(style => style.assets)),
    exclusionAreas: regions.flatMap(region => region.exclusionAreas.map((area, index) => ({ ...area, id: `${region.id}:exclusion:${index}`, x: region.x + area.x - x, y: region.y + area.y - y }))),
    sourceIcons: regions.flatMap(region => (region.sourceIcons ?? []).map((icon, index) => ({ ...icon, id: `${region.id}:icon:${index}`, x: region.x + icon.x - x, y: region.y + icon.y - y }))),
    manualMaskStrokes: regions.flatMap(region => region.manualMaskStrokes.map(stroke => ({ ...stroke, points: stroke.points.map(point => ({ x: region.x + point.x - x, y: region.y + point.y - y })) }))),
  }
}

/** 矩形間の空白距離。重なる領域は距離0として扱う。 */
export function regionDistance(a: TextRegion, b: TextRegion) {
  return Math.hypot(Math.max(0, a.x - b.x - b.width, b.x - a.x - a.width), Math.max(0, a.y - b.y - b.height, b.y - a.y - a.height))
}
