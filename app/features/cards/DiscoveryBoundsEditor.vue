<script setup lang="ts">
import type { RegionDraft } from '~/types/editor'
import { computed, ref, watch } from 'vue'
import { splitIconBounds } from '~/services/asset-discovery/split'

const props = defineProps<{ imageUrl: string, imageWidth: number, imageHeight: number, bounds?: RegionDraft, disabled: boolean }>()
const emit = defineEmits<{ commit: [bounds: RegionDraft], split: [axis: 'horizontal' | 'vertical', ratio: number] }>()
const svg = ref<SVGSVGElement | null>(null)
const start = ref<{ x: number, y: number } | null>(null)
const draft = ref<RegionDraft>({ x: 0, y: 0, width: 20, height: 20 })
const drawing = ref(false)
const splitting = ref(false)
const splitAxis = ref<'horizontal' | 'vertical'>('horizontal')
const splitPercent = ref(50)
const parts = computed(() => props.bounds && splitting.value ? splitIconBounds(props.bounds, splitAxis.value, splitPercent.value / 100) : [])
const closeup = computed(() => {
  const bounds = props.bounds
  if (!bounds)
    return `0 0 ${props.imageWidth} ${props.imageHeight}`
  const width = Math.min(props.imageWidth, Math.max(160, bounds.width * 4))
  const height = Math.min(props.imageHeight, Math.max(120, bounds.height * 4))
  return `${Math.max(0, Math.min(props.imageWidth - width, bounds.x + bounds.width / 2 - width / 2))} ${Math.max(0, Math.min(props.imageHeight - height, bounds.y + bounds.height / 2 - height / 2))} ${width} ${height}`
})
const valid = computed(() => Object.values(draft.value).every(Number.isFinite) && draft.value.x >= 0 && draft.value.y >= 0 && draft.value.width > 0 && draft.value.height > 0 && draft.value.x + draft.value.width <= props.imageWidth && draft.value.y + draft.value.height <= props.imageHeight)
watch(() => [props.bounds, props.imageUrl, props.imageWidth, props.imageHeight], () => {
  draft.value = props.bounds ? { ...props.bounds } : { x: 0, y: 0, width: Math.min(20, props.imageWidth), height: Math.min(20, props.imageHeight) }
  start.value = null
  drawing.value = false
  splitting.value = false
}, { immediate: true })
function point(event: PointerEvent) {
  const matrix = svg.value?.getScreenCTM()
  if (!matrix)
    return null
  const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse())
  return { x: Math.round(Math.max(0, Math.min(props.imageWidth, p.x))), y: Math.round(Math.max(0, Math.min(props.imageHeight, p.y))) }
}
function begin(event: PointerEvent) {
  if (!drawing.value || props.disabled || event.button !== 0)
    return
  start.value = point(event)
  svg.value?.setPointerCapture(event.pointerId)
  event.preventDefault()
}
function move(event: PointerEvent) {
  const next = point(event)
  if (!start.value || !next || props.disabled)
    return
  draft.value = { x: Math.min(start.value.x, next.x), y: Math.min(start.value.y, next.y), width: Math.abs(start.value.x - next.x), height: Math.abs(start.value.y - next.y) }
}
function end(event: PointerEvent) {
  if (!start.value)
    return
  move(event)
  start.value = null
}
</script>

<template>
  <section class="bounds-editor">
    <svg ref="svg" :viewBox="closeup" role="img" aria-label="アイコン候補と周辺の元画像" :class="{ drawing }" @pointerdown="begin" @pointermove="move" @pointerup="end" @pointercancel="start = null" @lostpointercapture="start = null">
      <image :href="imageUrl" :width="imageWidth" :height="imageHeight" />
      <rect v-if="!splitting" :x="draft.x" :y="draft.y" :width="Math.max(0, draft.width)" :height="Math.max(0, draft.height)" fill="#2563eb20" stroke="#2563eb" stroke-width="2" vector-effect="non-scaling-stroke" />
      <rect v-for="(part, index) in parts" :key="index" :x="part.x" :y="part.y" :width="part.width" :height="part.height" :fill="index ? '#f9731630' : '#2563eb30'" :stroke="index ? '#f97316' : '#2563eb'" stroke-width="2" vector-effect="non-scaling-stroke" />
    </svg>
    <fieldset v-if="splitting" :disabled="disabled">
      <legend>候補を2つに分割</legend>
      <label>分割方向<select v-model="splitAxis" aria-label="分割方向"><option value="horizontal">上下に分ける</option><option value="vertical">左右に分ける</option></select></label>
      <label>分割位置（{{ splitPercent }}%）<input v-model.number="splitPercent" type="range" min="5" max="95" step="1" aria-label="分割位置"></label>
      <p>保存済みの枠を青・オレンジの2候補に置き換えます。両方とも未確認・未分類・アセット未割当になります。登録済みアセットは削除しません。確定後に個別の範囲を調整できます。</p>
      <button type="button" @click="emit('split', splitAxis, splitPercent / 100)">
        2候補への分割を確定
      </button>
      <button type="button" @click="splitting = false">
        分割をキャンセル
      </button>
    </fieldset>
    <fieldset v-else :disabled="disabled">
      <legend>{{ bounds ? '候補の範囲を調整' : '手動で候補を追加' }}</legend>
      <button type="button" :aria-pressed="drawing" @click="drawing = !drawing">
        {{ drawing ? 'ドラッグで囲んでください' : '画像上で囲み直す' }}
      </button>
      <div class="coordinates">
        <label v-for="(label, key) in { x: 'X', y: 'Y', width: '幅', height: '高さ' }" :key="key">
          {{ label }}<input v-model.number="draft[key]" type="number" step="1" :aria-label="`候補の${label}`">
        </label>
      </div>
      <p v-if="!valid" role="alert">
        画像内の有効な範囲を指定してください。
      </p>
      <button type="button" :disabled="!valid" @click="emit('commit', { ...draft })">
        {{ bounds ? '範囲の変更を保存' : '手動候補を追加' }}
      </button>
      <button v-if="bounds" type="button" @click="splitting = true; drawing = false; start = null">
        複数のアイコンを2候補に分割
      </button>
    </fieldset>
  </section>
</template>

<style scoped>
svg { width: 100%; max-height: 340px; background: #e2e8f0; touch-action: none; }
.drawing { cursor: crosshair; }
fieldset { border: 0; padding: 8px 0; }
.coordinates { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 8px 0; }
input { width: 100%; min-width: 0; }
</style>
