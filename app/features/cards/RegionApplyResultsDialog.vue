<script setup lang="ts">
import type { CardApplyIssues, RegionApplyIssue } from '~/services/asset-discovery/apply-issues'
import type { FolderProjectCard } from '~/types/editor'
import { computed, onMounted, ref } from 'vue'
import { applyIssueCounts, applyIssueDetails } from '~/services/asset-discovery/apply-issues'

const props = defineProps<{ issues: readonly CardApplyIssues[], cards: readonly FolderProjectCard[], thumbnails?: ReadonlyMap<string, string> }>()
const emit = defineEmits<{
  close: []
  resolve: [cardId: string, issue: RegionApplyIssue, target: 'region' | 'discovery' | 'preview']
  requestThumbnail: [id: string]
}>()
const dialog = ref<HTMLDialogElement | null>(null)
const filter = ref<'all' | 'protected' | 'problem'>('all')
const counts = computed(() => applyIssueCounts(props.issues))
const entries = computed(() => props.issues.flatMap((result) => {
  const card = props.cards.find(card => card.id === result.cardId)
  const details = applyIssueDetails(result).filter(issue => filter.value === 'all' || (filter.value === 'protected' ? issue.preview : !issue.preview))
  return details.length ? [{ result, card, number: props.cards.findIndex(card => card.id === result.cardId) + 1, details: details.map(issue => ({ issue, region: card?.regions.find(region => region.id === issue.regionId) })) }] : []
}))
onMounted(() => {
  dialog.value?.showModal()
  props.issues.forEach(result => emit('requestThumbnail', result.cardId))
})
</script>

<template>
  <dialog ref="dialog" class="region-apply-results" aria-labelledby="apply-results-title" @cancel.prevent="emit('close')">
    <header>
      <h2 id="apply-results-title">
        未反映の内容
      </h2>
      <button type="button" @click="emit('close')">
        閉じる
      </button>
    </header>
    <section v-if="counts.protectedCards" class="protected-summary" aria-label="原文保護による保留">
      <h3>原文保護で保留 {{ counts.protectedCards }}枚</h3>
      <p>原文を上書きしないよう、その領域の<strong>原文・アイコン・枠の更新を保留</strong>しました。検出失敗ではありません。</p>
      <p>アイコンタグを反映したい場合は「変更案を比較」へ。<strong>現在の内容を使うなら操作不要</strong>です。</p>
    </section>
    <section v-if="counts.problemCards" class="problem-summary" aria-label="検出や対応付けの問題">
      <h3>検出・対応付けの問題 {{ counts.problemCards }}枚</h3>
      <p>下の理由を確認し、該当するアイコン候補・領域を調整してから再反映してください。</p>
    </section>
    <div class="result-filter">
      <label for="apply-result-filter">表示</label>
      <select id="apply-result-filter" v-model="filter">
        <option value="all">
          すべて
        </option><option value="protected">
          原文保護で保留
        </option><option value="problem">
          検出・対応付けの問題
        </option>
      </select>
      <small>前回の実行結果です。修正後の状態は「このカードに反映」で再確認できます。</small>
    </div>
    <div class="results-list">
      <article v-for="entry in entries" :key="entry.result.cardId" class="card-result">
        <div class="card-heading">
          <img v-if="thumbnails?.get(entry.result.cardId)" :src="thumbnails.get(entry.result.cardId)" alt="" width="60" height="80">
          <div><strong>{{ entry.number ? `カード ${entry.number}` : 'カード' }}</strong><small>{{ entry.result.cardName }}</small></div>
        </div>
        <section v-for="({ issue, region }, index) in entry.details" :key="index" class="issue-row">
          <h4>{{ region?.displayName || (issue.regionId ? '対象の領域' : 'カード・アイコン') }} <span :class="issue.preview ? 'protected-label' : 'problem-label'">{{ issue.preview ? '更新を保留' : '未反映の理由' }}</span></h4>
          <p>{{ issue.message }}</p>
          <blockquote v-if="region">
            <small>現在の原文</small>{{ region.originalText.trim() ? region.originalText.slice(0, 240) + (region.originalText.length > 240 ? '…' : '') : '（空欄）' }}
          </blockquote>
          <div class="issue-actions">
            <button v-if="issue.preview" type="button" :disabled="!entry.card || !region" @click="emit('resolve', entry.result.cardId, issue, 'preview')">
              変更案を比較
            </button>
            <button v-if="issue.regionId" type="button" :disabled="!entry.card || !region" @click="emit('resolve', entry.result.cardId, issue, 'region')">
              {{ issue.preview ? '現在の領域を開く' : '領域を調整' }}
            </button>
            <button v-if="issue.occurrenceId" type="button" :disabled="!entry.card" @click="emit('resolve', entry.result.cardId, issue, 'discovery')">
              アイコン候補を調整
            </button>
            <button v-if="!issue.regionId && !issue.occurrenceId" type="button" :disabled="!entry.card" @click="emit('resolve', entry.result.cardId, issue, 'region')">
              カードを開く
            </button>
          </div>
          <small v-if="!entry.card || (issue.regionId && !region)">対象は削除・変更されています。必要なら再反映してください。</small>
        </section>
      </article>
      <p v-if="!entries.length">
        この分類の未反映項目はありません。
      </p>
    </div>
  </dialog>
</template>

<style scoped>
.region-apply-results { width: min(900px, 94vw); max-height: 90vh; padding: 20px; box-sizing: border-box; overflow: auto; }
header, .card-heading, .issue-actions, .result-filter { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
header { justify-content: space-between; }
h2 { margin: 0; }
h3, h4 { margin: 0 0 8px; font-size: 1rem; }
p { margin: 6px 0; line-height: 1.6; }
.protected-summary, .problem-summary { border-radius: 6px; padding: 12px; margin: 12px 0; }
.protected-summary { background: #eff6ff; }
.problem-summary { background: #fff7ed; }
.result-filter { margin: 16px 0; }
small { color: #475569; }
.results-list { display: grid; gap: 16px; }
.card-result { border: 1px solid #cbd5e1; border-radius: 6px; overflow: hidden; }
.card-heading { padding: 12px; background: #f8fafc; }
.card-heading div { min-width: 0; flex: 1; }
.card-heading small { display: block; overflow-wrap: anywhere; margin-top: 6px; }
img { object-fit: contain; }
.issue-row { padding: 16px; border-top: 1px solid #e2e8f0; overflow-wrap: anywhere; }
.protected-label, .problem-label { font-size: .8rem; border-radius: 4px; padding: 3px 6px; font-weight: normal; }
.protected-label { color: #1e40af; background: #eff6ff; }
.problem-label { color: #9a3412; background: #fff7ed; }
blockquote { margin: 12px 0; padding: 8px 12px; border-left: 3px solid #cbd5e1; white-space: pre-wrap; }
blockquote small { display: block; margin-bottom: 4px; }
</style>
