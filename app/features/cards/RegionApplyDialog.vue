<script setup lang="ts">
import type { FolderProjectCard } from '~/types/editor'
import { computed, onMounted, ref, watch } from 'vue'

const props = defineProps<{ cards: readonly FolderProjectCard[], initialIds: readonly string[], activeCardId: string }>()
const emit = defineEmits<{ close: [], apply: [ids: string[]], preview: [id: string] }>()
const dialog = ref<HTMLDialogElement | null>(null)
const selected = ref([...props.initialIds])
const unprocessed = computed(() => props.cards.filter(card => !card.regions.length).map(card => card.id))
const selectedIds = computed(() => props.cards.filter(card => selected.value.includes(card.id)).map(card => card.id))
watch(() => props.cards, () => selected.value = selectedIds.value)
onMounted(() => dialog.value?.showModal())
</script>

<template>
  <dialog ref="dialog" class="region-apply-dialog" aria-labelledby="region-apply-title" @cancel.prevent="emit('close')">
    <header>
      <h2 id="region-apply-title">
        領域・アイコンを反映
      </h2>
      <button type="button" @click="emit('close')">
        閉じる
      </button>
    </header>
    <p>対象カードを選択。反映後に各領域で修正できます。</p>
    <div class="selection-actions">
      <button type="button" @click="selected = unprocessed">
        領域未作成のみ
      </button>
      <button type="button" @click="selected = [activeCardId]">
        このカードのみ
      </button>
      <button type="button" @click="selected = cards.map(card => card.id)">
        すべて
      </button>
      <button type="button" @click="selected = []">
        解除
      </button>
    </div>
    <fieldset>
      <legend>対象カード（{{ selectedIds.length }}/{{ cards.length }}枚）</legend>
      <label v-for="card in cards" :key="card.id">
        <input v-model="selected" type="checkbox" :value="card.id">
        <span>{{ card.imageName }}</span>
        <small>{{ card.regions.length ? `既存領域 ${card.regions.length}件` : '領域未作成' }}</small>
      </label>
    </fieldset>
    <details>
      <summary>保持する編集・個別プレビュー</summary>
      <p>既存領域と訳文を保持します。手修正した原文やOCR履歴のない旧データは自動更新せず「要確認」に残します。原文を更新したい場合は個別プレビューで比較してください。</p>
      <p>領域・候補がないカードだけ新規検出します。収集・割当済みアイコンを反映し、小さなはみ出しだけ枠を補正します。未選択カードは変更しません。</p>
      <button type="button" :disabled="selectedIds.length !== 1" @click="emit('preview', selectedIds[0]!)">
        選択した1枚を個別プレビュー
      </button>
    </details>
    <footer>
      <button type="button" @click="emit('close')">
        キャンセル
      </button>
      <button type="button" class="primary" :disabled="!selectedIds.length" @click="emit('apply', selectedIds)">
        選択した{{ selectedIds.length }}枚に反映
      </button>
    </footer>
  </dialog>
</template>

<style scoped>
.region-apply-dialog { width: min(650px, 92vw); max-height: 90vh; overflow: auto; padding: 20px; }
header, footer, .selection-actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
header { justify-content: space-between; }
header h2 { margin: 0; }
fieldset { margin: 16px 0; max-height: 45vh; overflow: auto; border: 1px solid #cbd5e1; }
label { display: flex; align-items: center; gap: 8px; padding: 8px 0; }
label span { flex: 1; overflow-wrap: anywhere; min-width: 0; }
small { color: #64748b; }
footer { justify-content: flex-end; margin-top: 16px; }
details p { font-size: .9rem; }
</style>
