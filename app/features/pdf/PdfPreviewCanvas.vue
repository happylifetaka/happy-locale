<script setup lang="ts">
import type {
  PdfBackgroundMode,
  PdfPageAnalysis,
  PdfProtectedArea,
  PdfTextColorMode,
  PdfTextEntry,
} from '~/services/pdf'
import {
  createPdfTranslationPatch,
  estimatePdfTextColor,
  isPdfEntryProtected,
} from '~/services/pdf'

const props = defineProps<{
  image: HTMLImageElement | null
  page: PdfPageAnalysis
  entries: readonly PdfTextEntry[]
  translations: ReadonlyMap<string, string>
  protectedAreas: readonly PdfProtectedArea[]
  excludedEntryIds: ReadonlySet<string>
  selectedEntryId: string | null
  backgroundMode: PdfBackgroundMode
  textColorMode: PdfTextColorMode
  fontFamily?: string
  protectionEditing: boolean
  ocrEditing: boolean
  zoom: number
}>()

const emit = defineEmits<{
  select: [entryId: string]
  addProtectedArea: [area: PdfProtectedArea]
  addOcrArea: [area: PdfProtectedArea]
}>()

/** 描画とポインター座標の変換に使用するCanvas要素。 */
const canvas = ref<HTMLCanvasElement | null>(null)
/** PDF上でドラッグ中の、まだ確定していない範囲。 */
const draftArea = ref<PdfProtectedArea | null>(null)
/** PDF上の範囲指定を開始した位置。 */
const draftStart = ref<{ x: number, y: number } | null>(null)

/** PDF文字項目の上端をプレビュー用に求める。 */
function entryTop(entry: PdfTextEntry) {
  return props.page.height - entry.y - entry.height
}

/** ポインター位置をCanvas内部の画素座標へ変換する。 */
function canvasPoint(event: PointerEvent) {
  const element = canvas.value
  if (!element)
    return null
  const rect = element.getBoundingClientRect()
  return {
    x: (event.clientX - rect.left) * element.width / rect.width,
    y: (event.clientY - rect.top) * element.height / rect.height,
  }
}

/** 画面のポインターをPDF編集用の座標へ戻し、ズームしても同じ範囲を選べるようにする。 */
function pdfPoint(event: PointerEvent) {
  const point = canvasPoint(event)
  const element = canvas.value
  if (!point || !element || props.page.width <= 0)
    return null
  const scale = element.width / props.page.width
  return { x: point.x / scale, y: point.y / scale }
}

/** ポインター位置をページ内に収まる座標へ変換する。 */
function clampedPagePoint(event: PointerEvent) {
  const point = pdfPoint(event)
  if (!point)
    return null
  return {
    x: Math.max(0, Math.min(props.page.width, point.x)),
    y: Math.max(0, Math.min(props.page.height, point.y)),
  }
}

/** ポインター操作を開始し、開始位置と操作対象を記録する。 */
function pointerDown(event: PointerEvent) {
  const point = pdfPoint(event)
  if (!point)
    return
  if (props.protectionEditing || props.ocrEditing) {
    const pagePoint = clampedPagePoint(event)
    if (!pagePoint)
      return
    draftStart.value = pagePoint
    draftArea.value = { ...pagePoint, width: 0, height: 0 }
    canvas.value?.setPointerCapture(event.pointerId)
    event.preventDefault()
    return
  }
  const hit = [...props.entries].reverse().find((candidate) => {
    const top = entryTop(candidate)
    return point.x >= candidate.x
      && point.x <= candidate.x + candidate.width
      && point.y >= top
      && point.y <= top + candidate.height
  })
  if (hit)
    emit('select', hit.id)
}

/** ポインターの移動に合わせて操作中の仮状態を更新する。 */
function pointerMove(event: PointerEvent) {
  const start = draftStart.value
  if (!start)
    return
  const point = clampedPagePoint(event)
  if (!point)
    return
  draftArea.value = {
    x: Math.min(start.x, point.x),
    y: Math.min(start.y, point.y),
    width: Math.abs(point.x - start.x),
    height: Math.abs(point.y - start.y),
  }
}

/** ポインター操作を終了し、有効な範囲を確定する。 */
function pointerUp(event: PointerEvent) {
  const area = draftArea.value
  draftStart.value = null
  draftArea.value = null
  if (canvas.value?.hasPointerCapture(event.pointerId))
    canvas.value.releasePointerCapture(event.pointerId)
  if (area && area.width >= 1 && area.height >= 1) {
    if (props.ocrEditing)
      emit('addOcrArea', area)
    else emit('addProtectedArea', area)
  }
}

/** PDF上の矩形を指定した見た目で描画する。 */
function drawArea(
  context: CanvasRenderingContext2D,
  area: PdfProtectedArea,
  scale: number,
  draft = false,
) {
  const x = area.x * scale
  const y = area.y * scale
  context.save()
  context.fillStyle = draft
    ? props.ocrEditing ? '#2563d438' : '#f59e0b38'
    : '#ef444438'
  context.strokeStyle = draft
    ? props.ocrEditing ? '#2563d4' : '#d97706'
    : '#dc2626'
  context.lineWidth = Math.max(1, scale)
  context.setLineDash(draft ? [4 * scale, 3 * scale] : [])
  context.fillRect(x, y, area.width * scale, area.height * scale)
  context.strokeRect(x, y, area.width * scale, area.height * scale)
  context.restore()
}

/** ページ画像に訳文と選択範囲を重ね、保護・除外の指定を編集画面で確認できるようにする。 */
function redraw() {
  const element = canvas.value
  const image = props.image
  if (!element || !image)
    return
  element.width = image.naturalWidth
  element.height = image.naturalHeight
  const context = element.getContext('2d')
  if (!context)
    return
  context.drawImage(image, 0, 0)
  const source = context.getImageData(0, 0, element.width, element.height)
  const scale = element.width / props.page.width
  const raster = { image: source, pageHeight: props.page.height, scale }

  for (const entry of props.entries) {
    if (props.excludedEntryIds.has(entry.id))
      continue
    const translation = props.translations.get(entry.id)?.trim()
    if (!translation || translation === entry.original)
      continue
    if (isPdfEntryProtected(entry, props.page.height, props.protectedAreas))
      continue
    const patch = createPdfTranslationPatch(
      entry,
      translation,
      props.backgroundMode,
      raster,
      props.textColorMode === 'original'
        ? estimatePdfTextColor(entry, raster)
        : '#000000',
      props.fontFamily,
    )
    context.drawImage(
      patch.canvas,
      Math.round((entry.x - patch.padding) * scale),
      Math.round((entryTop(entry) - patch.padding) * scale),
    )
  }

  for (const entry of props.entries) {
    const selected = entry.id === props.selectedEntryId
    const translated = Boolean(props.translations.get(entry.id)?.trim())
    const protectedEntry = isPdfEntryProtected(
      entry,
      props.page.height,
      props.protectedAreas,
    )
    const excluded = props.excludedEntryIds.has(entry.id)
    context.save()
    context.strokeStyle = excluded
      ? '#94a3b8'
      : protectedEntry
        ? '#dc2626'
        : selected
          ? '#2563d4'
          : translated
            ? '#16a34a'
            : '#64748b'
    context.lineWidth = (selected ? 2 : 1) * scale
    context.setLineDash(selected ? [] : [3 * scale, 3 * scale])
    context.strokeRect(
      entry.x * scale,
      entryTop(entry) * scale,
      entry.width * scale,
      entry.height * scale,
    )
    context.restore()
  }

  for (const area of props.protectedAreas)
    drawArea(context, area, scale)
  if (draftArea.value)
    drawArea(context, draftArea.value, scale, true)
}

// ページ画像・訳文・範囲設定・倍率の変更を再描画へ反映する。
watch(
  () => [
    props.image,
    props.page,
    props.entries,
    props.translations,
    props.protectedAreas,
    props.excludedEntryIds,
    props.selectedEntryId,
    props.backgroundMode,
    props.textColorMode,
    props.fontFamily,
    props.protectionEditing,
    props.ocrEditing,
    props.zoom,
    draftArea.value,
  ],
  redraw,
  { deep: true, flush: 'post' },
)

// Canvasの作成後に初回プレビューを描画する。
onMounted(redraw)
</script>

<template>
  <div
    class="pdf-preview-stage"
    :class="{ protecting: protectionEditing || ocrEditing }"
  >
    <canvas
      ref="canvas"
      :style="{
        width: `${page.width * zoom / 100}px`,
        height: `${page.height * zoom / 100}px`,
      }"
      @pointerdown="pointerDown"
      @pointermove="pointerMove"
      @pointerup="pointerUp"
      @pointercancel="pointerUp"
    />
  </div>
</template>
