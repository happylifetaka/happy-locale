<script setup lang="ts">
import type { RegionOCRMode } from '~/services/asset-discovery/analyze-regions'
import type { AssetDiscoveryState } from '~/types/asset-discovery'
import type { FolderProjectCard, ImageAsset } from '~/types/editor'
import { computed, onMounted, ref, watch } from 'vue'
import { describeCardApplyPlan } from '~/services/asset-discovery/apply-plan'

const props = defineProps<{ embedded?: boolean, mode?: RegionOCRMode, cards: readonly FolderProjectCard[], initialIds: readonly string[], activeCardId: string, discovery?: AssetDiscoveryState, assets?: readonly ImageAsset[], thumbnails?: ReadonlyMap<string, string> }>()
const emit = defineEmits<{ close: [], apply: [ids: string[]], preview: [id: string], requestThumbnail: [id: string] }>()
const dialog = ref<HTMLDialogElement | null>(null)
const selected = ref([...props.initialIds])
const available = computed(() => props.cards.filter(card => props.mode === 'reocr' ? card.regions.length > 0 : true))
const title = computed(() => props.mode === 'reocr' ? 'まとめて再OCR' : props.mode === 'detect' ? '領域検出' : '翻訳する領域と原文を準備')
const unprocessed = computed(() => props.cards.filter(card => !card.regions.length).map(card => card.id))
const selectedIds = computed(() => available.value.filter(card => selected.value.includes(card.id)).map(card => card.id))
const plans = computed(() => props.cards.map(card => ({ card, plan: { ...describeCardApplyPlan(card, props.discovery, props.assets), ...(props.mode === 'reocr' ? { detect: false, additions: 0 } : {}) } })))
const summary = computed(() => plans.value.filter(({ card }) => selectedIds.value.includes(card.id)).reduce((sum, { plan }) => ({ detect: sum.detect + Number(plan.detect), additions: sum.additions + plan.additions, existing: sum.existing + plan.existing, assigned: sum.assigned + plan.assigned }), { detect: 0, additions: 0, existing: 0, assigned: 0 }))
watch(() => props.cards, () => selected.value = selectedIds.value)
onMounted(() => {
  if (!props.embedded)
    dialog.value?.showModal()
  props.cards.forEach(card => emit('requestThumbnail', card.id))
})
</script>

<template>
  <component :is="embedded ? 'section' : 'dialog'" ref="dialog" :class="{ embedded }" :role="embedded ? 'region' : undefined" class="region-apply-dialog" aria-labelledby="region-apply-title" @cancel.prevent="emit('close')">
    <header>
      <h2 id="region-apply-title">
        {{ title }}
      </h2>
      <button v-if="!embedded" type="button" @click="emit('close')">
        閉じる
      </button>
    </header>
    <section class="apply-overview" aria-label="これから行うこと">
      <p v-if="mode === 'reocr'">
        確定した領域の文章を読み直します。領域の検出や候補の追加は行いません。
      </p>
      <p v-else-if="mode === 'detect'">
        文字の領域を探し、原文を読み取ります。保存済みの候補があるカードは、選択済みの候補を追加します。既存領域の原文は読み直しません。
      </p>
      <p v-else>
        カードの文字を読み取り、翻訳する領域を作ります。すでに領域があるカードは、その領域を使います。
      </p>
      <p>「アイコン検出」で選んだアイコンも、原文の中に入れます。</p>
      <p class="preserved">
        手直しした原文は上書きしません。更新できなかった箇所は、実行後に確認できます。
      </p>
    </section>
    <p>準備するカードを選んでください。終わったら、読み取った原文を確認して翻訳に進めます。</p>
    <div class="selection-actions">
      <button v-if="mode !== 'reocr'" type="button" @click="selected = unprocessed">
        領域がないカード
      </button>
      <button type="button" :disabled="!available.some(card => card.id === activeCardId)" @click="selected = [activeCardId]">
        このカードのみ
      </button>
      <button type="button" @click="selected = available.map(card => card.id)">
        すべて選択
      </button>
      <button type="button" @click="selected = []">
        選択を解除
      </button>
    </div>
    <fieldset>
      <legend aria-live="polite">
        {{ cards.length }}枚中 {{ selectedIds.length }}枚を選択
      </legend>
      <label v-for="({ card, plan }, index) in plans" :key="card.id">
        <input v-model="selected" type="checkbox" :value="card.id" :disabled="!available.some(item => item.id === card.id)">
        <img v-if="thumbnails?.get(card.id)" :src="thumbnails.get(card.id)" alt="" width="36" height="48">
        <span class="card-plan">
          <strong>カード {{ index + 1 }}</strong>
          <small class="card-filename">{{ card.imageName }}</small>
          <small v-if="!available.some(item => item.id === card.id)">{{ mode === 'reocr' ? '領域がありません。先に領域を作成してください。' : '領域作成済みです。読み直す場合は「まとめて再OCR」を使ってください。' }}</small>
          <span v-if="plan.detect && mode !== 'reocr'">文字の領域を自動で探します</span>
          <span v-if="plan.existing">設定済みの領域：{{ plan.existing }}か所</span>
          <span v-if="plan.additions && mode !== 'reocr'">追加する領域：{{ plan.additions }}か所</span>
          <span v-if="!plan.detect && !plan.existing && !plan.additions">追加する領域が選ばれていません</span>
          <small v-if="plan.assigned">使うアイコン：{{ plan.names.join('、') }}（{{ plan.assigned }}個）</small>
          <small v-if="plan.unassigned">種類が未設定のアイコン {{ plan.unassigned }}個があります。アイコン検出で登録・関連付けしてください。</small>
        </span>
      </label>
    </fieldset>
    <details class="apply-details">
      <summary>詳しい動作</summary>
      <p>訳文・元画像は変更しません。作成済みの領域はそのまま使い、アイコンが少しはみ出している場合だけ枠を広げます。</p>
      <p v-if="mode !== 'reocr'">
        候補があるカードは、チェック済みの候補を領域として追加します。領域も候補もないカードは、画像から文字を探します。
      </p>
      <p>アイコンがある領域では、アイコンの位置に <code>[icon:名前]</code> を入れます。まだ見つかっていないアイコンを新たに探す操作ではありません。</p>
      <p>手直しした原文や、手直しの有無を判定できない以前の原文は残します。その領域のアイコンと枠も変更しません。</p>
      <p class="plan-summary">
        選択中の内訳：領域を探すカード {{ summary.detect }}枚、追加する領域 {{ summary.additions }}か所、設定済みの領域 {{ summary.existing }}か所、使うアイコン {{ summary.assigned }}個。実際に更新できた数は実行後に分かります。
      </p>
    </details>
    <details v-if="!mode" class="preview-details">
      <summary>変更前と変更後を比べたいとき</summary>
      <p>カードを1枚だけ選ぶと、原文がどう変わるか確認してから更新できます。手直しした原文を置き換えたい場合も、ここから進めます。</p>
      <p>作成済みの領域と重なる候補は追加しません。以前使ったアイコンの変更・除外も原文と一緒に更新します。</p>
      <button type="button" :disabled="selectedIds.length !== 1" @click="emit('preview', selectedIds[0]!)">
        選んだ1枚の変更内容を見る
      </button>
    </details>
    <footer>
      <button type="button" @click="emit('close')">
        キャンセル
      </button>
      <button type="button" class="primary" :disabled="!selectedIds.length" @click="emit('apply', selectedIds)">
        {{ mode === 'reocr' ? `${selectedIds.length}枚を再OCR` : mode === 'detect' ? `${selectedIds.length}枚の領域を検出` : `${selectedIds.length}枚の原文を準備` }}
      </button>
    </footer>
  </component>
</template>

<style scoped>
.region-apply-dialog { width: min(860px, 92vw); max-height: 90vh; overflow: auto; padding: 20px; box-sizing: border-box; }
.embedded { width: 100%; max-height: none; padding: 0; }
header, footer, .selection-actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
header { justify-content: space-between; }
header h2 { margin: 0; }
fieldset { margin: 12px 0; max-height: 30vh; overflow: auto; border: 1px solid #cbd5e1; }
label { display: flex; align-items: center; gap: 8px; padding: 8px 0; }
.card-plan { flex: 1; overflow-wrap: anywhere; min-width: 0; display: grid; gap: 4px; }
img { object-fit: contain; flex-shrink: 0; }
.apply-overview { background: #f1f5f9; border-radius: 6px; padding: 12px; margin-top: 16px; }
.apply-overview p { margin: 6px 0; line-height: 1.7; }
.preserved { color: #475569; }
.plan-summary { font-size: .9rem; line-height: 1.6; }
small { color: #475569; }
.card-filename { font-size: .75rem; }
footer { justify-content: flex-end; margin-top: 16px; }
details { margin-top: 12px; }
details p { font-size: .9rem; line-height: 1.6; }
</style>
