<script setup lang="ts">
import type {
  CardProject,
  ImageAsset,
  MaskStroke,
  RegionDraft,
} from '~/types/editor'
import type { RegionCandidate } from '~/types/ocr'
import { onScopeDispose } from 'vue'
import { createCardCanvasRenderer } from '~/features/cards/canvas/renderer'
import { useCanvasInteractions } from '~/features/cards/canvas/useCanvasInteractions'
import { useEditorToolsStore } from '~/stores/editor-tools'
import { consumeSelectedFile } from '~/utils/file-input'

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
const renderer = createCardCanvasRenderer(() => props)
const colorFromOriginalImage = renderer.colorFromOriginalImage
const exportImage = renderer.exportImage
onScopeDispose(renderer.dispose)

const interactions = useCanvasInteractions(props, canvas, editorTools, {
  addRegion: (bounds, backgroundColor) => emit('addRegion', bounds, backgroundColor),
  updateRegionBounds: (id, bounds) => emit('updateRegionBounds', id, bounds),
  selectRegion: id => emit('selectRegion', id),
  addMaskStroke: (id, stroke) => emit('addMaskStroke', id, stroke),
  addExclusion: (id, bounds) => emit('addExclusion', id, bounds),
  updateExclusion: (id, exclusionId, bounds) => emit('updateExclusion', id, exclusionId, bounds),
  selectExclusion: id => emit('selectExclusion', id),
  selectRegionCandidate: id => emit('selectRegionCandidate', id),
  updateRegionCandidateBounds: (id, bounds) => emit('updateRegionCandidateBounds', id, bounds),
  updatePrintArea: bounds => emit('updatePrintArea', bounds),
}, colorFromOriginalImage)
const { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onLostPointerCapture } = interactions

function redraw() {
  renderer.redraw(canvas.value, interactions.drafts.value, editorTools.maskEditing)
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
    interactions.drafts.value,
  ],
  () => {
    if (!props.previewDeferred)
      redraw()
  },
  { deep: true, flush: 'post' },
)

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
