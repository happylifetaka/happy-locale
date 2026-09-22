<script setup lang="ts">
import type { AssetDiscoveryState } from '~/types/asset-discovery'
import type { FolderProjectCard, ImageAsset } from '~/types/editor'
import { computed, onMounted, ref, watch } from 'vue'
import { describeCardApplyPlan } from '~/services/asset-discovery/apply-plan'

const props = defineProps<{ cards: readonly FolderProjectCard[], initialIds: readonly string[], activeCardId: string, discovery?: AssetDiscoveryState, assets?: readonly ImageAsset[], thumbnails?: ReadonlyMap<string, string> }>()
const emit = defineEmits<{ close: [], apply: [ids: string[]], preview: [id: string], requestThumbnail: [id: string] }>()
const dialog = ref<HTMLDialogElement | null>(null)
const selected = ref([...props.initialIds])
const unprocessed = computed(() => props.cards.filter(card => !card.regions.length).map(card => card.id))
const selectedIds = computed(() => props.cards.filter(card => selected.value.includes(card.id)).map(card => card.id))
const plans = computed(() => props.cards.map(card => ({ card, plan: describeCardApplyPlan(card, props.discovery, props.assets) })))
const summary = computed(() => plans.value.filter(({ card }) => selectedIds.value.includes(card.id)).reduce((sum, { plan }) => ({ detect: sum.detect + Number(plan.detect), additions: sum.additions + plan.additions, existing: sum.existing + plan.existing, assigned: sum.assigned + plan.assigned }), { detect: 0, additions: 0, existing: 0, assigned: 0 }))
watch(() => props.cards, () => selected.value = selectedIds.value)
onMounted(() => {
  dialog.value?.showModal()
  props.cards.forEach(card => emit('requestThumbnail', card.id))
})
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
    <section class="apply-overview" aria-label="反映する内容">
      <h3>何を反映する？</h3>
      <p><strong>領域を追加</strong>：選択済みの候補を追加。領域も候補もないカードは新規検出します。</p>
      <p><strong>原文にアイコンタグを挿入</strong>：アセット検出で割り当てたアイコンを領域に対応付け、その原文を再OCRします。例：<code>Gain [icon:attack]</code></p>
      <p class="preserved">
        訳文・元画像は変更しません。既存領域は作り直さず、小さなはみ出しだけ枠を補正します。
      </p>
      <p class="preserved">
        編集済み／OCR履歴のない原文は保護し、その領域の原文・アイコン更新を保留します。
      </p>
    </section>
    <p class="plan-summary" aria-live="polite">
      選択中の予定：新規検出 {{ summary.detect }}枚 ／ 候補の追加 {{ summary.additions }}件 ／ 既存領域 {{ summary.existing }}件を使用<br>割当済みアイコン {{ summary.assigned }}個を照合（反映できる数は解析後に確定）
    </p>
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
      <label v-for="({ card, plan }, index) in plans" :key="card.id">
        <input v-model="selected" type="checkbox" :value="card.id">
        <img v-if="thumbnails?.get(card.id)" :src="thumbnails.get(card.id)" alt="" width="36" height="48">
        <span class="card-plan">
          <span>{{ index + 1 }}. {{ card.imageName }}</span>
          <small>{{ plan.operations.join(' ／ ') || '追加対象の領域候補なし' }}</small>
          <small>割当済みアイコン {{ plan.assigned }}個<span v-if="plan.names.length">：{{ plan.names.join('、') }}</span><span v-if="plan.unassigned"> ／ 未割当 {{ plan.unassigned }}個（反映対象外）</span></small>
        </span>
      </label>
    </fieldset>
    <details>
      <summary>反映前に1枚ずつ比較する</summary>
      <p>原文の置き換えを個別に確認したい場合に使います。既存領域と重なる候補・未選択カードは反映しません。</p>
      <p>以前反映したアイコンの除外・割当変更も、原文と一緒に更新します。</p>
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
.region-apply-dialog { width: min(860px, 92vw); max-height: 90vh; overflow: auto; padding: 20px; box-sizing: border-box; }
header, footer, .selection-actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
header { justify-content: space-between; }
header h2 { margin: 0; }
fieldset { margin: 12px 0; max-height: 30vh; overflow: auto; border: 1px solid #cbd5e1; }
label { display: flex; align-items: center; gap: 8px; padding: 8px 0; }
.card-plan { flex: 1; overflow-wrap: anywhere; min-width: 0; display: grid; gap: 4px; }
img { object-fit: contain; flex-shrink: 0; }
.apply-overview { background: #f1f5f9; border-radius: 6px; padding: 12px; margin-top: 16px; }
.apply-overview h3 { margin: 0 0 8px; font-size: 1rem; }
.apply-overview p { margin: 6px 0; font-size: .9rem; }
.preserved { color: #475569; }
.plan-summary { font-size: .9rem; line-height: 1.6; }
small { color: #64748b; }
footer { justify-content: flex-end; margin-top: 16px; }
details p { font-size: .9rem; }
</style>
