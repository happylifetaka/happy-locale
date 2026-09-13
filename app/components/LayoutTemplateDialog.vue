<script setup lang="ts">
import type { CardProject, LayoutTemplate, TextRegion } from '~/types/editor'
import { createLayoutTemplate, fitsImage, placeLayoutTemplate } from '~/utils/layout-template'

const props = defineProps<{
  mode: 'capture' | 'apply'
  project: CardProject
  imageUrl: string
  templates: LayoutTemplate[]
}>()
const emit = defineEmits<{
  close: []
  save: [template: LayoutTemplate]
  apply: [regions: TextRegion[]]
}>()
/** 開閉や初期フォーカスを制御するダイアログ要素。 */
const dialog = ref<HTMLDialogElement | null>(null)
const titleId = useId()
/** 作成する配置雛形の名前。 */
const name = ref('')
/** 選択している配置雛形のID。 */
const templateId = ref(props.templates[0]?.id ?? '')
/** 保存または適用する領域の選択ID一覧。 */
const selectedIds = ref<string[]>(props.mode === 'capture' ? props.project.regions.map(region => region.id) : props.templates[0]?.regions.map(region => region.id) ?? [])
/** 雛形を配置する横方向の補正量。画素単位。 */
const offsetX = ref(0)
/** 雛形を配置する縦方向の補正量。画素単位。 */
const offsetY = ref(0)
/** 画像サイズ比に追加して適用する雛形の倍率。 */
const scale = ref(1)
/** 入力または確定処理で発生したエラー表示。 */
const error = ref('')
/** 選択IDに対応する配置雛形。 */
const template = computed(() => props.templates.find(item => item.id === templateId.value))
/** 保存または適用の候補となる領域一覧。 */
const candidates = computed(() => props.mode === 'capture'
  ? props.project.regions
  : template.value ? placeLayoutTemplate(template.value, props.project.imageWidth, props.project.imageHeight, offsetX.value, offsetY.value, scale.value) : [])
/** チェックされた、保存または適用対象の領域。 */
const selected = computed(() => candidates.value.filter(region => selectedIds.value.includes(region.id)))
/** 選択した配置候補に画像からはみ出す領域があるか。 */
const outOfBounds = computed(() => selected.value.some(region => !fitsImage(region, props.project.imageWidth, props.project.imageHeight)))
/** 適用する雛形が既存の領域と重なるか。 */
const overlaps = computed(() => props.mode === 'apply' && selected.value.some(region => props.project.regions.some(existing =>
  region.x < existing.x + existing.width && region.x + region.width > existing.x
  && region.y < existing.y + existing.height && region.y + region.height > existing.y)))
// 別の雛形を選んだら、その領域を適用候補として選択する。
watch(templateId, () => {
  selectedIds.value = template.value?.regions.map(region => region.id) ?? []
})
// マウント後にネイティブのモーダルとして開く。
onMounted(() => dialog.value?.showModal())

/** 保存・適用のモードに応じた値を親へ渡し、カードへの反映と履歴管理は親側に任せる。 */
function confirm() {
  if (!selected.value.length || outOfBounds.value)
    return
  if (props.mode === 'apply') {
    emit('apply', selected.value)
    return
  }
  if (props.templates.some(item => item.name === name.value.trim())) {
    error.value = '同じ名前の雛形があります。別の名前を指定してください。'
    return
  }
  try {
    emit('save', createLayoutTemplate(name.value, props.project, selectedIds.value))
  }
  catch (cause) {
    error.value = cause instanceof Error ? cause.message : '雛形を作成できませんでした。'
  }
}
</script>

<template>
  <dialog ref="dialog" class="layout-template-dialog" :aria-labelledby="titleId" @cancel.prevent="emit('close')">
    <h2 :id="titleId">
      {{ mode === 'capture' ? '領域から配置雛形を作成' : '配置雛形を重ねて確認' }}
    </h2>
    <p>領域の位置・文字の設定・背景処理・保護領域を再利用します。原文と訳文は複製しません。</p>
    <label v-if="mode === 'capture'">
      雛形の名前
      <input v-model="name" type="text" autofocus>
    </label>
    <template v-else>
      <label>
        使用する雛形
        <select v-model="templateId">
          <option v-for="item in templates" :key="item.id" :value="item.id">{{ item.name }}</option>
        </select>
      </label>
      <p>画像の縦横比に合わせて座標を変換します。位置や大きさを確認し、必要な領域だけ選んでください。</p>
      <div class="template-adjustments">
        <label>横移動 (px)<input v-model.number="offsetX" type="number" step="1"></label>
        <label>縦移動 (px)<input v-model.number="offsetY" type="number" step="1"></label>
        <label>倍率<input v-model.number="scale" type="number" min="0.01" step="0.01"></label>
      </div>
    </template>
    <div class="template-columns">
      <svg :viewBox="`0 0 ${project.imageWidth} ${project.imageHeight}`" role="img" aria-label="配置雛形の重ね合わせ。青枠は領域、赤枠は保護領域、橙枠は元画像のアイコン">
        <image :href="imageUrl" :width="project.imageWidth" :height="project.imageHeight" />
        <g v-for="region in selected" :key="region.id">
          <rect :x="region.x" :y="region.y" :width="region.width" :height="region.height" fill="#2563eb22" stroke="#2563eb" stroke-width="2" vector-effect="non-scaling-stroke" />
          <rect v-for="area in region.exclusionAreas" :key="area.id" :x="region.x + area.x" :y="region.y + area.y" :width="area.width" :height="area.height" fill="#ef444444" stroke="#dc2626" stroke-width="1" vector-effect="non-scaling-stroke" />
          <rect v-for="icon in region.sourceIcons" :key="icon.id" :x="region.x + icon.x" :y="region.y + icon.y" :width="icon.width" :height="icon.height" fill="#f59e0b44" stroke="#d97706" stroke-width="1" vector-effect="non-scaling-stroke" />
        </g>
      </svg>
      <fieldset>
        <legend>{{ mode === 'capture' ? '保存する領域' : '追加する領域' }}</legend>
        <label v-for="region in candidates" :key="region.id" class="template-region-option">
          <input v-model="selectedIds" type="checkbox" :value="region.id">
          {{ region.displayName || region.regionId }}（{{ region.role || '未分類' }}）
        </label>
        <p v-if="!candidates.length">
          使用できる領域がありません。
        </p>
      </fieldset>
    </div>
    <p v-if="outOfBounds" role="alert">
      画像からはみ出す領域があります。位置・倍率・選択を調整してください。
    </p>
    <p v-if="overlaps">
      既存の領域と重なります。既存領域は保持したまま、新しい領域を追加します。
    </p>
    <p v-if="error" role="alert">
      {{ error }}
    </p>
    <div class="confirmation-actions">
      <button type="button" @click="emit('close')">
        キャンセル
      </button>
      <button type="button" class="primary" :disabled="!selected.length || outOfBounds || (mode === 'capture' && !name.trim())" @click="confirm">
        {{ mode === 'capture' ? '雛形をプロジェクトに登録' : `${selected.length}領域を追加` }}
      </button>
    </div>
  </dialog>
</template>

<style scoped>
.layout-template-dialog {
  font: 0.9rem/1.5 system-ui, sans-serif;
  color: #1e293b;
  width: min(900px, calc(100vw - 2rem));
  max-height: calc(100dvh - 2rem);
  overflow: auto;
  border: 1px solid #cbd5e1;
  border-radius: 0.75rem;
  padding: 1rem;
}
.layout-template-dialog h2 { font-size: 1.2rem; margin: 0 0 0.75rem; }
.layout-template-dialog input:not([type='checkbox']),
.layout-template-dialog select {
  font: inherit;
  padding: 0.35rem;
  border: 1px solid #cbd5e1;
  border-radius: 0.35rem;
}
.layout-template-dialog::backdrop { background: #0f172a80; }
.template-columns { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 1rem; margin-top: 1rem; }
.template-columns svg { width: 100%; max-height: 55vh; }
.template-region-option { display: flex; gap: 0.5rem; margin-bottom: 0.5rem; }
.template-adjustments { display: flex; flex-wrap: wrap; gap: 0.5rem; }
.template-adjustments label { display: grid; }
.template-adjustments input { width: 7rem; }
@media (max-width: 600px) { .template-columns { grid-template-columns: 1fr; } }
</style>
