<script setup lang="ts">
import type { RegionCandidate } from '~/services/ocr/types'
import type {
  CardProject,
  ExclusionArea,
  ImageAsset,
  MaskStroke,
  RegionDraft,
  TextRegion,
} from '~/types/editor'
import {
  createAutomaticTextMask,
  createBlendedBackground,
  createManualMask,
  createMaskPreview,
  createRegionRemovalMask,
  estimateBackgroundColor,
} from '~/utils/canvas/background'
import { drawSelection, renderCard } from '~/utils/canvas/render'
import { consumeSelectedFile } from '~/utils/file-input'
import {
  printAreaPointerCompletion,
  usablePrintArea,
} from '~/utils/print-area'
import { transformRegionContents } from '~/utils/regions'

const props = defineProps<{
  image: HTMLImageElement | null
  projectSelected: boolean
  project: CardProject
  previewDeferred: boolean
  selectedRegionId: string | null
  autoMaskPreview: boolean
  maskEditing: boolean
  maskBrushSize: number
  maskBrushMode: 'paint' | 'erase'
  exclusionEditing: boolean
  selectedExclusionId: string | null
  zoom: number
  previewMode: 'edited' | 'original'
  assets: ImageAsset[]
  assetImages: ReadonlyMap<string, CanvasImageSource>
  fontFamilies: ReadonlyMap<string, string>
  regionCandidates: RegionCandidate[]
  selectedCandidateId: string | null
  printArea: RegionDraft | null
  printAreaEditing: boolean
}>()

const emit = defineEmits<{
  addRegion: [bounds: RegionDraft, backgroundColor: string]
  updateRegionBounds: [regionId: string, bounds: RegionDraft]
  selectRegion: [id: string | null]
  addMaskStroke: [regionId: string, stroke: MaskStroke]
  addExclusion: [regionId: string, bounds: RegionDraft]
  updateExclusion: [regionId: string, exclusionId: string, bounds: RegionDraft]
  selectExclusion: [id: string | null]
  updatePreviewMode: [mode: 'edited' | 'original']
  updateZoom: [value: number]
  selectRegionCandidate: [id: string | null]
  updateRegionCandidateBounds: [id: string, bounds: RegionDraft]
  updatePrintArea: [bounds: RegionDraft]
  image: [file: File]
  diagnostic: [message: string]
}>()

/** 描画とポインター座標の変換に使用するCanvas要素。 */
const canvas = ref<HTMLCanvasElement | null>(null)
/** 画像ファイルを選ぶための非表示の入力要素。 */
const imageInput = ref<HTMLInputElement | null>(null)
/** 背景色の採取などに使う、編集前の元画像Canvasのキャッシュ。 */
let sourceCanvas: HTMLCanvasElement | null = null
/** 元画像Canvasを作成した画像。差し替え判定に使う。 */
let sourceCanvasImage: HTMLImageElement | null = null
/** 同じ編集状態の再描画を避けるための合成画像キャッシュ。 */
let editedPreviewCanvas: HTMLCanvasElement | null = null
/** 合成画像の再利用可否を判定する入力オブジェクトの組。 */
let editedPreviewKey: {
  image: HTMLImageElement
  project: CardProject
  assets: ImageAsset[]
  assetImages: ReadonlyMap<string, CanvasImageSource>
  fontFamilies: ReadonlyMap<string, string>
} | null = null
/** ドラッグ開始位置。元画像の画素座標。 */
const dragStart = ref<{ x: number, y: number } | null>(null)
/** 作成中の翻訳領域の矩形。元画像の画素座標。 */
const draft = ref<RegionDraft | null>(null)
/** カード上で描いている途中の消去・復元マスク。 */
const draftMaskStroke = ref<MaskStroke | null>(null)
/** 現在のマスク描画を開始したポインターの識別子。 */
const activeMaskPointerId = ref<number | null>(null)
type ResizeHandle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw'
interface ExclusionInteraction {
  kind: 'create' | 'move' | 'resize'
  start: { x: number, y: number }
  original?: ExclusionArea
  handle?: ResizeHandle
}
/** 保護領域の移動・リサイズ開始時の状態。 */
const exclusionInteraction = ref<ExclusionInteraction | null>(null)
/** 操作中の保護領域の仮の矩形。 */
const draftExclusion = ref<RegionDraft | null>(null)
interface RegionInteraction {
  kind: 'move' | 'resize'
  start: { x: number, y: number }
  original: RegionDraft
  handle?: ResizeHandle
}
/** 翻訳領域の移動・リサイズ開始時の状態。 */
const regionInteraction = ref<RegionInteraction | null>(null)
/** 操作中の翻訳領域の仮の矩形。 */
const draftRegion = ref<RegionDraft | null>(null)
interface CandidateInteraction {
  kind: 'move' | 'resize'
  id: string
  start: { x: number, y: number }
  original: RegionDraft
  handle?: ResizeHandle
}
/** OCR候補の移動・リサイズ開始時の状態。 */
const candidateInteraction = ref<CandidateInteraction | null>(null)
/** 操作中のOCR候補の仮の矩形。 */
const draftCandidate = ref<RegionDraft | null>(null)
/** 印刷範囲の作成・移動・リサイズ開始時の状態。 */
const printAreaInteraction = ref<RegionInteraction | null>(null)
/** 操作中の印刷範囲の仮の矩形。 */
const draftPrintArea = ref<RegionDraft | null>(null)

/** 操作可能な場合に画像ファイルの選択を開く。 */
function openImagePicker() {
  emit('diagnostic', 'カード画像選択ダイアログを開きます')
  imageInput.value?.click()
}

/** ファイル入力から画像を取り出して読み込みを要求する。 */
function pickImage(event: Event) {
  const input = event.target as HTMLInputElement
  const file = consumeSelectedFile(input)
  emit(
    'diagnostic',
    file
      ? 'カード画像選択イベントを受け取りました'
      : 'カード画像選択にファイルがありません',
  )
  if (file)
    emit('image', file)
}

/** 値を指定された上下限の範囲へ収める。 */
function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value))
}

/** 消去マスクを確認用の色付き画像として重ねる。 */
function drawMaskOverlay(
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
function drawAutomaticMaskPreview(
  context: CanvasRenderingContext2D,
  region: TextRegion,
) {
  const source = sourceContext()?.getImageData(
    0,
    0,
    props.project.imageWidth,
    props.project.imageHeight,
  )
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
function drawExclusionOverlay(
  context: CanvasRenderingContext2D,
  region: TextRegion,
) {
  const handleSize = 10 / (props.zoom / 100)
  const areas = region.exclusionAreas.map(area =>
    area.id === props.selectedExclusionId && draftExclusion.value
      ? { ...area, ...draftExclusion.value }
      : area,
  )
  if (exclusionInteraction.value?.kind === 'create' && draftExclusion.value) {
    areas.push({ id: '__draft__', ...draftExclusion.value })
  }

  context.save()
  context.setLineDash([8 / (props.zoom / 100), 5 / (props.zoom / 100)])
  context.lineWidth = 2 / (props.zoom / 100)
  for (const area of areas) {
    const selected
      = area.id === props.selectedExclusionId || area.id === '__draft__'
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
    context.setLineDash([8 / (props.zoom / 100), 5 / (props.zoom / 100)])
  }
  context.restore()
}

/** 選択領域の枠とサイズ変更用のハンドルを描画する。 */
function drawRegionSelection(
  context: CanvasRenderingContext2D,
  region: RegionDraft,
) {
  drawSelection(context, region)
  const handleSize = 10 / (props.zoom / 100)
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
function drawPrintArea(context: CanvasRenderingContext2D) {
  const area = draftPrintArea.value ?? props.printArea
  if (!area)
    return
  const scale = props.zoom / 100
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
function drawUnselectedRegionOutlines(
  context: CanvasRenderingContext2D,
  regions: readonly TextRegion[],
) {
  const scale = props.zoom / 100
  context.save()
  context.strokeStyle = '#64748b'
  context.lineWidth = 1.5 / scale
  context.setLineDash([5 / scale, 4 / scale])
  for (const region of regions) {
    if (region.id === props.selectedRegionId)
      continue
    context.strokeRect(region.x, region.y, region.width, region.height)
  }
  context.restore()
}

/** 確認中のOCR候補の枠と選択状態を描画する。 */
function drawRegionCandidates(context: CanvasRenderingContext2D) {
  const scale = props.zoom / 100
  context.save()
  context.setLineDash([7 / scale, 5 / scale])
  context.lineWidth = 2 / scale
  context.font = `${12 / scale}px sans-serif`
  context.textBaseline = 'top'
  for (const [index, candidate] of props.regionCandidates.entries()) {
    const bounds
      = candidate.id === props.selectedCandidateId && draftCandidate.value
        ? draftCandidate.value
        : candidate
    const editing = candidate.id === props.selectedCandidateId
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

/** 背景色採取と補修には編集前の画素を使うため、元画像専用Canvasをキャッシュする。 */
function sourceContext() {
  if (
    !props.image
    || props.project.imageWidth <= 0
    || props.project.imageHeight <= 0
  ) {
    return null
  }
  if (
    !sourceCanvas
    || sourceCanvasImage !== props.image
    || sourceCanvas.width !== props.project.imageWidth
    || sourceCanvas.height !== props.project.imageHeight
  ) {
    sourceCanvas = document.createElement('canvas')
    sourceCanvas.width = props.project.imageWidth
    sourceCanvas.height = props.project.imageHeight
    sourceCanvasImage = props.image
    const context = sourceCanvas.getContext('2d', { willReadFrequently: true })
    context?.drawImage(
      props.image,
      0,
      0,
      props.project.imageWidth,
      props.project.imageHeight,
    )
  }
  return sourceCanvas.getContext('2d', { willReadFrequently: true })
}

/** 編集データや画像の参照が変わるまで描画結果を再利用し、ズームや選択枠の操作を軽くする。 */
function editedPreview(): HTMLCanvasElement | null {
  if (!props.image)
    return null
  const cacheValid
    = editedPreviewCanvas
      && editedPreviewKey?.image === props.image
      && editedPreviewKey.project === props.project
      && editedPreviewKey.assets === props.assets
      && editedPreviewKey.assetImages === props.assetImages
      && editedPreviewKey.fontFamilies === props.fontFamilies
  if (cacheValid)
    return editedPreviewCanvas

  const output = document.createElement('canvas')
  output.width = props.project.imageWidth
  output.height = props.project.imageHeight
  const context = output.getContext('2d')
  if (!context)
    return null
  renderCard(
    context,
    props.image,
    output.width,
    output.height,
    props.project.regions,
    props.assets.filter(asset => props.assetImages.has(asset.id)),
    props.assetImages,
    props.fontFamilies,
  )
  editedPreviewCanvas = output
  editedPreviewKey = {
    image: props.image,
    project: props.project,
    assets: props.assets,
    assetImages: props.assetImages,
    fontFamilies: props.fontFamilies,
  }
  return output
}

/** 編集画像の上に選択枠・候補・マスクを重ねる。操作用の表示は書き出し画像には含めない。 */
function redraw() {
  const element = canvas.value
  if (
    !element
    || !props.image
    || props.project.imageWidth <= 0
    || props.project.imageHeight <= 0
  ) {
    return
  }
  const context = element.getContext('2d')
  if (!context)
    return
  const previewRegions = props.project.regions.map(region =>
    region.id === props.selectedRegionId && draftRegion.value
      ? {
          ...region,
          ...draftRegion.value,
          ...transformRegionContents(region, draftRegion.value),
        }
      : region,
  )
  const selected = previewRegions.find(
    region => region.id === props.selectedRegionId,
  )
  const inspectingAutomaticMask
    = props.autoMaskPreview && selected?.backgroundMode === 'auto'
  if (props.previewMode === 'original' || inspectingAutomaticMask) {
    context.clearRect(
      0,
      0,
      props.project.imageWidth,
      props.project.imageHeight,
    )
    context.drawImage(
      props.image,
      0,
      0,
      props.project.imageWidth,
      props.project.imageHeight,
    )
  }
  else {
    const cached = draftRegion.value ? null : editedPreview()
    if (cached) {
      context.clearRect(
        0,
        0,
        props.project.imageWidth,
        props.project.imageHeight,
      )
      context.drawImage(cached, 0, 0)
    }
    else {
      renderCard(
        context,
        props.image,
        props.project.imageWidth,
        props.project.imageHeight,
        previewRegions,
        props.assets.filter(asset => props.assetImages.has(asset.id)),
        props.assetImages,
        props.fontFamilies,
      )
    }
  }
  if (props.previewMode === 'edited' && !props.printAreaEditing)
    drawUnselectedRegionOutlines(context, previewRegions)
  if (selected && inspectingAutomaticMask)
    drawAutomaticMaskPreview(context, selected)
  if (selected && !props.printAreaEditing)
    drawRegionSelection(context, selected)
  if (!props.printAreaEditing && selected && selected.exclusionAreas.length > 0) {
    drawExclusionOverlay(context, selected)
  }
  else if (
    !props.printAreaEditing
    && selected
    && exclusionInteraction.value?.kind === 'create'
    && draftExclusion.value
  ) {
    drawExclusionOverlay(context, selected)
  }
  if (
    !props.printAreaEditing
    && selected
    && props.maskEditing
    && selected.backgroundMode === 'manual'
  ) {
    drawMaskOverlay(context, selected, [
      ...selected.manualMaskStrokes,
      ...(draftMaskStroke.value ? [draftMaskStroke.value] : []),
    ])
  }
  if (draft.value)
    drawSelection(context, draft.value, true)
  if (props.regionCandidates.length > 0 && !props.printAreaEditing)
    drawRegionCandidates(context)
  if (props.printAreaEditing)
    drawPrintArea(context)
}

// 画像・編集状態・操作表示の変更に応じてCanvasを再描画する。
watch(
  () => [
    props.previewDeferred,
    props.image,
    props.project,
    props.selectedRegionId,
    props.autoMaskPreview,
    props.maskEditing,
    props.exclusionEditing,
    props.selectedExclusionId,
    props.previewMode,
    props.assets,
    props.fontFamilies,
    props.regionCandidates,
    props.selectedCandidateId,
    props.printArea,
    props.printAreaEditing,
    draft.value,
    draftMaskStroke.value,
    draftExclusion.value,
    draftRegion.value,
    draftCandidate.value,
    draftPrintArea.value,
  ],
  () => {
    if (!props.previewDeferred)
      redraw()
  },
  { deep: true, flush: 'post' },
)

/** 表示倍率の影響を取り除き、ポインター位置を元画像の画素座標へ変換する。 */
function pointFromEvent(event: PointerEvent) {
  const element = canvas.value!
  const bounds = element.getBoundingClientRect()
  return {
    x: Math.max(
      0,
      Math.min(
        element.width,
        (event.clientX - bounds.left) * (element.width / bounds.width),
      ),
    ),
    y: Math.max(
      0,
      Math.min(
        element.height,
        (event.clientY - bounds.top) * (element.height / bounds.height),
      ),
    ),
  }
}

/** 現在選択されている翻訳領域を取得する。 */
function selectedRegion() {
  return props.project.regions.find(
    region => region.id === props.selectedRegionId,
  )
}

/** 元画像上の点を、領域左上を基準とする相対座標へ変換する。 */
function relativePoint(point: { x: number, y: number }, region: TextRegion) {
  return {
    x: clamp(point.x - region.x, 0, region.width),
    y: clamp(point.y - region.y, 0, region.height),
  }
}

/** 点が翻訳領域の内側にあるか判定する。 */
function pointInsideRegion(
  point: { x: number, y: number },
  region: TextRegion,
) {
  return (
    point.x >= region.x
    && point.x <= region.x + region.width
    && point.y >= region.y
    && point.y <= region.y + region.height
  )
}

/** 点が指定された矩形の内側にあるか判定する。 */
function pointInsideBounds(
  point: { x: number, y: number },
  bounds: RegionDraft,
) {
  return (
    point.x >= bounds.x
    && point.x <= bounds.x + bounds.width
    && point.y >= bounds.y
    && point.y <= bounds.y + bounds.height
  )
}

/** ポインター位置にある保護領域を探す。 */
function exclusionAtPoint(point: { x: number, y: number }) {
  const region = selectedRegion()
  if (!region)
    return null
  const local = relativePoint(point, region)
  return (
    region.exclusionAreas.findLast(
      area =>
        local.x >= area.x
        && local.x <= area.x + area.width
        && local.y >= area.y
        && local.y <= area.y + area.height,
    ) ?? null
  )
}

/** ポインターが触れている矩形のリサイズハンドルを判定する。 */
function resizeHandleAtPoint(
  point: { x: number, y: number },
  area: ExclusionArea,
  region: TextRegion,
): ResizeHandle | null {
  const local = relativePoint(point, region)
  const tolerance = 8 / (props.zoom / 100)
  const handles: { handle: ResizeHandle, x: number, y: number }[] = [
    { handle: 'nw', x: area.x, y: area.y },
    { handle: 'ne', x: area.x + area.width, y: area.y },
    { handle: 'sw', x: area.x, y: area.y + area.height },
    {
      handle: 'se',
      x: area.x + area.width,
      y: area.y + area.height,
    },
  ]
  return (
    handles.find(
      ({ x, y }) =>
        Math.abs(local.x - x) <= tolerance
        && Math.abs(local.y - y) <= tolerance,
    )?.handle ?? null
  )
}

/** 翻訳領域のどのリサイズハンドルを操作するか判定する。 */
function regionResizeHandleAtPoint(
  point: { x: number, y: number },
  region: RegionDraft,
): ResizeHandle | null {
  const tolerance = 8 / (props.zoom / 100)
  const handles: { handle: ResizeHandle, x: number, y: number }[] = [
    { handle: 'nw', x: region.x, y: region.y },
    { handle: 'ne', x: region.x + region.width, y: region.y },
    { handle: 'sw', x: region.x, y: region.y + region.height },
    {
      handle: 'se',
      x: region.x + region.width,
      y: region.y + region.height,
    },
  ]
  return (
    handles.find(
      ({ x, y }) =>
        Math.abs(point.x - x) <= tolerance
        && Math.abs(point.y - y) <= tolerance,
    )?.handle ?? null
  )
}

/** OCR候補のどのリサイズハンドルを操作するか判定する。 */
function candidateResizeHandleAtPoint(
  point: { x: number, y: number },
  candidate: RegionDraft,
): ResizeHandle | null {
  const tolerance = 8 / (props.zoom / 100)
  const handles: { handle: ResizeHandle, x: number, y: number }[] = [
    { handle: 'nw', x: candidate.x, y: candidate.y },
    { handle: 'n', x: candidate.x + candidate.width / 2, y: candidate.y },
    { handle: 'ne', x: candidate.x + candidate.width, y: candidate.y },
    {
      handle: 'e',
      x: candidate.x + candidate.width,
      y: candidate.y + candidate.height / 2,
    },
    {
      handle: 'se',
      x: candidate.x + candidate.width,
      y: candidate.y + candidate.height,
    },
    {
      handle: 's',
      x: candidate.x + candidate.width / 2,
      y: candidate.y + candidate.height,
    },
    { handle: 'sw', x: candidate.x, y: candidate.y + candidate.height },
    {
      handle: 'w',
      x: candidate.x,
      y: candidate.y + candidate.height / 2,
    },
  ]
  return (
    handles.find(
      ({ x, y }) =>
        Math.abs(point.x - x) <= tolerance
        && Math.abs(point.y - y) <= tolerance,
    )?.handle ?? null
  )
}

/** 二点から矩形を作り、座標と寸法を整数に丸める。 */
function normalizedBounds(
  start: { x: number, y: number },
  end: { x: number, y: number },
): RegionDraft {
  return {
    x: Math.round(Math.min(start.x, end.x)),
    y: Math.round(Math.min(start.y, end.y)),
    width: Math.round(Math.abs(end.x - start.x)),
    height: Math.round(Math.abs(end.y - start.y)),
  }
}

/** 印刷範囲の変更を親コンポーネントへ通知する。 */
function emitPrintArea(bounds: RegionDraft) {
  emit('updatePrintArea', {
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.round(bounds.width),
    height: Math.round(bounds.height),
  })
}

/** 印刷範囲のドラッグに使った一時状態を解除する。 */
function clearPrintAreaInteraction() {
  printAreaInteraction.value = null
  draftPrintArea.value = null
}

/** 印刷範囲・候補・マスク・保護領域などのモードから、このドラッグで扱う対象を決める。 */
function onPointerDown(event: PointerEvent) {
  if (!props.image || event.button !== 0)
    return
  const candidatePoint = pointFromEvent(event)
  if (props.printAreaEditing) {
    canvas.value?.setPointerCapture(event.pointerId)
    const pendingClickSelection = printAreaInteraction.value
    if (
      pendingClickSelection
      && pendingClickSelection.original.width === 0
      && pendingClickSelection.original.height === 0
    ) {
      const bounds = normalizedBounds(
        pendingClickSelection.start,
        candidatePoint,
      )
      draftPrintArea.value = bounds
      if (usablePrintArea(bounds)) {
        emitPrintArea(bounds)
        clearPrintAreaInteraction()
      }
      return
    }
    const area = props.printArea
    const handle = area ? regionResizeHandleAtPoint(candidatePoint, area) : null
    if (area && (handle || pointInsideBounds(candidatePoint, area))) {
      printAreaInteraction.value = {
        kind: handle ? 'resize' : 'move',
        start: candidatePoint,
        original: { ...area },
        handle: handle ?? undefined,
      }
      draftPrintArea.value = { ...area }
    }
    else {
      printAreaInteraction.value = {
        kind: 'resize',
        start: candidatePoint,
        original: {
          x: candidatePoint.x,
          y: candidatePoint.y,
          width: 0,
          height: 0,
        },
        handle: 'se',
      }
      draftPrintArea.value = { ...printAreaInteraction.value.original }
    }
    return
  }
  if (props.regionCandidates.length > 0) {
    const selectedCandidate = props.regionCandidates.find(
      item => item.id === props.selectedCandidateId,
    )
    const handle = selectedCandidate
      ? candidateResizeHandleAtPoint(candidatePoint, selectedCandidate)
      : null
    const candidate = handle
      ? selectedCandidate!
      : props.regionCandidates.findLast(item =>
          pointInsideBounds(candidatePoint, item),
        )
    if (!candidate) {
      emit('selectRegionCandidate', null)
      return
    }
    emit('selectRegionCandidate', candidate.id)
    canvas.value?.setPointerCapture(event.pointerId)
    candidateInteraction.value = {
      kind: handle ? 'resize' : 'move',
      id: candidate.id,
      start: candidatePoint,
      original: {
        x: candidate.x,
        y: candidate.y,
        width: candidate.width,
        height: candidate.height,
      },
      handle: handle ?? undefined,
    }
    draftCandidate.value = { ...candidateInteraction.value.original }
    return
  }
  canvas.value?.setPointerCapture(event.pointerId)
  const selected = selectedRegion()
  if (props.maskEditing && selected?.backgroundMode === 'manual') {
    const point = pointFromEvent(event)
    if (!pointInsideRegion(point, selected))
      return
    draftMaskStroke.value = {
      brushSize: props.maskBrushSize,
      mode: props.maskBrushMode,
      points: [
        {
          x: Math.max(0, Math.min(selected.width, point.x - selected.x)),
          y: Math.max(0, Math.min(selected.height, point.y - selected.y)),
        },
      ],
    }
    activeMaskPointerId.value = event.pointerId
    return
  }
  const point = pointFromEvent(event)
  if (props.exclusionEditing) {
    // 保護領域の追加中は通常領域の作成へフォールスルーさせない。
    // 選択領域の外から始めたドラッグは何もせず終了する。
    if (!selected || !pointInsideRegion(point, selected))
      return
    const local = relativePoint(point, selected)
    emit('selectExclusion', null)
    exclusionInteraction.value = { kind: 'create', start: local }
    draftExclusion.value = { x: local.x, y: local.y, width: 0, height: 0 }
    return
  }
  if (selected) {
    const selectedArea = selected.exclusionAreas.find(
      area => area.id === props.selectedExclusionId,
    )
    const handle = selectedArea
      ? resizeHandleAtPoint(point, selectedArea, selected)
      : null
    const hitArea = handle ? selectedArea! : exclusionAtPoint(point)
    if (hitArea) {
      const local = relativePoint(point, selected)
      emit('selectExclusion', hitArea.id)
      exclusionInteraction.value = {
        kind: handle ? 'resize' : 'move',
        start: local,
        original: { ...hitArea },
        handle: handle ?? undefined,
      }
      draftExclusion.value = { ...hitArea }
      return
    }
    const regionHandle = regionResizeHandleAtPoint(point, selected)
    if (regionHandle || pointInsideRegion(point, selected)) {
      emit('selectExclusion', null)
      regionInteraction.value = {
        kind: regionHandle ? 'resize' : 'move',
        start: point,
        original: {
          x: selected.x,
          y: selected.y,
          width: selected.width,
          height: selected.height,
        },
        handle: regionHandle ?? undefined,
      }
      draftRegion.value = { ...regionInteraction.value.original }
      return
    }
  }
  dragStart.value = point
  draft.value = null
}

/** ドラッグ量から保護領域の変更後の矩形を計算する。 */
function resizedExclusion(
  interaction: ExclusionInteraction,
  point: { x: number, y: number },
  region: TextRegion,
): RegionDraft {
  const original = interaction.original!
  const dx = point.x - interaction.start.x
  const dy = point.y - interaction.start.y
  if (interaction.kind === 'move') {
    return {
      x: clamp(original.x + dx, 0, region.width - original.width),
      y: clamp(original.y + dy, 0, region.height - original.height),
      width: original.width,
      height: original.height,
    }
  }
  const minimum = 5
  const right = original.x + original.width
  const bottom = original.y + original.height
  const left = interaction.handle?.includes('w')
    ? clamp(original.x + dx, 0, right - minimum)
    : original.x
  const top = interaction.handle?.includes('n')
    ? clamp(original.y + dy, 0, bottom - minimum)
    : original.y
  const resizedRight = interaction.handle?.includes('e')
    ? clamp(right + dx, original.x + minimum, region.width)
    : right
  const resizedBottom = interaction.handle?.includes('s')
    ? clamp(bottom + dy, original.y + minimum, region.height)
    : bottom
  return {
    x: left,
    y: top,
    width: resizedRight - left,
    height: resizedBottom - top,
  }
}

/** 開始時の領域と現在のポインターから移動・リサイズ後の範囲を求める。 */
function changedRegionBounds(
  interaction: RegionInteraction,
  point: { x: number, y: number },
): RegionDraft {
  const original = interaction.original
  const dx = point.x - interaction.start.x
  const dy = point.y - interaction.start.y
  if (interaction.kind === 'move') {
    return {
      x: clamp(original.x + dx, 0, props.project.imageWidth - original.width),
      y: clamp(original.y + dy, 0, props.project.imageHeight - original.height),
      width: original.width,
      height: original.height,
    }
  }
  const minimum = 5
  const right = original.x + original.width
  const bottom = original.y + original.height
  const left = interaction.handle?.includes('w')
    ? clamp(original.x + dx, 0, right - minimum)
    : original.x
  const top = interaction.handle?.includes('n')
    ? clamp(original.y + dy, 0, bottom - minimum)
    : original.y
  const resizedRight = interaction.handle?.includes('e')
    ? clamp(right + dx, original.x + minimum, props.project.imageWidth)
    : right
  const resizedBottom = interaction.handle?.includes('s')
    ? clamp(bottom + dy, original.y + minimum, props.project.imageHeight)
    : bottom
  return {
    x: left,
    y: top,
    width: resizedRight - left,
    height: resizedBottom - top,
  }
}

/** 候補の開始位置から変更後の矩形を計算する。 */
function changedCandidateBounds(
  interaction: CandidateInteraction,
  point: { x: number, y: number },
): RegionDraft {
  return changedRegionBounds(interaction, point)
}

/** 描画中のマスクを一筆分の確定操作として親へ渡す。 */
function commitDraftMaskStroke() {
  if (draftMaskStroke.value && props.selectedRegionId) {
    emit('addMaskStroke', props.selectedRegionId, draftMaskStroke.value)
  }
  draftMaskStroke.value = null
  activeMaskPointerId.value = null
}

/** 現在の編集モードに応じてドラッグ中の範囲やマスクを更新する。 */
function onPointerMove(event: PointerEvent) {
  if (printAreaInteraction.value) {
    const interaction = printAreaInteraction.value
    draftPrintArea.value = interaction.original.width === 0
      && interaction.original.height === 0
      ? normalizedBounds(interaction.start, pointFromEvent(event))
      : changedRegionBounds(interaction, pointFromEvent(event))
    return
  }
  if (candidateInteraction.value) {
    draftCandidate.value = changedCandidateBounds(
      candidateInteraction.value,
      pointFromEvent(event),
    )
    return
  }
  if (draftMaskStroke.value && event.pointerId === activeMaskPointerId.value) {
    const selected = props.project.regions.find(
      region => region.id === props.selectedRegionId,
    )
    if (!selected)
      return
    const point = pointFromEvent(event)
    draftMaskStroke.value.points.push({
      x: Math.max(0, Math.min(selected.width, point.x - selected.x)),
      y: Math.max(0, Math.min(selected.height, point.y - selected.y)),
    })
    draftMaskStroke.value = { ...draftMaskStroke.value }
    return
  }
  if (exclusionInteraction.value) {
    const selected = selectedRegion()
    if (!selected)
      return
    const point = relativePoint(pointFromEvent(event), selected)
    if (exclusionInteraction.value.kind === 'create') {
      draftExclusion.value = normalizedBounds(
        exclusionInteraction.value.start,
        point,
      )
    }
    else {
      draftExclusion.value = resizedExclusion(
        exclusionInteraction.value,
        point,
        selected,
      )
    }
    return
  }
  if (regionInteraction.value) {
    draftRegion.value = changedRegionBounds(
      regionInteraction.value,
      pointFromEvent(event),
    )
    return
  }
  if (!dragStart.value)
    return
  draft.value = normalizedBounds(dragStart.value, pointFromEvent(event))
}

/** ポインター位置にある翻訳領域を探す。 */
function findRegion(point: { x: number, y: number }) {
  return props.project.regions.findLast(
    region =>
      point.x >= region.x
      && point.x <= region.x + region.width
      && point.y >= region.y
      && point.y <= region.y + region.height,
  )
}

/** 新しい領域の背景色を元画像から推定する。 */
function colorFromOriginalImage(bounds: RegionDraft) {
  const context = sourceContext()
  if (!context)
    return '#ffffff'
  return estimateBackgroundColor(
    context,
    bounds.x,
    bounds.y,
    bounds.width,
    bounds.height,
    props.project.imageWidth,
    props.project.imageHeight,
  )
}

/** 操作対象ごとの確定条件を判定し、確定した範囲やマスクを親へ通知する。 */
function onPointerUp(event: PointerEvent) {
  if (printAreaInteraction.value) {
    const bounds = draftPrintArea.value
    const completion = printAreaPointerCompletion(
      printAreaInteraction.value.original,
      bounds,
    )
    if (completion === 'commit' && bounds) {
      emitPrintArea(bounds)
      clearPrintAreaInteraction()
    }
    else if (completion === 'cancel') {
      clearPrintAreaInteraction()
    }
    return
  }
  if (candidateInteraction.value) {
    const bounds = draftCandidate.value
    const interaction = candidateInteraction.value
    if (bounds) {
      const rounded = {
        x: Math.round(bounds.x),
        y: Math.round(bounds.y),
        width: Math.round(bounds.width),
        height: Math.round(bounds.height),
      }
      if (
        rounded.x !== interaction.original.x
        || rounded.y !== interaction.original.y
        || rounded.width !== interaction.original.width
        || rounded.height !== interaction.original.height
      ) {
        emit('updateRegionCandidateBounds', interaction.id, rounded)
      }
    }
    candidateInteraction.value = null
    draftCandidate.value = null
    return
  }
  if (draftMaskStroke.value && event.pointerId === activeMaskPointerId.value) {
    commitDraftMaskStroke()
    return
  }
  if (exclusionInteraction.value) {
    const selected = selectedRegion()
    const bounds = draftExclusion.value
    if (selected && bounds && bounds.width >= 5 && bounds.height >= 5) {
      const rounded = {
        x: Math.round(bounds.x),
        y: Math.round(bounds.y),
        width: Math.round(bounds.width),
        height: Math.round(bounds.height),
      }
      if (exclusionInteraction.value.kind === 'create') {
        emit('addExclusion', selected.id, rounded)
      }
      else if (exclusionInteraction.value.original) {
        emit(
          'updateExclusion',
          selected.id,
          exclusionInteraction.value.original.id,
          rounded,
        )
      }
    }
    exclusionInteraction.value = null
    draftExclusion.value = null
    return
  }
  if (regionInteraction.value && props.selectedRegionId) {
    const bounds = draftRegion.value
    const original = regionInteraction.value.original
    if (bounds) {
      const rounded = {
        x: Math.round(bounds.x),
        y: Math.round(bounds.y),
        width: Math.round(bounds.width),
        height: Math.round(bounds.height),
      }
      if (
        rounded.x !== original.x
        || rounded.y !== original.y
        || rounded.width !== original.width
        || rounded.height !== original.height
      ) {
        emit('updateRegionBounds', props.selectedRegionId, rounded)
      }
    }
    regionInteraction.value = null
    draftRegion.value = null
    return
  }
  if (!dragStart.value)
    return
  const point = pointFromEvent(event)
  const bounds = normalizedBounds(dragStart.value, point)
  if (bounds.width >= 5 && bounds.height >= 5) {
    emit('addRegion', bounds, colorFromOriginalImage(bounds))
  }
  else {
    emit('selectRegion', findRegion(point)?.id ?? null)
  }
  dragStart.value = null
  draft.value = null
}

/** 中断されたドラッグの仮状態を捨て、途中の範囲やマスクが確定されるのを防ぐ。 */
function onPointerCancel() {
  dragStart.value = null
  draft.value = null
  draftMaskStroke.value = null
  activeMaskPointerId.value = null
  exclusionInteraction.value = null
  draftExclusion.value = null
  regionInteraction.value = null
  draftRegion.value = null
  candidateInteraction.value = null
  draftCandidate.value = null
  printAreaInteraction.value = null
  draftPrintArea.value = null
}

// 印刷範囲編集を離れたら、そのドラッグ状態を解除する。
watch(
  () => props.printAreaEditing,
  (editing) => {
    if (!editing)
      clearPrintAreaInteraction()
  },
)

/** 描画中のマスクのポインター捕捉を失ったら、そのストロークを確定する。 */
function onLostPointerCapture(event: PointerEvent) {
  if (draftMaskStroke.value && event.pointerId === activeMaskPointerId.value) {
    commitDraftMaskStroke()
  }
}

/** 表示倍率に関係なく元解像度で再描画し、選択枠を含まないPNG／JPEGを生成する。 */
async function exportImage(
  type: 'image/png' | 'image/jpeg',
): Promise<Blob | null> {
  if (!props.image)
    return null
  const output = document.createElement('canvas')
  output.width = props.project.imageWidth
  output.height = props.project.imageHeight
  const context = output.getContext('2d')
  if (!context)
    return null
  renderCard(
    context,
    props.image,
    output.width,
    output.height,
    props.project.regions,
    props.assets.filter(asset => props.assetImages.has(asset.id)),
    props.assetImages,
    props.fontFamilies,
  )
  return new Promise(resolve => output.toBlob(resolve, type, 0.92))
}

defineExpose({
  exportPng: () => exportImage('image/png'),
  exportJpeg: () => exportImage('image/jpeg'),
  backgroundColorForBounds: colorFromOriginalImage,
})
</script>

<template>
  <div
    class="canvas-stage"
    :class="{ 'is-empty': !image, 'print-area-editing': printAreaEditing }"
  >
    <div v-if="!image" class="canvas-empty">
      <template v-if="projectSelected">
        <p>PNG / JPEG画像を開いてください</p>
        <button
          type="button"
          class="primary card-image-open-button"
          @click="openImagePicker"
        >
          カード画像を開く
        </button>
        <input
          ref="imageInput"
          class="visually-hidden"
          type="file"
          accept="image/png,image/jpeg"
          @change="pickImage"
        >
        <small>画像はブラウザ内だけで処理され、サーバーには送信されません。</small>
      </template>
      <template v-else>
        <p>先にプロジェクトを開いてください</p>
        <small>既存プロジェクト、または新規作成用の空フォルダを選択します。</small>
      </template>
    </div>
    <div v-if="image" class="canvas-stage-toolbar">
      <div class="canvas-view-controls" aria-label="画像表示切替">
        <button
          type="button"
          :class="{ selected: previewMode === 'edited' }"
          @click="$emit('updatePreviewMode', 'edited')"
        >
          編集結果
        </button>
        <button
          type="button"
          :class="{ selected: previewMode === 'original' }"
          @click="$emit('updatePreviewMode', 'original')"
        >
          元画像
        </button>
      </div>
      <ZoomControls :zoom="zoom" @update-zoom="$emit('updateZoom', $event)" />
    </div>
    <canvas
      v-show="image"
      ref="canvas"
      :width="project.imageWidth"
      :height="project.imageHeight"
      :style="{
        width: `${project.imageWidth * (zoom / 100)}px`,
        height: `${project.imageHeight * (zoom / 100)}px`,
      }"
      aria-label="カード編集キャンバス"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerCancel"
      @lostpointercapture="onLostPointerCapture"
    />
  </div>
</template>
