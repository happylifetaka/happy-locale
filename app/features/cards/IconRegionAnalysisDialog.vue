<script setup lang="ts">
import type { DiscoveryWorkspaceOptions } from './useDiscoveryWorkspace'
import type { IconRegionRow, RegionOCRMode } from '~/services/asset-discovery/analyze-regions'
import { computed, onMounted, ref, watch } from 'vue'
import { useIconRegionAnalysis } from './useIconRegionAnalysis'

const props = defineProps<{ options: DiscoveryWorkspaceOptions, initialRegionId?: string, mode?: RegionOCRMode }>()
const emit = defineEmits<{ close: [], editRegions: [] }>()
const model = useIconRegionAnalysis(props.options, props.mode)
const dialog = ref<HTMLDialogElement | null>(null)
const checked = ref<string[]>([])
const focused = ref('')
const busy = computed(() => model.running.value || props.options.busy.value || props.options.ocrRunning.value)
const cards = computed(() => props.options.store.document?.cards.filter(card => !props.options.pendingDeletionIds.value.has(card.id)) ?? [model.card.value])
const selected = computed(() => model.rows.value.find(row => row.region.id === focused.value))
function expansionLabel(row: IconRegionRow) {
  const before = row.boundsBefore
  if (!before)
    return ''
  const after = row.region
  const edges: [string, number][] = [['左', before.x - after.x], ['上', before.y - after.y], ['右', after.x + after.width - before.x - before.width], ['下', after.y + after.height - before.y - before.height]]
  return `アイコンに合わせて${edges.filter(([, value]) => value > 0).map(([edge, value]) => `${edge}へ${Number(value.toFixed(2))}px`).join('・')}拡張（元画像基準）`
}
watch(model.rows, (rows) => {
  checked.value = rows.filter(row => !row.error).map(row => row.region.id)
  focused.value = rows.find(row => row.region.id === props.initialRegionId)?.region.id ?? rows[0]?.region.id ?? ''
  if (props.initialRegionId)
    checked.value = rows.filter(row => !row.error && row.region.id === props.initialRegionId).map(row => row.region.id)
})
function close() {
  if (model.running.value)
    model.cancel()
  else emit('close')
}
onMounted(() => dialog.value?.showModal())
</script>

<template>
  <dialog ref="dialog" class="icon-analysis" :aria-label="mode === 'reocr' ? 'OCR結果の比較' : '領域検出・アイコン反映'" @cancel.prevent="close">
    <header>
      <h2>{{ mode === 'reocr' ? 'OCR結果の比較' : '領域検出・アイコン反映' }}</h2><button type="button" @click="close">
        閉じる
      </button>
    </header>
    <p>原文を再OCRします。手修正も置き換わるため、変更前後を比較して反映してください。訳文は保持します。</p>
    <details>
      <summary>反映の仕組み</summary>
      <p v-if="mode !== 'reocr'">
        領域も候補もないカードだけ新規検出します。OCR用コピーのアイコンを塗りつぶし、[icon:アイコン名] に置き換えます。元画像は変更しません。
      </p>
      <p>小さなはみ出しは他領域と重ならない範囲で拡張します。元の枠＝灰色の破線、反映後＝青、アイコン＝オレンジ。反映はUndoで戻せます。</p>
      <p>カード切替・閉じる・反映後に未反映案を破棄します。</p>
    </details>
    <label>対象カード<select :value="options.currentImageId.value" :disabled="busy" @change="options.selectCard(($event.target as HTMLSelectElement).value)"><option v-for="card in cards" :key="card.id" :value="card.id">{{ card.imageName }}</option></select></label>
    <button type="button" :disabled="busy" @click="model.analyze">
      {{ mode === 'reocr' ? '変更後の原文を読み取る' : '領域とアイコンを解析' }}
    </button>
    <button v-if="model.running.value" type="button" :disabled="model.cancelled.value" @click="model.cancel">
      解析を中止
    </button>
    <p role="status">
      {{ model.status.value }}
    </p>
    <p v-if="model.error.value" role="alert">
      {{ model.error.value }}
    </p>
    <ul v-if="model.warnings.value.length">
      <li v-for="(warning, index) in model.warnings.value" :key="index">
        {{ warning }}
      </li>
    </ul>
    <div v-if="model.rows.value.length" class="review">
      <section>
        <div v-for="row in model.rows.value" :key="row.region.id" class="row">
          <label><input v-model="checked" type="checkbox" :value="row.region.id" :disabled="busy || Boolean(row.error)">{{ row.before ? '原文を更新' : '新規領域を追加' }}：{{ row.region.displayName }}（アイコン{{ row.iconCount }}個）</label>
          <button type="button" @click="focused = row.region.id">
            この領域を表示
          </button>
          <p v-if="row.error" role="alert">
            {{ row.error }}
          </p>
          <template v-else>
            <p v-if="row.boundsBefore" class="bounds-adjustment">
              {{ expansionLabel(row) }}
            </p>
            <p v-if="row.before">
              変更前：{{ row.before.originalText }}
            </p>
            <p class="proposed-text">
              変更後：{{ row.region.originalText }}
            </p>
            <small v-if="row.before?.translatedText">訳文は保持します。原文が変わる確認済みの訳は下書きに戻します。</small>
          </template>
        </div>
      </section>
      <svg v-if="selected" :viewBox="`${Math.max(0, selected.region.x - 15)} ${Math.max(0, selected.region.y - 15)} ${selected.region.width + 30} ${selected.region.height + 30}`" role="img" aria-label="領域と引き継ぐアイコンの位置">
        <image :href="options.runtime.cardImage.value?.src" :width="model.card.value.imageWidth" :height="model.card.value.imageHeight" />
        <rect :x="selected.region.x" :y="selected.region.y" :width="selected.region.width" :height="selected.region.height" fill="none" stroke="#2563eb" stroke-width="2" vector-effect="non-scaling-stroke" />
        <rect v-if="selected.boundsBefore" :x="selected.boundsBefore.x" :y="selected.boundsBefore.y" :width="selected.boundsBefore.width" :height="selected.boundsBefore.height" fill="none" stroke="#64748b" stroke-dasharray="5 4" stroke-width="1" vector-effect="non-scaling-stroke" />
        <rect v-for="icon in selected.region.sourceIcons" :key="icon.id" :x="selected.region.x + icon.x" :y="selected.region.y + icon.y" :width="icon.width" :height="icon.height" fill="#f9731640" stroke="#f97316" stroke-width="2" vector-effect="non-scaling-stroke" />
      </svg>
    </div>
    <button type="button" :disabled="busy || !checked.length" @click="model.apply(checked)">
      選択した領域へ位置と原文を反映
    </button>
    <button type="button" :disabled="busy" @click="emit('editRegions')">
      カードで領域枠を調整
    </button>
  </dialog>
</template>

<style scoped>
.icon-analysis { width: min(1200px, 94vw); max-height: 92vh; overflow: auto; padding: 20px; }
header { display: flex; justify-content: space-between; align-items: center; }
.review { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
.review > section { max-height: 55vh; overflow: auto; }
.row { border: 1px solid #cbd5e1; padding: 10px; margin: 8px 0; }
p { white-space: pre-wrap; }
[role="alert"] { color: #b91c1c; }
svg { width: 100%; max-height: 55vh; background: #e2e8f0; }
button, select { margin: 5px; }
@media (max-width: 800px) { .review { grid-template-columns: 1fr; } }
</style>
