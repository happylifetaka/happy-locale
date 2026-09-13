<script setup lang="ts">
import type { ImageDpi, RegionDraft } from '~/types/editor'
import type { PrintAreaNumericField } from '~/utils/print-area'
import { dpiFromPhysicalSize } from '~/utils/image-dpi'
import { updatePrintAreaNumericField } from '~/utils/print-area'

const props = defineProps<{
  area: RegionDraft | null
  dpi: ImageDpi | null
  imageWidth: number
  imageHeight: number
  canApplyToOthers: boolean
}>()

const emit = defineEmits<{
  updateArea: [area: RegionDraft]
  updateDpi: [dpi: ImageDpi]
  clearArea: []
  applyToOthers: []
}>()

/** 表示・入力用にまとめた縦横DPIの平均値。 */
const dpiValue = computed(() => props.dpi
  ? Math.round((props.dpi.x + props.dpi.y) / 2 * 100) / 100
  : null)
/** 印刷範囲の画素寸法とDPIから求めた実寸mm。 */
const physicalSize = computed(() => {
  if (!props.area || !props.dpi)
    return null
  return {
    width: props.area.width / props.dpi.x * 25.4,
    height: props.area.height / props.dpi.y * 25.4,
  }
})
/** 画像全体の画素寸法とDPIから求めた実寸mm。 */
const fullImagePhysicalSize = computed(() => props.dpi
  ? {
      width: props.imageWidth / props.dpi.x * 25.4,
      height: props.imageHeight / props.dpi.y * 25.4,
    }
  : null)

/** 入力値を縦横共通のDPIとして親へ通知する。 */
function updateDpi(event: Event) {
  const value = Number((event.target as HTMLInputElement).value)
  if (Number.isFinite(value) && value >= 10 && value <= 9600)
    emit('updateDpi', { x: value, y: value })
}

/** 画像全体を印刷対象の矩形に設定する。 */
function useWholeCard() {
  emit('updateArea', {
    x: 0,
    y: 0,
    width: props.imageWidth,
    height: props.imageHeight,
  })
}

/** 印刷範囲の数値入力を画像内に制限して通知する。 */
function updateAreaField(field: PrintAreaNumericField, event: Event) {
  if (!props.area)
    return
  const value = Number((event.target as HTMLInputElement).value)
  const area = updatePrintAreaNumericField(
    props.area,
    field,
    value,
    props.imageWidth,
    props.imageHeight,
  )
  if (area)
    emit('updateArea', area)
}

/** 実寸の幅から必要な横DPIを求める。 */
function setPhysicalWidth(event: Event) {
  const width = Number((event.target as HTMLInputElement).value)
  const currentHeight = fullImagePhysicalSize.value?.height
    ?? props.imageHeight / Math.max(10, props.dpi?.y ?? 300) * 25.4
  const dpi = dpiFromPhysicalSize(
    props.imageWidth,
    props.imageHeight,
    width,
    currentHeight,
  )
  if (dpi)
    emit('updateDpi', dpi)
}

/** 実寸の高さから必要な縦DPIを求める。 */
function setPhysicalHeight(event: Event) {
  const height = Number((event.target as HTMLInputElement).value)
  const currentWidth = fullImagePhysicalSize.value?.width
    ?? props.imageWidth / Math.max(10, props.dpi?.x ?? 300) * 25.4
  const dpi = dpiFromPhysicalSize(
    props.imageWidth,
    props.imageHeight,
    currentWidth,
    height,
  )
  if (dpi)
    emit('updateDpi', dpi)
}

/** 標準カードの実寸に合わせてDPIを設定する。 */
function useStandardCardSize() {
  const portrait = props.imageHeight >= props.imageWidth
  const dpi = dpiFromPhysicalSize(
    props.imageWidth,
    props.imageHeight,
    portrait ? 63.5 : 88,
    portrait ? 88 : 63.5,
  )
  if (dpi)
    emit('updateDpi', dpi)
}
</script>

<template>
  <section class="print-area-inspector">
    <h2>印刷範囲</h2>
    <p class="muted">
      中央の画像上で始点と終点を順にクリックするか、ドラッグして、和訳シールとして印刷する範囲を指定します。設定済みの枠は移動・リサイズできます。
    </p>
    <div class="print-area-actions">
      <button type="button" @click="useWholeCard">
        カード全体を指定
      </button>
      <button v-if="area" type="button" @click="$emit('clearArea')">
        範囲を解除
      </button>
    </div>
    <div v-if="area" class="print-area-summary">
      <fieldset class="print-area-pixel-fields">
        <legend>画像上の座標</legend>
        <label>
          <span>x</span>
          <input
            type="number"
            min="0"
            :max="Math.max(0, imageWidth - area.width)"
            step="1"
            :value="Math.round(area.x)"
            @change="updateAreaField('x', $event)"
          >
        </label>
        <label>
          <span>y</span>
          <input
            type="number"
            min="0"
            :max="Math.max(0, imageHeight - area.height)"
            step="1"
            :value="Math.round(area.y)"
            @change="updateAreaField('y', $event)"
          >
        </label>
      </fieldset>
      <fieldset class="print-area-pixel-fields">
        <legend>画像上の範囲</legend>
        <label>
          <span title="幅">w</span>
          <span class="print-area-input-with-unit">
            <input
              type="number"
              min="5"
              :max="Math.max(5, imageWidth - area.x)"
              step="1"
              :value="Math.round(area.width)"
              aria-label="幅"
              @change="updateAreaField('width', $event)"
            >
            <span>px</span>
          </span>
        </label>
        <label>
          <span title="高さ">h</span>
          <span class="print-area-input-with-unit">
            <input
              type="number"
              min="5"
              :max="Math.max(5, imageHeight - area.y)"
              step="1"
              :value="Math.round(area.height)"
              aria-label="高さ"
              @change="updateAreaField('height', $event)"
            >
            <span>px</span>
          </span>
        </label>
      </fieldset>
      <div v-if="physicalSize">
        <span>印刷時の実寸</span>
        <strong>{{ physicalSize.width.toFixed(1) }} × {{ physicalSize.height.toFixed(1) }} mm</strong>
      </div>
    </div>
    <label class="print-area-dpi">
      元画像のDPI
      <input
        type="number"
        min="10"
        max="9600"
        step="1"
        :value="dpiValue ?? ''"
        placeholder="例: 300"
        @change="updateDpi"
      >
    </label>
    <p v-if="dpi" class="muted">
      {{ dpi.x === dpi.y
        ? `${dpi.x.toFixed(0)} dpiとして実寸を計算します。`
        : `横${dpi.x.toFixed(1)}／縦${dpi.y.toFixed(1)} dpiです。` }}
    </p>
    <p v-else class="pdf-workflow-warning">
      元画像にDPI情報がありません。正しい実寸で印刷するためDPIを入力してください。
    </p>
    <fieldset class="print-area-physical-calibration">
      <legend>画像全体の実寸から補正</legend>
      <div class="print-area-physical-inputs">
        <label>
          横 (mm)
          <input
            type="number"
            min="1"
            max="1000"
            step="0.1"
            :value="fullImagePhysicalSize?.width.toFixed(1) ?? ''"
            @change="setPhysicalWidth"
          >
        </label>
        <span>×</span>
        <label>
          縦 (mm)
          <input
            type="number"
            min="1"
            max="1000"
            step="0.1"
            :value="fullImagePhysicalSize?.height.toFixed(1) ?? ''"
            @change="setPhysicalHeight"
          >
        </label>
      </div>
      <button type="button" @click="useStandardCardSize">
        スタンダードサイズ（88 × 63.5 mm）を使用
      </button>
      <small class="muted">
        DPIメタデータが実物と違う場合は、画像全体に対応するカードの実寸で補正できます。
      </small>
    </fieldset>
    <button
      type="button"
      :disabled="!area || !canApplyToOthers"
      @click="$emit('applyToOthers')"
    >
      範囲とDPIを未設定カードへ一括適用
    </button>
    <small class="muted">
      カード画像の寸法が異なる場合は、同じ比率の位置と大きさへ変換します。
    </small>
  </section>
</template>
