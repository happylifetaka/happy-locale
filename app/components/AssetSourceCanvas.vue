<script setup lang="ts">
import type { RegionDraft } from '~/types/editor'
import { drawSelection } from '~/utils/canvas/render'
import { consumeSelectedFile } from '~/utils/file-input'

const props = defineProps<{
  image: HTMLImageElement | null
  zoom: number
  selecting: boolean
}>()

const emit = defineEmits<{
  select: [bounds: RegionDraft]
  image: [file: File]
  updateZoom: [value: number]
}>()

/** 描画とポインター座標の変換に使用するCanvas要素。 */
const canvas = ref<HTMLCanvasElement | null>(null)
/** ドラッグ開始位置。元画像の画素座標。 */
const dragStart = ref<{ x: number, y: number } | null>(null)
/** 切り出し範囲のドラッグ中の矩形。元画像の画素座標。 */
const draft = ref<RegionDraft | null>(null)

/** 現在の画像と操作状態に合わせてCanvasを描き直す。 */
function redraw() {
  const element = canvas.value
  if (!element || !props.image)
    return
  const context = element.getContext('2d')
  if (!context)
    return
  context.clearRect(0, 0, element.width, element.height)
  context.drawImage(props.image, 0, 0, element.width, element.height)
  if (draft.value)
    drawSelection(context, draft.value, true)
}

// 画像・倍率・ドラッグ範囲の変更をCanvasへ反映する。
watch(() => [props.image, props.zoom, draft.value], redraw, {
  deep: true,
  flush: 'post',
})

/** 画像の表示サイズとズームを元座標へ変換し、切り出し範囲を画像内に制限する。 */
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

/** 二点を対角とする矩形を求め、座標と寸法を整数に丸める。 */
function boundsBetween(
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

/** ポインター操作を開始し、開始位置と操作対象を記録する。 */
function pointerDown(event: PointerEvent) {
  if (!props.image || !props.selecting || event.button !== 0)
    return
  canvas.value?.setPointerCapture(event.pointerId)
  dragStart.value = pointFromEvent(event)
  draft.value = null
}

/** ポインターの移動に合わせて操作中の仮状態を更新する。 */
function pointerMove(event: PointerEvent) {
  if (!dragStart.value)
    return
  draft.value = boundsBetween(dragStart.value, pointFromEvent(event))
}

/** ポインター操作を終了し、有効な範囲を確定する。 */
function pointerUp(event: PointerEvent) {
  if (!dragStart.value)
    return
  const bounds = boundsBetween(dragStart.value, pointFromEvent(event))
  dragStart.value = null
  draft.value = null
  if (bounds.width >= 5 && bounds.height >= 5)
    emit('select', bounds)
}

/** 操作中の仮状態を破棄して範囲指定を終了する。 */
function cancel() {
  dragStart.value = null
  draft.value = null
}

/** ファイル入力から画像を取り出して読み込みを要求する。 */
function pickImage(event: Event) {
  const input = event.target as HTMLInputElement
  const file = consumeSelectedFile(input)
  if (file)
    emit('image', file)
}
</script>

<template>
  <div class="asset-source-stage" :class="{ selecting, 'is-empty': !image }">
    <div v-if="!image" class="canvas-empty">
      <p>先にカード画像を開いてください</p>
      <label class="button primary asset-source-open-button">
        アセット元画像を開く
        <input
          class="visually-hidden"
          type="file"
          accept="image/png,image/jpeg"
          @change="pickImage"
        >
      </label>
    </div>
    <div v-if="image" class="canvas-stage-toolbar is-single">
      <ZoomControls :zoom="zoom" @update-zoom="$emit('updateZoom', $event)" />
    </div>
    <canvas
      v-if="image"
      ref="canvas"
      :width="image.naturalWidth"
      :height="image.naturalHeight"
      :style="{
        width: `${image.naturalWidth * (zoom / 100)}px`,
        height: `${image.naturalHeight * (zoom / 100)}px`,
      }"
      aria-label="アセット切り出し元画像"
      @pointerdown="pointerDown"
      @pointermove="pointerMove"
      @pointerup="pointerUp"
      @pointercancel="cancel"
    />
  </div>
</template>
