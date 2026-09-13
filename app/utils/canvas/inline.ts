import type { TextExclusion, TextMeasureContext } from './text'
import type {
  ImageAsset,
  InlineAssetStyleRange,
  TextAlign,
  TextStyleRange,
} from '~/types/editor'
import { inlineAssetStyleForOccurrence } from '~/utils/inline-assets'

export type InlineContent
  = { type: 'text', text: string, start: number }
    | {
      type: 'asset'
      assetId: string
      start: number
      end: number
      scale?: number
      baselineOffset?: number
      inlinePadding?: number
    }

export type PositionedInlineRun
  = | {
    type: 'text'
    text: string
    x: number
    y: number
    width: number
    textColor?: string
    fontFamily?: string
  }
  | {
    type: 'asset'
    assetId: string
    x: number
    y: number
    width: number
    height: number
  }

export interface InlineLayout {
  fontSize: number
  lineHeight: number
  contentHeight: number
  runs: PositionedInlineRun[]
  fits: boolean
}

/** 登録済みのトークンを画像要素へ変換する。元文字列の位置は部分書式の対応付けに残す。 */
export function parseInlineContent(
  input: string,
  assets: readonly ImageAsset[],
  inlineAssetStyles: readonly InlineAssetStyleRange[] = [],
): InlineContent[] {
  const byName = new Map(assets.map(asset => [asset.name, asset]))
  const result: InlineContent[] = []
  const pushText = (text: string, start: number) => {
    if (!text)
      return
    const previous = result.at(-1)
    if (previous?.type === 'text' && previous.start + previous.text.length === start) {
      previous.text += text
    }
    else {
      result.push({ type: 'text', text, start })
    }
  }
  const pattern = /\[icon:([^\]\r\n]+)\]/gu
  let offset = 0
  for (const match of input.matchAll(pattern)) {
    const index = match.index
    if (index > offset)
      pushText(input.slice(offset, index), offset)
    const asset = byName.get(match[1]!.trim())
    if (asset) {
      const occurrence = {
        start: index,
        end: index + match[0].length,
        assetId: asset.id,
      }
      const style = inlineAssetStyleForOccurrence(
        inlineAssetStyles,
        occurrence,
      )
      result.push({
        type: 'asset',
        ...occurrence,
        ...(style?.scale !== undefined ? { scale: style.scale } : {}),
        ...(style?.baselineOffset !== undefined
          ? { baselineOffset: style.baselineOffset }
          : {}),
        ...(style?.inlinePadding !== undefined
          ? { inlinePadding: style.inlinePadding }
          : {}),
      })
    }
    else {
      pushText(match[0], index)
    }
    offset = index + match[0].length
  }
  if (offset < input.length)
    pushText(input.slice(offset), offset)
  return result
}

type InlineUnit
  = | {
    type: 'character'
    value: string
    width: number
    textColor?: string
    fontFamily: string
  }
  | {
    type: 'asset'
    assetId: string
    width: number
    height: number
    offset: number
    padding: number
  }
  | { type: 'break' }

/** 行と重なる保護領域を除いた、文字を配置できる横方向の区間を求める。 */
function availableSegments(
  width: number,
  lineTop: number,
  lineHeight: number,
  exclusions: readonly TextExclusion[],
  minimumWidth = 4,
) {
  let segments = [{ x: 0, width }]
  for (const exclusion of exclusions) {
    if (
      exclusion.y >= lineTop + lineHeight
      || exclusion.y + exclusion.height <= lineTop
    ) {
      continue
    }
    const left = Math.max(0, exclusion.x)
    const right = Math.min(width, exclusion.x + exclusion.width)
    segments = segments.flatMap((segment) => {
      const end = segment.x + segment.width
      if (right <= segment.x || left >= end)
        return [segment]
      return [
        ...(left > segment.x
          ? [{ x: segment.x, width: left - segment.x }]
          : []),
        ...(right < end ? [{ x: right, width: end - right }] : []),
      ]
    })
  }
  return segments.filter(segment => segment.width >= minimumWidth)
}

/** 文字とアイコンを指定サイズで計測し、行配置用の単位へ変換する。 */
function unitsAtSize(
  context: TextMeasureContext,
  content: readonly InlineContent[],
  assets: readonly ImageAsset[],
  fontSize: number,
  styles: readonly TextStyleRange[],
  fontFamilies: ReadonlyMap<string, string>,
  baseFontFamily: string,
): InlineUnit[] {
  const byId = new Map(assets.map(asset => [asset.id, asset]))
  return content.flatMap((item): InlineUnit[] => {
    if (item.type === 'text') {
      const units: InlineUnit[] = []
      let offset = 0
      for (const character of item.text.replace(/\r\n?/gu, '\n')) {
        if (character === '\n') {
          units.push({ type: 'break' })
        }
        else {
          const index = item.start + offset
          const style = styles.findLast(
            range => index >= range.start && index < range.end,
          )
          const fontFamily
            = style?.fontId === null
              ? 'sans-serif'
              : style?.fontId
                ? (fontFamilies.get(style.fontId) ?? baseFontFamily)
                : baseFontFamily
          context.font = `${fontSize}px ${fontFamily}`
          units.push({
            type: 'character',
            value: character,
            width: context.measureText(character).width,
            textColor: style?.textColor,
            fontFamily,
          })
        }
        offset += character.length
      }
      return units
    }
    const asset = byId.get(item.assetId)
    if (!asset)
      return []
    const height = fontSize * (item.scale ?? asset.scale)
    const aspect = asset.sourceRect.width / Math.max(1, asset.sourceRect.height)
    const padding = fontSize * (item.inlinePadding ?? asset.inlinePadding)
    return [
      {
        type: 'asset',
        assetId: asset.id,
        width: height * aspect + padding * 2,
        height,
        offset: (item.baselineOffset ?? asset.baselineOffset) * fontSize,
        padding,
      },
    ]
  })
}

/** 文字とアイコンを同じ行へ流し込み、保護領域で空いた区間ごとに配置する。 */
function layoutAtSize(
  context: TextMeasureContext,
  content: readonly InlineContent[],
  assets: readonly ImageAsset[],
  width: number,
  height: number,
  fontSize: number,
  exclusions: readonly TextExclusion[],
  textAlign: TextAlign,
  fontFamily: string,
  styles: readonly TextStyleRange[],
  fontFamilies: ReadonlyMap<string, string>,
  allowOverflow: boolean,
): InlineLayout {
  context.font = `${fontSize}px ${fontFamily}`
  const lineHeight = Math.ceil(fontSize * 1.25)
  const units = unitsAtSize(
    context,
    content,
    assets,
    fontSize,
    styles,
    fontFamilies,
    fontFamily,
  )
  const runs: PositionedInlineRun[] = []
  let unitIndex = 0
  let contentHeight = 0
  const layoutHeight = allowOverflow ? Number.POSITIVE_INFINITY : height

  for (
    let y = 0;
    y + lineHeight <= layoutHeight && unitIndex < units.length;
    y += lineHeight
  ) {
    contentHeight = y + lineHeight
    const segments = availableSegments(
      width,
      y,
      lineHeight,
      exclusions,
      allowOverflow ? 0 : 4,
    )
    let forcedBreak = false
    for (const segment of segments) {
      const lineUnits: InlineUnit[] = []
      let used = 0
      while (unitIndex < units.length) {
        const unit = units[unitIndex]!
        if (unit.type === 'break') {
          unitIndex += 1
          forcedBreak = true
          break
        }
        if (used + unit.width > segment.width && lineUnits.length > 0)
          break
        if (
          unit.width > segment.width
          && lineUnits.length === 0
          && !allowOverflow
        ) {
          break
        }
        lineUnits.push(unit)
        used += unit.width
        unitIndex += 1
      }
      const alignmentOffset
        = textAlign === 'right'
          ? segment.width - used
          : textAlign === 'center'
            ? (segment.width - used) / 2
            : 0
      let x = segment.x + alignmentOffset
      let pendingText = ''
      let pendingX = x
      let pendingWidth = 0
      let pendingColor: string | undefined
      let pendingFontFamily: string | undefined
      const flushText = () => {
        if (pendingText) {
          runs.push({
            type: 'text',
            text: pendingText,
            x: pendingX,
            y,
            width: pendingWidth,
            textColor: pendingColor,
            fontFamily: pendingFontFamily,
          })
        }
        pendingText = ''
        pendingWidth = 0
        pendingColor = undefined
        pendingFontFamily = undefined
      }
      for (const unit of lineUnits) {
        if (unit.type === 'character') {
          if (
            pendingText
            && (pendingColor !== unit.textColor
              || pendingFontFamily !== unit.fontFamily)
          ) {
            flushText()
          }
          if (!pendingText)
            pendingX = x
          pendingColor = unit.textColor
          pendingFontFamily = unit.fontFamily
          pendingText += unit.value
          pendingWidth += unit.width
          x += unit.width
        }
        else if (unit.type === 'asset') {
          flushText()
          runs.push({
            type: 'asset',
            assetId: unit.assetId,
            x: x + unit.padding,
            // Center within the text height, excluding the inter-line spacing.
            y: y + (fontSize - unit.height) / 2 + unit.offset,
            width: unit.width - unit.padding * 2,
            height: unit.height,
          })
          x += unit.width
        }
      }
      flushText()
      if (forcedBreak || unitIndex >= units.length)
        break
    }
  }
  return {
    fontSize,
    lineHeight,
    contentHeight,
    runs,
    fits: unitIndex >= units.length,
  }
}

/** 縮小して収まる配置を探す。一行指定では折り返さず、最小サイズでも収まらなければ配置できた分とfits: falseを返す。 */
export function fitInlineContent(
  context: TextMeasureContext,
  content: readonly InlineContent[],
  assets: readonly ImageAsset[],
  width: number,
  height: number,
  requestedFontSize: number,
  exclusions: readonly TextExclusion[],
  textAlign: TextAlign,
  minimumFontSize = 8,
  fontFamily = 'sans-serif',
  styles: readonly TextStyleRange[] = [],
  fontFamilies: ReadonlyMap<string, string> = new Map(),
  allowOverflow = false,
  singleLine = false,
): InlineLayout {
  let fallback: InlineLayout | null = null
  for (
    let size = Math.max(minimumFontSize, requestedFontSize);
    size >= minimumFontSize;
    size -= 1
  ) {
    fallback = layoutAtSize(
      context,
      content,
      assets,
      width,
      singleLine ? Math.min(height, Math.ceil(size * 1.25)) : height,
      size,
      exclusions,
      textAlign,
      fontFamily,
      styles,
      fontFamilies,
      allowOverflow && !singleLine,
    )
    if (fallback.fits)
      return fallback
  }
  return (
    fallback ?? {
      fontSize: minimumFontSize,
      lineHeight: Math.ceil(minimumFontSize * 1.25),
      contentHeight: 0,
      runs: [],
      fits: content.length === 0,
    }
  )
}
