<script setup lang="ts">
import type { AssetCreationDraft, MaskPoint, MaskStroke } from '~/types/editor'
import { validateAssetName } from '~/utils/assets'
import { renderAssetCrop } from '~/utils/canvas/asset'

const props = defineProps<{
  running?: boolean
  image: HTMLImageElement
  draft: AssetCreationDraft
  existingAssets: { id: string, name: string }[]
}>()

const emit = defineEmits<{
  update: [patch: Partial<AssetCreationDraft>]
  confirm: []
  cancel: []
}>()

/** 切り出し結果を描画するプレビューCanvas。 */
const preview = ref<HTMLCanvasElement | null>(null)
const previewViewport = ref<HTMLElement | null>(null)
const viewportSize = ref({ width: 320, height: 320 })
const zoomLevels = [25, 50, 100, 200, 400, 800, 1600]
const previewZoom = ref<number | 'fit'>('fit')
const cropSize = computed(() => ({
  width: Math.max(1, Math.round(props.draft.sourceRect.width)),
  height: Math.max(1, Math.round(props.draft.sourceRect.height)),
}))
// 表示倍率だけを変更し、Canvas・ブラシ・保存PNGは元画像の画素単位を保つ。
const fitScale = computed(() => Math.min(16, Math.max(0.01, Math.min(
  (viewportSize.value.width - 48) / cropSize.value.width,
  (viewportSize.value.height - 48) / cropSize.value.height,
))))
const previewScale = computed(() => previewZoom.value === 'fit' ? fitScale.value : previewZoom.value / 100)
const previewImageStyle = computed(() => ({
  width: `${cropSize.value.width * previewScale.value}px`,
  height: `${cropSize.value.height * previewScale.value}px`,
}))
const previewStageStyle = computed(() => ({
  width: `${cropSize.value.width * previewScale.value + 48}px`,
  height: `${cropSize.value.height * previewScale.value + 48}px`,
}))
let resizeObserver: ResizeObserver | null = null
/** 透過ブラシで編集しているか。 */
const brushEditing = ref(false)
/** 元画像から背景色を採取しているか。 */
const colorSampling = ref(false)
/** 透過を追加するか、元の透明度へ戻すかの操作モード。 */
const brushMode = ref<'paint' | 'erase'>('paint')
/** ブラシの直径。切り出し画像の画素単位。 */
const brushSize = ref(20)
/** ドラッグ中で、まだ確定していない一筆分のブラシ軌跡。 */
const workingStroke = shallowRef<MaskStroke | null>(null)
/** ブラシの大きさを表示するための画像内カーソル位置。 */
const brushCursor = ref<MaskPoint | null>(null)
const brushCursorStyle = computed(() => brushCursor.value
  ? {
      left: `${brushCursor.value.x * previewScale.value}px`,
      top: `${brushCursor.value.y * previewScale.value}px`,
      width: `${brushSize.value * previewScale.value}px`,
      height: `${brushSize.value * previewScale.value}px`,
    }
  : undefined)

/** 切り出し範囲の寸法から決めたブラシサイズの上限。 */
const maximumBrushSize = computed(() => Math.max(
  100,
  Math.ceil(Math.hypot(cropSize.value.width, cropSize.value.height)),
))

/** 確定済みの軌跡に操作中の一筆を加えたプレビュー用マスク。 */
const previewStrokes = computed(() => workingStroke.value
  ? [...props.draft.manualMaskStrokes, workingStroke.value]
  : props.draft.manualMaskStrokes)
/** 空欄・禁止文字・重複名についてのアセット名の検証結果。 */
const nameError = computed(() => validateAssetName(
  props.draft.name,
  props.existingAssets,
  props.draft.editingAssetId ?? undefined,
))

/** 確定時と同じ切り出し処理で透過結果を描き、作業中のブラシもプレビューへ重ねる。 */
function redraw() {
  const canvas = preview.value
  if (!canvas)
    return
  const rendered = renderAssetCrop(
    props.image,
    props.draft.sourceRect,
    props.draft.removeBackground,
    {
      threshold: props.draft.backgroundThreshold,
      feather: props.draft.edgeFeather,
      backgroundColor: props.draft.backgroundColor,
    },
    previewStrokes.value,
  )
  canvas.width = rendered.width
  canvas.height = rendered.height
  const context = canvas.getContext('2d')
  context?.drawImage(rendered, 0, 0)
}

// 下書きやブラシ設定の変化を、DOM更新後のプレビューへ反映する。
watch(
  () => [props.draft, brushEditing.value, brushMode.value, brushSize.value],
  redraw,
  { deep: true, flush: 'post' },
)
// 切り出し範囲が変わったらブラシサイズを新しい上限に収める。
watch(maximumBrushSize, (maximum) => {
  brushSize.value = Math.min(brushSize.value, maximum)
}, { immediate: true })
// 背景透過を無効にしたらブラシと色採取の操作も終了する。
watch(() => props.draft.removeBackground, (enabled) => {
  if (enabled)
    return
  brushEditing.value = false
  colorSampling.value = false
  workingStroke.value = null
  brushCursor.value = null
})
// Canvasが作られてから最初のプレビューを描画する。
onMounted(() => {
  redraw()
  const updateViewport = () => {
    const viewport = previewViewport.value
    if (viewport?.clientWidth && viewport.clientHeight)
      viewportSize.value = { width: viewport.clientWidth, height: viewport.clientHeight }
  }
  updateViewport()
  if (typeof ResizeObserver !== 'undefined' && previewViewport.value) {
    resizeObserver = new ResizeObserver(updateViewport)
    resizeObserver.observe(previewViewport.value)
  }
})
onBeforeUnmount(() => resizeObserver?.disconnect())
watch([() => props.image, () => JSON.stringify(props.draft.sourceRect)], () => {
  previewZoom.value = 'fit'
  workingStroke.value = null
  brushCursor.value = null
})
watch(previewScale, () => {
  brushCursor.value = null
  const viewport = previewViewport.value
  if (viewport) {
    viewport.scrollLeft = Math.max(0, (viewport.scrollWidth - viewport.clientWidth) / 2)
    viewport.scrollTop = Math.max(0, (viewport.scrollHeight - viewport.clientHeight) / 2)
  }
}, { flush: 'post' })

function stepZoom(direction: -1 | 1) {
  const percent = previewScale.value * 100
  const next = direction === 1
    ? zoomLevels.find(value => value > percent + 0.01)
    : [...zoomLevels].reverse().find(value => value < percent - 0.01)
  if (next !== undefined)
    previewZoom.value = next
}

function updateBrushSize(event: Event) {
  const input = event.target as HTMLInputElement
  const value = Number(input.value)
  if (input.value && Number.isFinite(value))
    brushSize.value = Math.max(1, Math.min(maximumBrushSize.value, Math.round(value)))
  input.value = String(brushSize.value)
}

/** 拡大表示したプレビュー上の操作を、切り出し画像内の画素座標へ戻す。 */
function pointFromEvent(event: PointerEvent): MaskPoint {
  const canvas = preview.value!
  const bounds = canvas.getBoundingClientRect()
  return {
    x: (event.clientX - bounds.left) * canvas.width / bounds.width,
    y: (event.clientY - bounds.top) * canvas.height / bounds.height,
  }
}

/** ポインター操作を開始し、開始位置と操作対象を記録する。 */
function pointerDown(event: PointerEvent) {
  if (!props.draft.removeBackground || event.button !== 0)
    return
  const point = pointFromEvent(event)
  if (colorSampling.value) {
    if (point.x >= 0 && point.y >= 0 && point.x < preview.value!.width && point.y < preview.value!.height)
      sampleBackgroundColor(point)
    return
  }
  if (!brushEditing.value)
    return
  const target = event.currentTarget as HTMLElement
  target.setPointerCapture(event.pointerId)
  brushCursor.value = point
  workingStroke.value = {
    brushSize: brushSize.value,
    mode: brushMode.value,
    points: [point],
  }
  redraw()
}

/** ポインターの移動に合わせて操作中の仮状態を更新する。 */
function pointerMove(event: PointerEvent) {
  if (!brushEditing.value)
    return
  const point = pointFromEvent(event)
  brushCursor.value = point
  const stroke = workingStroke.value
  if (stroke) {
    const previous = stroke.points.at(-1)!
    if (Math.hypot(point.x - previous.x, point.y - previous.y) >= 0.5) {
      workingStroke.value = {
        ...stroke,
        points: [...stroke.points, point],
      }
      redraw()
    }
  }
}

/** 一回のブラシ操作を一つのストロークとして確定し、Undoで一筆ずつ戻せるようにする。 */
function commitWorkingStroke() {
  const stroke = workingStroke.value
  workingStroke.value = null
  if (stroke?.points.length) {
    emit('update', {
      manualMaskStrokes: [...props.draft.manualMaskStrokes, stroke],
    })
  }
}

/** 範囲外へ出ても描画中の操作は継続し、未操作時だけブラシカーソルを隠す。 */
function pointerLeave() {
  if (workingStroke.value)
    return
  brushCursor.value = null
  redraw()
}

/** ブラシ編集の有効・無効を切り替え、他の操作モードを整理する。 */
function toggleBrushEditing() {
  brushEditing.value = !brushEditing.value
  colorSampling.value = false
  workingStroke.value = null
  brushCursor.value = null
  redraw()
}

/** 背景色の採取モードを切り替える。 */
function toggleColorSampling() {
  colorSampling.value = !colorSampling.value
  brushEditing.value = false
  workingStroke.value = null
  brushCursor.value = null
  redraw()
}

/** 指定位置の元画像から背景色を採取して下書きへ反映する。 */
function sampleBackgroundColor(point: MaskPoint) {
  const source = document.createElement('canvas')
  source.width = Math.max(1, Math.round(props.draft.sourceRect.width))
  source.height = Math.max(1, Math.round(props.draft.sourceRect.height))
  const context = source.getContext('2d', { willReadFrequently: true })
  if (!context)
    return
  context.drawImage(
    props.image,
    props.draft.sourceRect.x,
    props.draft.sourceRect.y,
    props.draft.sourceRect.width,
    props.draft.sourceRect.height,
    0,
    0,
    source.width,
    source.height,
  )
  const x = Math.min(source.width - 1, Math.max(0, Math.floor(point.x)))
  const y = Math.min(source.height - 1, Math.max(0, Math.floor(point.y)))
  const pixel = context.getImageData(x, y, 1, 1).data
  const color = `#${[pixel[0], pixel[1], pixel[2]]
    .map(value => value!.toString(16).padStart(2, '0'))
    .join('')}`
  emit('update', { backgroundColor: color })
  colorSampling.value = false
}

/** 入力した背景色をアセット作成の下書きへ反映する。 */
function updateBackgroundColor(event: Event) {
  emit('update', {
    backgroundColor: (event.target as HTMLInputElement).value,
  })
}

/** 背景色の手動指定を解除して自動推定へ戻す。 */
function useAutomaticBackgroundColor() {
  emit('update', { backgroundColor: null })
  colorSampling.value = false
}

/** 最後に確定したブラシの一筆を取り消す。 */
function undoStroke() {
  emit('update', {
    manualMaskStrokes: props.draft.manualMaskStrokes.slice(0, -1),
  })
}

/** 確定したブラシ軌跡をすべて取り除く。 */
function clearStrokes() {
  emit('update', { manualMaskStrokes: [] })
}

/** 名前の入力内容を親へ通知する。 */
function updateName(event: Event) {
  emit('update', { name: (event.target as HTMLInputElement).value })
}

/** チェック状態を設定値へ変換して親へ通知する。 */
function updateBoolean(event: Event) {
  emit('update', {
    removeBackground: (event.target as HTMLInputElement).checked,
  })
}

/** 数値入力を変換し、設定変更を親へ通知する。 */
function updateNumber(
  field: 'backgroundThreshold' | 'edgeFeather',
  event: Event,
) {
  emit('update', {
    [field]: Number((event.target as HTMLInputElement).value),
  })
}
</script>

<template>
  <section class="asset-creation-panel">
    <h3>{{ draft.editingAssetId ? 'アイコンを切り出し直す' : '新しいアイコン' }}</h3>
    <div class="asset-preview-tools">
      <label>表示倍率
        <select v-model="previewZoom" aria-label="プレビューの拡大率" :disabled="Boolean(workingStroke) || running">
          <option value="fit">全体表示（{{ Math.round(fitScale * 100) }}%）</option>
          <option v-for="level in zoomLevels" :key="level" :value="level">{{ level }}%{{ level === 100 ? '（等倍）' : '' }}</option>
        </select>
      </label>
      <button type="button" aria-label="プレビューを縮小" :disabled="previewScale <= 0.25 || Boolean(workingStroke) || running" @click="stepZoom(-1)">
        −
      </button>
      <button type="button" aria-label="プレビューを拡大" :disabled="previewScale >= 16 || Boolean(workingStroke) || running" @click="stepZoom(1)">
        ＋
      </button>
      <small>保存サイズ {{ cropSize.width }} × {{ cropSize.height }} px（表示倍率では変わりません）</small>
    </div>
    <div v-if="draft.removeBackground" class="asset-mask-controls">
      <button
        type="button"
        :class="{ primary: brushEditing }"
        @click="toggleBrushEditing"
      >
        {{ brushEditing ? 'ブラシ補正を終了' : 'ブラシで補正' }}
      </button>
      <template v-if="brushEditing">
        <div class="asset-mask-mode" role="group" aria-label="ブラシの処理">
          <button
            type="button"
            :class="{ selected: brushMode === 'paint' }"
            @click="brushMode = 'paint'"
          >
            透明にする
          </button>
          <button
            type="button"
            :class="{ selected: brushMode === 'erase' }"
            @click="brushMode = 'erase'"
          >
            元に戻す
          </button>
        </div>
        <div class="asset-brush-size">
          <label>
            ブラシサイズ（直径 {{ brushSize }}px）
            <input v-model.number="brushSize" type="range" aria-label="ブラシサイズ" min="1" :max="maximumBrushSize" step="1" :disabled="Boolean(workingStroke)">
          </label>
          <input type="number" aria-label="ブラシサイズ（元画像px）" :value="brushSize" min="1" :max="maximumBrushSize" step="1" :disabled="Boolean(workingStroke)" @change="updateBrushSize">
        </div>
        <div class="asset-mask-history-actions">
          <button
            type="button"
            :disabled="draft.manualMaskStrokes.length === 0"
            @click="undoStroke"
          >
            1画戻す
          </button>
          <button
            type="button"
            :disabled="draft.manualMaskStrokes.length === 0"
            @click="clearStrokes"
          >
            補正をクリア
          </button>
        </div>
      </template>
    </div>
    <div
      ref="previewViewport"
      class="asset-creation-preview"
      role="region"
      aria-label="アイコン画像の作業範囲"
      tabindex="0"
      :class="{
        'is-brush-editing': brushEditing,
        'is-color-sampling': colorSampling,
      }"
    >
      <div
        class="asset-preview-stage"
        :style="previewStageStyle"
        @pointerdown.prevent="pointerDown"
        @pointermove="pointerMove"
        @pointerup="commitWorkingStroke"
        @pointercancel="commitWorkingStroke"
        @pointerleave="pointerLeave"
      >
        <div class="asset-preview-image" :style="previewImageStyle">
          <canvas
            ref="preview"
            aria-label="背景透明化プレビュー"
          />
          <span v-if="brushEditing && brushCursor" class="asset-brush-cursor" :class="{ 'is-erase': brushMode === 'erase' }" :style="brushCursorStyle" aria-hidden="true" />
        </div>
      </div>
    </div>
    <label>
      アイコン名
      <input :value="draft.name" @input="updateName">
    </label>
    <small v-if="nameError" class="field-error" role="alert">
      {{ nameError }}
    </small>
    <label class="asset-checkbox">
      <input
        type="checkbox"
        :checked="draft.removeBackground"
        @change="updateBoolean"
      >
      背景を透明化
    </label>
    <label v-if="draft.removeBackground">
      背景の許容色差（{{ draft.backgroundThreshold }}）
      <input
        type="range"
        min="0"
        max="160"
        step="1"
        :value="draft.backgroundThreshold"
        @input="updateNumber('backgroundThreshold', $event)"
      >
    </label>
    <fieldset v-if="draft.removeBackground" class="asset-background-color">
      <legend>透明化する背景色</legend>
      <label class="asset-checkbox">
        <input
          type="radio"
          name="asset-background-color-mode"
          :checked="draft.backgroundColor === null"
          @change="useAutomaticBackgroundColor"
        >
        外周から自動判定
      </label>
      <label class="asset-checkbox">
        <input
          type="radio"
          name="asset-background-color-mode"
          :checked="draft.backgroundColor !== null"
          @change="$emit('update', { backgroundColor: '#ffffff' })"
        >
        色を指定
      </label>
      <div
        v-if="draft.backgroundColor !== null"
        class="asset-background-color-picker"
      >
        <input
          type="color"
          aria-label="透明化する背景色"
          :value="draft.backgroundColor"
          @input="updateBackgroundColor"
        >
        <code>{{ draft.backgroundColor }}</code>
        <button
          type="button"
          :class="{ primary: colorSampling }"
          @click="toggleColorSampling"
        >
          {{ colorSampling ? 'プレビュー上の色を選択中' : 'プレビューから選択' }}
        </button>
      </div>
    </fieldset>
    <label v-if="draft.removeBackground">
      境界のぼかし（{{ draft.edgeFeather }}）
      <input
        type="range"
        min="0"
        max="60"
        step="1"
        :value="draft.edgeFeather"
        @input="updateNumber('edgeFeather', $event)"
      >
    </label>
    <div class="asset-creation-actions">
      <button
        type="button"
        class="primary"
        :disabled="running || Boolean(nameError)"
        @click="$emit('confirm')"
      >
        {{ running ? '画像を作成中…' : draft.editingAssetId ? 'アイコンを更新' : 'アイコンを確定' }}
      </button>
      <button type="button" @click="$emit('cancel')">
        キャンセル
      </button>
    </div>
    <p class="muted">
      {{
        draft.editingAssetId
          ? '更新すると既存の透過PNGを置き換えます。表示倍率・上下位置・左右余白は維持されます。'
          : '確定すると透過済みPNGとして登録されます。透過設定は確定後には変更できません。'
      }}
    </p>
  </section>
</template>
