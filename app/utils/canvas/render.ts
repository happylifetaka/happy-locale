import type {
  ImageAsset,
  RegionDraft,
  TextRegion,
  VerticalAlign,
} from '~/types/editor'
import { regionTextLayout } from '~/utils/region-text-layout'
import { rubyDisplayRegion } from '~/utils/ruby'
import {
  compositeBackground,
  createAutomaticTextMask,
  createBlendedBackground,
  createManualMask,
  createRegionRemovalMask,
} from './background'
import { fitInlineContent, parseInlineContent } from './inline'

/** 余った高さから上・中央・下揃えの縦方向の補正量を求める。 */
export function verticalTextOffset(
  verticalAlign: VerticalAlign,
  availableHeight: number,
  contentHeight: number,
) {
  const remainingHeight = Math.max(0, availableHeight - contentHeight)
  if (verticalAlign === 'bottom')
    return remainingHeight
  if (verticalAlign === 'middle')
    return remainingHeight / 2
  return 0
}

/** 背景の補修・保護領域の除外・訳文とアセットの配置を一つの領域へ合成する。 */
export function renderRegion(
  context: CanvasRenderingContext2D,
  region: TextRegion,
  sourceImage?: ImageData,
  assets: readonly ImageAsset[] = [],
  assetImages: ReadonlyMap<string, CanvasImageSource> = new Map(),
  fontFamily = 'sans-serif',
  fontFamilies: ReadonlyMap<string, string> = new Map(),
) {
  region = rubyDisplayRegion(region)
  if (region.ruby && region.height <= 0)
    return
  context.save()
  if (region.backgroundMode !== 'none') {
    if (region.backgroundMode === 'solid' || !sourceImage) {
      context.beginPath()
      context.rect(region.x, region.y, region.width, region.height)
      region.exclusionAreas.forEach((area) => {
        context.rect(
          region.x + area.x,
          region.y + area.y,
          area.width,
          area.height,
        )
      })
      context.clip('evenodd')
      context.fillStyle = region.backgroundColor
      context.fillRect(region.x, region.y, region.width, region.height)
    }
    else {
      const background = createBlendedBackground(
        sourceImage,
        sourceImage.width,
        sourceImage.height,
        region,
        '#000000',
      )
      const mask
        = region.backgroundMode === 'manual'
          ? createManualMask(
              background.width,
              background.height,
              region.manualMaskStrokes,
            )
          : createAutomaticTextMask(
              sourceImage,
              background,
              region,
              region.autoMaskSensitivity,
              region.removeColorOutliers,
              region.autoMaskPreset,
            )
      const protectedMask = createRegionRemovalMask(
        mask,
        background.width,
        background.height,
        region.sourceIcons,
        region.exclusionAreas,
      )
      const composited = compositeBackground(
        sourceImage,
        background,
        region,
        protectedMask,
      )
      context.putImageData(
        composited,
        Math.round(region.x),
        Math.round(region.y),
      )
    }
  }

  const padding = region.ruby ? region.textStrokeWidth : Math.min(8, region.width * 0.05, region.height * 0.05)
  const textWidth = Math.max(1, region.width - padding * 2)
  const textHeight = Math.max(1, region.height - padding * 2)
  const fitSingleLine = !region.ruby && region.autoFitFontSize && regionTextLayout(region) === 'single-line'
  const requestedFontSize = fitSingleLine ? Math.max(1, Math.floor(textHeight / 1.25)) : region.fontSize
  const textExclusions = region.exclusionAreas.map(area => ({
    x: area.x - padding,
    y: area.y - padding,
    width: area.width,
    height: area.height,
  }))
  const content = parseInlineContent(
    region.translatedText,
    assets,
    region.inlineAssetStyles,
  )
  // 保護領域を避けるため、縦位置の補正後も同じ条件で文字配置を計算し直せるようにする。
  const createLayout = (verticalOffset: number) => fitInlineContent(
    context,
    content,
    assets,
    textWidth,
    textHeight,
    requestedFontSize,
    textExclusions.map(exclusion => ({
      ...exclusion,
      y: exclusion.y - verticalOffset,
    })),
    region.textAlign,
    region.autoFitFontSize ? (region.ruby || fitSingleLine ? 1 : 8) : region.fontSize,
    fontFamily,
    region.textStyles,
    fontFamilies,
    !region.autoFitFontSize,
    region.ruby === true || fitSingleLine,
  )
  let layout = createLayout(0)
  let verticalOffset = verticalTextOffset(
    region.verticalAlign,
    textHeight,
    layout.contentHeight,
  )
  if (verticalOffset > 0 && textExclusions.length > 0) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      layout = createLayout(verticalOffset)
      const nextOffset = verticalTextOffset(
        region.verticalAlign,
        textHeight,
        layout.contentHeight,
      )
      if (Math.abs(nextOffset - verticalOffset) < 0.5)
        break
      if (attempt < 2)
        verticalOffset = nextOffset
    }
  }

  // ルビは縁取り込みの文字下端を測り、行の余白による浮き上がりを補正する。
  if (region.ruby && layout.runs.length > 0) {
    context.textBaseline = 'top'
    const inkBottom = Math.max(...layout.runs.map((run) => {
      if (run.type === 'asset')
        return run.y + run.height
      context.font = `${layout.fontSize}px ${run.fontFamily ?? fontFamily}`
      const metrics = context.measureText(run.text)
      const descent = Number.isFinite(metrics.actualBoundingBoxDescent)
        ? metrics.actualBoundingBoxDescent
        : layout.fontSize
      return run.y + descent + region.textStrokeWidth
    }))
    // Align visible ink (including its stroke), rather than the 1.25em line box.
    verticalOffset = region.height - padding - inkBottom
  }

  context.beginPath()
  context.rect(region.x, region.y, region.width, region.height)
  region.exclusionAreas.forEach((area) => {
    context.rect(region.x + area.x, region.y + area.y, area.width, area.height)
  })
  context.clip('evenodd')
  context.font = `${layout.fontSize}px ${fontFamily}`
  context.strokeStyle = region.textStrokeColor
  context.lineWidth = region.textStrokeWidth * 2
  context.lineJoin = 'round'
  context.textBaseline = 'top'
  context.textAlign = 'left'
  layout.runs.forEach((run) => {
    const x = region.x + padding + run.x
    const y = region.y + padding + verticalOffset + run.y
    if (run.type === 'asset') {
      const assetImage = assetImages.get(run.assetId)
      if (assetImage)
        context.drawImage(assetImage, x, y, run.width, run.height)
      return
    }
    context.font = `${layout.fontSize}px ${run.fontFamily ?? fontFamily}`
    context.fillStyle = run.textColor ?? region.textColor
    if (region.textStrokeWidth > 0) {
      context.strokeText(run.text, x, y)
    }
    context.fillText(run.text, x, y)
  })
  context.restore()
}

/** 編集プレビューと画像・印刷書き出しで共有する描画入口。背景補修は常に元画像を参照する。 */
export function renderCard(
  context: CanvasRenderingContext2D,
  image: CanvasImageSource,
  width: number,
  height: number,
  regions: readonly TextRegion[],
  assets: readonly ImageAsset[] = [],
  assetImages: ReadonlyMap<string, CanvasImageSource> = new Map(),
  fontFamilies: ReadonlyMap<string, string> = new Map(),
) {
  context.clearRect(0, 0, width, height)
  context.drawImage(image, 0, 0, width, height)
  const sourceImage = context.getImageData(0, 0, width, height)
  const renderOrder = [...regions.filter(region => !region.ruby), ...regions.filter(region => region.ruby)]
  renderOrder.forEach(region =>
    renderRegion(
      context,
      region,
      sourceImage,
      assets,
      assetImages,
      region.fontId
        ? (fontFamilies.get(region.fontId) ?? 'sans-serif')
        : 'sans-serif',
      fontFamilies,
    ),
  )
}

/** 選択範囲を確認用の枠線として描画する。 */
export function drawSelection(
  context: CanvasRenderingContext2D,
  bounds: RegionDraft,
  active = false,
) {
  context.save()
  context.strokeStyle = active ? '#f97316' : '#2563eb'
  context.lineWidth = 2
  context.setLineDash(active ? [8, 5] : [])
  context.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height)
  context.restore()
}
