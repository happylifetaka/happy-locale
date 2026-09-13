<script setup lang="ts">
import type { TextRegion } from '~/types/editor'
import type { SplitAxis } from '~/utils/split-region'
import { splitTextRegion } from '~/utils/split-region'

const props = defineProps<{ region: TextRegion, imageUrl: string, imageWidth: number, imageHeight: number }>()
const emit = defineEmits<{ close: [], apply: [axis: SplitAxis, position: number, texts: [{ originalText: string, translatedText: string }, { originalText: string, translatedText: string }]] }>()
/** 開閉や初期フォーカスを制御するダイアログ要素。 */
const dialog = ref<HTMLDialogElement | null>(null)
const titleId = useId()
/** 領域を上下・左右のどちらに分割するか。 */
const axis = ref<SplitAxis>('horizontal')
/** 分割位置を領域の辺長に対する百分率で指定する値。 */
const percent = ref(50)
/** 二つの分割先へ割り当てる原文と訳文の下書き。 */
const texts = ref<[{ originalText: string, translatedText: string }, { originalText: string, translatedText: string }]>([
  { originalText: props.region.originalText, translatedText: props.region.translatedText },
  { originalText: '', translatedText: '' },
])
/** 分割率から求めた領域内の画素位置。 */
const position = computed(() => Math.round((axis.value === 'horizontal' ? props.region.height : props.region.width) * percent.value / 100))
/** 分割結果は確認用に計算し、確定するまでは元の領域と本文を変更しない。 */
const preview = computed(() => {
  try {
    return { parts: splitTextRegion(props.region, axis.value, position.value, texts.value), error: '' }
  }
  catch (error) {
    return { parts: [], error: error instanceof Error ? error.message : '分割位置を確認してください。' }
  }
})
/** 分割位置と下書きから計算した二つのプレビュー領域。 */
const parts = computed(() => preview.value.parts)
// マウント後に領域分割の確認モーダルを開く。
onMounted(() => dialog.value?.showModal())
</script>

<template>
  <dialog ref="dialog" class="region-split-dialog" :aria-labelledby="titleId" @cancel.prevent="emit('close')">
    <h2 :id="titleId">
      領域を2つに分割
    </h2>
    <p>原文と訳文は最初の領域に保持しています。必要に応じて2つ目へ移し、内容と位置を確認してください。</p>
    <div class="split-controls">
      <label>分割方向<select v-model="axis"><option value="horizontal">上下に分割</option><option value="vertical">左右に分割</option></select></label>
      <label>分割位置 (%)<input v-model.number="percent" type="number" min="1" max="99" step="1"></label>
    </div>
    <div class="split-columns">
      <svg :viewBox="`0 0 ${imageWidth} ${imageHeight}`" role="img" aria-label="分割位置の確認。青は1、緑は2">
        <image :href="imageUrl" :width="imageWidth" :height="imageHeight" />
        <g v-for="(part, index) in parts" :key="index">
          <rect :x="part.x" :y="part.y" :width="part.width" :height="part.height" :fill="index === 0 ? '#2563eb22' : '#16a34a22'" :stroke="index === 0 ? '#2563eb' : '#16a34a'" stroke-width="2" vector-effect="non-scaling-stroke" />
          <rect v-for="area in part.exclusionAreas" :key="area.id" :x="part.x + area.x" :y="part.y + area.y" :width="area.width" :height="area.height" fill="#ef444444" />
        </g>
      </svg>
      <div>
        <fieldset v-for="(text, index) in texts" :key="index">
          <legend>領域 {{ index + 1 }}</legend>
          <label>領域{{ index + 1 }}の原文<textarea v-model="text.originalText" rows="3" /></label>
          <label>領域{{ index + 1 }}の訳文<textarea v-model="text.translatedText" rows="3" /></label>
        </fieldset>
      </div>
    </div>
    <p>分割後は保護領域と文字の装飾を確認してください。2つ目には新しいCSV用IDが付き、翻訳ステータスは再確認が必要な状態になります。</p>
    <p v-if="!parts.length" role="alert">
      {{ preview.error }}
    </p>
    <div class="confirmation-actions">
      <button type="button" autofocus @click="emit('close')">
        キャンセル
      </button>
      <button type="button" class="primary" :disabled="!parts.length" @click="emit('apply', axis, position, texts)">
        2つの領域に分割する
      </button>
    </div>
  </dialog>
</template>

<style scoped>
.region-split-dialog { width: min(950px, calc(100vw - 2rem)); max-height: calc(100dvh - 2rem); overflow: auto; border: 1px solid #cbd5e1; border-radius: 0.75rem; padding: 1rem; color: #1e293b; font: 0.9rem/1.5 system-ui, sans-serif; }
.region-split-dialog::backdrop { background: #0f172a80; }
.region-split-dialog h2 { font-size: 1.2rem; margin: 0 0 0.75rem; }
.split-columns { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 1rem; margin-top: 1rem; }
.split-columns svg { width: 100%; max-height: 60vh; }
.split-columns label { display: grid; }
.split-columns textarea { width: 100%; box-sizing: border-box; resize: vertical; }
.split-controls { display: flex; flex-wrap: wrap; gap: 1rem; }
.split-controls input { width: 5rem; }
.region-split-dialog input, .region-split-dialog select, .region-split-dialog textarea { font: inherit; padding: 0.35rem; border: 1px solid #cbd5e1; border-radius: 0.35rem; }
@media (max-width: 600px) { .split-columns { grid-template-columns: 1fr; } }
</style>
