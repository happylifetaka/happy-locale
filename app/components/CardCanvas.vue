<script setup lang="ts">
import type { Point, ResizeHandle } from '~/features/cards/canvas/geometry'
import type {
  CardProject,
  ExclusionArea,
  ImageAsset,
  MaskStroke,
  RegionDraft,
  TextRegion,
} from '~/types/editor'
import type { RegionCandidate } from '~/types/ocr'
import { onScopeDispose } from 'vue'
import { changedBounds, resizeHandleAtPoint as geometryResizeHandleAtPoint, imagePoint, lastBoundsAtPoint, normalizedBounds, pointInsideBounds, relativePoint, roundedBounds } from '~/features/cards/canvas/geometry'
import { createCardCanvasRenderer } from '~/features/cards/canvas/renderer'
import { useEditorToolsStore } from '~/stores/editor-tools'
import { consumeSelectedFile } from '~/utils/file-input'
import {
  printAreaPointerCompletion,
  usablePrintArea,
} from '~/utils/print-area'

const props = defineProps<{
  image: HTMLImageElement | null
  projectSelected: boolean
  project: CardProject
  previewDeferred: boolean
  selectedRegionId: string | null
  autoMaskPreview: boolean
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
  'addRegion': [bounds: RegionDraft, backgroundColor: string]
  'updateRegionBounds': [regionId: string, bounds: RegionDraft]
  'selectRegion': [id: string | null]
  'addMaskStroke': [regionId: string, stroke: MaskStroke]
  'addExclusion': [regionId: string, bounds: RegionDraft]
  'updateExclusion': [regionId: string, exclusionId: string, bounds: RegionDraft]
  'selectExclusion': [id: string | null]
  'update:previewMode': [mode: 'edited' | 'original']
  'update:zoom': [value: number]
  'selectRegionCandidate': [id: string | null]
  'updateRegionCandidateBounds': [id: string, bounds: RegionDraft]
  'updatePrintArea': [bounds: RegionDraft]
  'image': [file: File]
  'diagnostic': [message: string]
}>()

const editorTools = useEditorToolsStore()

/** 描画とポインター座標の変換に使用するCanvas要素。 */
const canvas = ref<HTMLCanvasElement | null>(null)
/** 画像ファイルを選ぶための非表示の入力要素。 */
const imageInput = ref<HTMLInputElement | null>(null)
/** ドラッグ開始位置。元画像の画素座標。 */
const dragStart = ref<{ x: number, y: number } | null>(null)
/** 作成中の翻訳領域の矩形。元画像の画素座標。 */
const draft = ref<RegionDraft | null>(null)
/** カード上で描いている途中の消去・復元マスク。 */
const draftMaskStroke = ref<MaskStroke | null>(null)
/** 現在のマスク描画を開始したポインターの識別子。 */
const activeMaskPointerId = ref<number | null>(null)
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

const renderer = createCardCanvasRenderer(() => props)
const colorFromOriginalImage = renderer.colorFromOriginalImage
const exportImage = renderer.exportImage
onScopeDispose(renderer.dispose)

function redraw() {
  renderer.redraw(canvas.value, {
    region: draftRegion.value,
    newRegion: draft.value,
    exclusion: draftExclusion.value,
    creatingExclusion: exclusionInteraction.value?.kind === 'create',
    candidate: draftCandidate.value,
    maskStroke: draftMaskStroke.value,
    printArea: draftPrintArea.value,
  }, editorTools.maskEditing)
}

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

// 画像・編集状態・操作表示の変更に応じてCanvasを再描画する。
watch(
  () => [
    props.previewDeferred,
    props.image,
    props.project,
    props.selectedRegionId,
    props.autoMaskPreview,
    editorTools.maskEditing,
    editorTools.exclusionEditing,
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
  return imagePoint(event, element.getBoundingClientRect(), element)
}

/** 現在選択されている翻訳領域を取得する。 */
function selectedRegion() {
  return props.project.regions.find(
    region => region.id === props.selectedRegionId,
  )
}

/** ポインター位置にある保護領域を探す。 */
function exclusionAtPoint(point: Point) {
  const region = selectedRegion()
  return region ? lastBoundsAtPoint(region.exclusionAreas, relativePoint(point, region)) ?? null : null
}

/** ポインターが触れている矩形のリサイズハンドルを判定する。 */
function resizeHandleAtPoint(point: Point, area: ExclusionArea, region: TextRegion): ResizeHandle | null {
  return geometryResizeHandleAtPoint(relativePoint(point, region), area, props.zoom)
}

/** 翻訳領域のどのリサイズハンドルを操作するか判定する。 */
function regionResizeHandleAtPoint(point: Point, region: RegionDraft): ResizeHandle | null {
  return geometryResizeHandleAtPoint(point, region, props.zoom)
}

/** OCR候補のどのリサイズハンドルを操作するか判定する。 */
function candidateResizeHandleAtPoint(point: Point, candidate: RegionDraft): ResizeHandle | null {
  return geometryResizeHandleAtPoint(point, candidate, props.zoom, true)
}

/** 印刷範囲の変更を親コンポーネントへ通知する。 */
function emitPrintArea(bounds: RegionDraft) {
  emit('updatePrintArea', roundedBounds(bounds))
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
  if (editorTools.maskEditing && selected?.backgroundMode === 'manual') {
    const point = pointFromEvent(event)
    if (!pointInsideBounds(point, selected))
      return
    draftMaskStroke.value = {
      brushSize: editorTools.maskBrushSize,
      mode: editorTools.maskBrushMode,
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
  if (editorTools.exclusionEditing) {
    // 保護領域の追加中は通常領域の作成へフォールスルーさせない。
    // 選択領域の外から始めたドラッグは何もせず終了する。
    if (!selected || !pointInsideBounds(point, selected))
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
    if (regionHandle || pointInsideBounds(point, selected)) {
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
function resizedExclusion(interaction: ExclusionInteraction, point: Point, region: TextRegion): RegionDraft {
  return changedBounds({ ...interaction, kind: interaction.kind === 'move' ? 'move' : 'resize', original: interaction.original! }, point, region)
}

/** 開始時の領域と現在のポインターから移動・リサイズ後の範囲を求める。 */
function changedRegionBounds(interaction: RegionInteraction, point: Point): RegionDraft {
  return changedBounds(interaction, point, { width: props.project.imageWidth, height: props.project.imageHeight })
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
function findRegion(point: Point) {
  return lastBoundsAtPoint(props.project.regions, point)
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
      const rounded = roundedBounds(bounds)
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
      const rounded = roundedBounds(bounds)
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
      const rounded = roundedBounds(bounds)
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
          @click="$emit('update:previewMode', 'edited')"
        >
          編集結果
        </button>
        <button
          type="button"
          :class="{ selected: previewMode === 'original' }"
          @click="$emit('update:previewMode', 'original')"
        >
          元画像
        </button>
      </div>
      <ZoomControls :zoom="zoom" @update-zoom="$emit('update:zoom', $event)" />
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
