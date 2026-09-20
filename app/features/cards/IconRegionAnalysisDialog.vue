<script setup lang="ts">
import type { DiscoveryWorkspaceOptions } from './useDiscoveryWorkspace'
import { computed, onMounted, ref, watch } from 'vue'
import { useIconRegionAnalysis } from './useIconRegionAnalysis'

const props = defineProps<{ options: DiscoveryWorkspaceOptions }>()
const emit = defineEmits<{ close: [], editRegions: [] }>()
const model = useIconRegionAnalysis(props.options)
const dialog = ref<HTMLDialogElement | null>(null)
const checked = ref<string[]>([])
const focused = ref('')
const busy = computed(() => model.running.value || props.options.busy.value || props.options.ocrRunning.value)
const cards = computed(() => props.options.store.document?.cards.filter(card => !props.options.pendingDeletionIds.value.has(card.id)) ?? [model.card.value])
const selected = computed(() => model.rows.value.find(row => row.region.id === focused.value))
watch(model.rows, (rows) => {
  checked.value = rows.filter(row => !row.error).map(row => row.region.id)
  focused.value = rows[0]?.region.id ?? ''
})
function close() {
  if (model.running.value)
    model.cancel()
  else emit('close')
}
onMounted(() => dialog.value?.showModal())
</script>

<template>
  <dialog ref="dialog" class="icon-analysis" aria-label="領域検出・アイコン反映" @cancel.prevent="close">
    <header>
      <h2>領域検出・アイコン反映</h2><button type="button" @click="close">
        閉じる
      </button>
    </header>
    <p>確認・分類したアイコンの位置を再利用します。既存の領域は作り直さず、領域も候補もないカードだけ新規検出します。元画像は変更しません。</p>
    <p>割当済み・除外していない候補を使い、OCR用のコピーだけを塗りつぶして [icon:アセット名] を原文へ挿入します。下のプレビューを確認して反映してください。</p>
    <label>対象カード<select :value="options.currentImageId.value" :disabled="busy" @change="options.selectCard(($event.target as HTMLSelectElement).value)"><option v-for="card in cards" :key="card.id" :value="card.id">{{ card.imageName }}</option></select></label>
    <button type="button" :disabled="busy" @click="model.analyze">
      領域とアイコンを解析
    </button>
    <button v-if="model.running.value" type="button" :disabled="model.cancelled.value" @click="model.cancel">
      解析を中止
    </button>
    <p>カード切替・閉じる操作、選択した案の反映後は、未反映の案を破棄します。反映済みの編集は保持します。カードごとに解析・確認してください。</p>
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
        <rect v-for="icon in selected.region.sourceIcons" :key="icon.id" :x="selected.region.x + icon.x" :y="selected.region.y + icon.y" :width="icon.width" :height="icon.height" fill="#f9731640" stroke="#f97316" stroke-width="2" vector-effect="non-scaling-stroke" />
      </svg>
    </div>
    <button type="button" :disabled="busy || !checked.length" @click="model.apply(checked)">
      選択した領域へ位置と原文を反映
    </button>
    <button type="button" :disabled="busy" @click="emit('editRegions')">
      通常の領域候補で枠を調整する
    </button>
    <p>反映後はプロジェクト保存 → まとめて翻訳 → 仕上がり確認・印刷へ進めます。同じアイコンの枠を指定し直す必要はありません。</p>
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
