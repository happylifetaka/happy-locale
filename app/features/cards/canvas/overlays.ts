import type { MaskStroke, RegionDraft, TextRegion } from '~/types/editor'
import type { RegionCandidate } from '~/types/ocr'
import { createAutomaticTextMask, createBlendedBackground, createManualMask, createMaskPreview, createRegionRemovalMask } from '~/utils/canvas/background'
import { drawSelection } from '~/utils/canvas/render'

/** 消去マスクを確認用の色付き画像として重ねる。 */
export function drawMaskOverlay(
  context: CanvasRenderingContext2D,
  region: TextRegion,
  strokes: readonly MaskStroke[],
) {
  const width = Math.max(1, Math.round(region.width))
  const height = Math.max(1, Math.round(region.height))
  const mask = createRegionRemovalMask(
    createManualMask(width, height, [...strokes]),
    width,
    height,
    region.sourceIcons,
    region.exclusionAreas,
  )
  drawMaskPreview(context, mask, width, height, region.x, region.y)
}

/** 渡された消去マスクを色付きの確認画像にして、指定位置へ描画する。 */
function drawMaskPreview(
  context: CanvasRenderingContext2D,
  mask: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
) {
  const overlay = document.createElement('canvas')
  overlay.width = width
  overlay.height = height
  overlay.getContext('2d')?.putImageData(
    createMaskPreview(mask, width, height),
    0,
    0,
  )
  context.drawImage(overlay, Math.round(x), Math.round(y))
}

/** 自動補修で消す範囲を元画像から計算して重ねる。 */
export function drawAutomaticMaskPreview(
  context: CanvasRenderingContext2D,
  region: TextRegion,
  source: ImageData | null,
) {
  if (!source)
    return
  const background = createBlendedBackground(
    source,
    source.width,
    source.height,
    region,
    region.backgroundColor,
  )
  const mask = createRegionRemovalMask(
    createAutomaticTextMask(
      source,
      background,
      region,
      region.autoMaskSensitivity,
      region.removeColorOutliers,
      region.autoMaskPreset,
    ),
    background.width,
    background.height,
    region.sourceIcons,
    region.exclusionAreas,
  )
  drawMaskPreview(
    context,
    mask,
    background.width,
    background.height,
    region.x,
    region.y,
  )
}

/** 保護領域とその操作用の枠を描画する。 */
export function drawExclusionOverlay(
  context: CanvasRenderingContext2D,
  region: TextRegion,
  zoom: number,
  selectedExclusionId: string | null,
  draftExclusion: RegionDraft | null,
  creatingExclusion: boolean,
) {
  const handleSize = 10 / (zoom / 100)
  const areas = region.exclusionAreas.map(area =>
    area.id === selectedExclusionId && draftExclusion
      ? { ...area, ...draftExclusion }
      : area,
  )
  if (creatingExclusion && draftExclusion) {
    areas.push({ id: '__draft__', ...draftExclusion })
  }

  context.save()
  context.setLineDash([8 / (zoom / 100), 5 / (zoom / 100)])
  context.lineWidth = 2 / (zoom / 100)
  for (const area of areas) {
    const selected
      = area.id === selectedExclusionId || area.id === '__draft__'
    context.fillStyle = selected ? '#facc1538' : '#facc1522'
    context.strokeStyle = selected ? '#ca8a04' : '#eab308'
    context.fillRect(
      region.x + area.x,
      region.y + area.y,
      area.width,
      area.height,
    )
    context.strokeRect(
      region.x + area.x,
      region.y + area.y,
      area.width,
      area.height,
    )
    if (!selected || area.id === '__draft__')
      continue
    context.setLineDash([])
    context.fillStyle = '#ca8a04'
    const half = handleSize / 2
    for (const point of [
      { x: area.x, y: area.y },
      { x: area.x + area.width, y: area.y },
      { x: area.x, y: area.y + area.height },
      { x: area.x + area.width, y: area.y + area.height },
    ]) {
      context.fillRect(
        region.x + point.x - half,
        region.y + point.y - half,
        handleSize,
        handleSize,
      )
    }
    context.setLineDash([8 / (zoom / 100), 5 / (zoom / 100)])
  }
  context.restore()
}

/** 選択領域の枠とサイズ変更用のハンドルを描画する。 */
export function drawRegionSelection(
  context: CanvasRenderingContext2D,
  region: RegionDraft,
  zoom: number,
) {
  drawSelection(context, region)
  const handleSize = 10 / (zoom / 100)
  const half = handleSize / 2
  context.save()
  context.fillStyle = '#2563eb'
  for (const point of [
    { x: region.x, y: region.y },
    { x: region.x + region.width, y: region.y },
    { x: region.x, y: region.y + region.height },
    { x: region.x + region.width, y: region.y + region.height },
  ]) {
    context.fillRect(point.x - half, point.y - half, handleSize, handleSize)
  }
  context.restore()
}

/** 印刷対象の範囲と操作中の矩形を描画する。 */
export function drawPrintArea(context: CanvasRenderingContext2D, area: RegionDraft | null, zoom: number) {
  if (!area)
    return
  const scale = zoom / 100
  context.save()
  context.fillStyle = '#f973161f'
  context.strokeStyle = '#ea580c'
  context.lineWidth = 2 / scale
  context.setLineDash([8 / scale, 5 / scale])
  context.fillRect(area.x, area.y, area.width, area.height)
  context.strokeRect(area.x, area.y, area.width, area.height)
  context.setLineDash([])
  context.fillStyle = '#ea580c'
  const handleSize = 10 / scale
  const half = handleSize / 2
  for (const point of [
    { x: area.x, y: area.y },
    { x: area.x + area.width, y: area.y },
    { x: area.x, y: area.y + area.height },
    { x: area.x + area.width, y: area.y + area.height },
  ]) {
    context.fillRect(point.x - half, point.y - half, handleSize, handleSize)
  }
  context.restore()
}

/** 未選択の翻訳領域の位置を枠線で示す。 */
export function drawUnselectedRegionOutlines(
  context: CanvasRenderingContext2D,
  regions: readonly TextRegion[],
  selectedRegionId: string | null,
  zoom: number,
) {
  const scale = zoom / 100
  context.save()
  context.strokeStyle = '#64748b'
  context.lineWidth = 1.5 / scale
  context.setLineDash([5 / scale, 4 / scale])
  for (const region of regions) {
    if (region.id === selectedRegionId)
      continue
    context.strokeRect(region.x, region.y, region.width, region.height)
  }
  context.restore()
}

/** 確認中のOCR候補の枠と選択状態を描画する。 */
export function drawRegionCandidates(context: CanvasRenderingContext2D, candidates: readonly RegionCandidate[], selectedCandidateId: string | null, draftCandidate: RegionDraft | null, zoom: number) {
  const scale = zoom / 100
  context.save()
  context.setLineDash([7 / scale, 5 / scale])
  context.lineWidth = 2 / scale
  context.font = `${12 / scale}px sans-serif`
  context.textBaseline = 'top'
  for (const [index, candidate] of candidates.entries()) {
    const bounds
      = candidate.id === selectedCandidateId && draftCandidate
        ? draftCandidate
        : candidate
    const editing = candidate.id === selectedCandidateId
    context.fillStyle = candidate.selected ? '#22c55e30' : '#64748b20'
    context.strokeStyle = editing
      ? '#2563eb'
      : candidate.selected
        ? '#16a34a'
        : '#64748b'
    context.fillRect(bounds.x, bounds.y, bounds.width, bounds.height)
    context.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height)
    context.fillStyle = candidate.selected ? '#15803d' : '#475569'
    context.fillText(
      `${candidate.selected ? '✓' : '–'} ${index + 1}`,
      bounds.x + 3 / scale,
      bounds.y + 3 / scale,
    )
    if (editing) {
      context.setLineDash([])
      context.fillStyle = '#2563eb'
      const handleSize = 10 / scale
      const half = handleSize / 2
      for (const point of [
        { x: bounds.x, y: bounds.y },
        { x: bounds.x + bounds.width / 2, y: bounds.y },
        { x: bounds.x + bounds.width, y: bounds.y },
        { x: bounds.x + bounds.width, y: bounds.y + bounds.height / 2 },
        { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
        { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height },
        { x: bounds.x, y: bounds.y + bounds.height },
        { x: bounds.x, y: bounds.y + bounds.height / 2 },
      ]) {
        context.fillRect(
          point.x - half,
          point.y - half,
          handleSize,
          handleSize,
        )
      }
      context.setLineDash([7 / scale, 5 / scale])
    }
  }
  context.restore()
}
