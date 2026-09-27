<script setup lang="ts">
import type { DiscoveryThumbnails } from './useDiscoveryThumbnails'
import type { IconProposalDifference, IconProposalReview } from '~/services/asset-discovery/proposal-review'
import type { IconCandidateGroup, IconOccurrence } from '~/types/asset-discovery'
import type { FolderProjectCard, ImageAsset, RegionDraft } from '~/types/editor'
import { computed, ref, watch } from 'vue'
import { containsBounds } from '~/services/asset-discovery/review'
import DiscoveryThumbnail from './DiscoveryThumbnail.vue'

const props = defineProps<{
  review: IconProposalReview
  occurrences: readonly IconOccurrence[]
  groups: readonly IconCandidateGroup[]
  assets: readonly ImageAsset[]
  card: Pick<FolderProjectCard, 'id' | 'imageName' | 'imageWidth' | 'imageHeight' | 'regions'>
  imageUrl?: string
  thumbnails: DiscoveryThumbnails
  active: boolean
  disabled: boolean
}>()
const selectedIds = defineModel<string[]>('selectedIds', { required: true })
const focused = ref<number | null>(null)
watch(() => props.review, () => focused.value = null)
const labels: Record<IconProposalDifference['status'], string> = {
  'new': '新規',
  'changed': '枠の変更',
  'unchanged': '変更なし',
  'missing': '今回未検出',
  'ambiguous': '対応要確認',
  'source-changed': '元画像が変更されています',
}
const rows = computed(() => {
  const current = new Map(props.occurrences.map(item => [item.id, item]))
  const proposed = new Map(props.review.occurrences.map(item => [item.id, item]))
  return props.review.differences.map(difference => ({
    ...difference,
    before: difference.occurrenceIds.flatMap(id => current.get(id) ?? []),
    after: proposed.get(difference.detectedId ?? ''),
  }))
})
function name(item: IconOccurrence) {
  const asset = props.assets.find(asset => asset.id === item.assetId)
  const index = props.groups.findIndex(group => group.memberIds.includes(item.id))
  const group = props.groups[index]
  return [asset?.name, group ? (group.name.trim() || `グループ${index + 1}`) : '未分類', item.decision === 'excluded' ? '除外中' : ''].filter(Boolean).join(' / ')
}
function location(item?: IconOccurrence) {
  if (!item || item.imageDigest !== props.review.imageDigest)
    return '位置を再確認してください'
  const regions = props.card.regions.filter(region => containsBounds(region, item.bounds))
  if (regions.length)
    return regions.map(region => region.displayName || region.regionId).join('・')
  const x = (item.bounds.x + item.bounds.width / 2) / props.card.imageWidth
  const y = (item.bounds.y + item.bounds.height / 2) / props.card.imageHeight
  return `カード${y < 1 / 3 ? '上部' : y > 2 / 3 ? '下部' : '中央'}・${x < 1 / 3 ? '左側' : x > 2 / 3 ? '右側' : '中央付近'}`
}
const round = (value: number) => Math.round(value * 10) / 10
function change(before: RegionDraft, after: RegionDraft) {
  const edges: [string, number][] = [
    ['左', before.x - after.x],
    ['上', before.y - after.y],
    ['右', after.x + after.width - before.x - before.width],
    ['下', after.y + after.height - before.y - before.height],
  ]
  return edges.filter(([, delta]) => delta !== 0).map(([edge, delta]) => `${edge}${delta > 0 ? 'へ' : '側を'}${round(Math.abs(delta))}px${delta > 0 ? '拡張' : '縮小'}`).join('・')
}
function frames(index: number) {
  const row = rows.value[index]!
  return [
    ...row.before.filter(item => item.imageDigest === props.review.imageDigest).map(item => ({ item, kind: 'before' })),
    ...(row.after ? [{ item: row.after, kind: 'after' }] : []),
  ]
}
function closeup(index: number) {
  const bounds = frames(index).map(frame => frame.item.bounds)
  if (!bounds.length)
    return `0 0 ${props.card.imageWidth} ${props.card.imageHeight}`
  const left = Math.min(...bounds.map(b => b.x))
  const top = Math.min(...bounds.map(b => b.y))
  const right = Math.max(...bounds.map(b => b.x + b.width))
  const bottom = Math.max(...bounds.map(b => b.y + b.height))
  const padding = Math.max(16, Math.max(right - left, bottom - top) * 0.5)
  const x = Math.max(0, left - padding)
  const y = Math.max(0, top - padding)
  return `${x} ${y} ${Math.min(props.card.imageWidth, right + padding) - x} ${Math.min(props.card.imageHeight, bottom + padding) - y}`
}
</script>

<template>
  <section class="proposal-comparison" aria-label="再収集候補の画像比較">
    <h4>{{ card.imageName }} — {{ rows.length }}件の比較</h4>
    <p>現在と提案の画像を見て、採用する「新規」「枠の変更」にチェックしてください。チェックしない候補・今回未検出の候補は、そのまま残ります。</p>
    <p>「位置と枠を確認」で周辺の文字とカード上の位置を確認できます。対応要確認・画像変更の候補は、この一覧では採用できません。</p>
    <article v-for="(row, index) in rows" :key="index" class="difference">
      <header>
        <label>
          <input v-model="selectedIds" type="checkbox" :value="row.detectedId" :disabled="disabled || !row.detectedId || !['new', 'changed'].includes(row.status)">
          {{ index + 1 }}. {{ labels[row.status] }} — {{ location(row.after ?? row.before[0]) }}
        </label>
        <small v-if="row.hasUserReview">分類・割当・枠調整などの編集あり</small>
      </header>
      <div class="snapshots">
        <div class="snapshot">
          <strong>現在</strong>
          <p v-if="!row.before.length">
            まだ登録されていません
          </p>
          <div v-for="item in row.before" :key="item.id" class="candidate-image">
            <DiscoveryThumbnail v-if="item.imageDigest === review.imageDigest" :item="item" :thumbnails="thumbnails" :active="active" />
            <span v-else>検出時の画像は表示できません</span>
            <span>{{ name(item) }}</span>
          </div>
        </div>
        <div class="snapshot">
          <strong>再収集の提案</strong>
          <div v-if="row.after" class="candidate-image">
            <DiscoveryThumbnail :item="row.after" :thumbnails="thumbnails" :active="active" />
            <span>{{ row.status === 'new' ? '新しい候補（採用後に分類・割当）' : '元画像から再検出した枠' }}</span>
          </div>
          <p v-else>
            今回の検出なし。現在の候補は保持します。
          </p>
        </div>
      </div>
      <p v-if="row.status === 'changed' && row.before.length === 1 && row.after" class="change-summary">
        {{ change(row.before[0]!.bounds, row.after.bounds) }}（元画像のpx）
      </p>
      <p v-if="row.status === 'unchanged'">
        変更不要。そのまま保持します。
      </p>
      <p v-if="row.status === 'ambiguous'">
        候補同士の対応が重なっています。位置と枠を見比べ、候補を個別に整理してください。
      </p>
      <button type="button" :aria-expanded="focused === index" :disabled="!imageUrl || !frames(index).length" @click="focused = focused === index ? null : index">
        {{ focused === index ? '位置と枠を閉じる' : '位置と枠を確認' }}
      </button>
      <div v-if="focused === index && imageUrl" class="position-preview">
        <p>現在＝青の破線 ／ 提案＝オレンジの実線。画像の確認だけでは枠は変更されません。</p>
        <div class="previews">
          <svg v-for="(viewBox, view) in [`0 0 ${card.imageWidth} ${card.imageHeight}`, closeup(index)]" :key="view" :viewBox="viewBox" role="img" :aria-label="view ? '候補周辺の拡大比較' : 'カード全体での候補位置'">
            <image :href="imageUrl" :width="card.imageWidth" :height="card.imageHeight" />
            <rect v-for="frame in frames(index)" :key="frame.kind + frame.item.id" :x="frame.item.bounds.x" :y="frame.item.bounds.y" :width="frame.item.bounds.width" :height="frame.item.bounds.height" fill="none" :stroke="frame.kind === 'before' ? '#2563eb' : '#c2410c'" :stroke-dasharray="frame.kind === 'before' ? '5 4' : undefined" :stroke-width="frame.kind === 'before' ? 3 : 2" vector-effect="non-scaling-stroke" />
          </svg>
        </div>
      </div>
      <details class="coordinate-details">
        <summary>座標の詳細（元画像のpx）</summary>
        <p v-for="item in row.before" :key="item.id">
          現在：X {{ round(item.bounds.x) }} / Y {{ round(item.bounds.y) }} / 幅 {{ round(item.bounds.width) }} / 高さ {{ round(item.bounds.height) }}
        </p>
        <p v-if="row.after">
          提案：X {{ round(row.after.bounds.x) }} / Y {{ round(row.after.bounds.y) }} / 幅 {{ round(row.after.bounds.width) }} / 高さ {{ round(row.after.bounds.height) }}
        </p>
      </details>
    </article>
  </section>
</template>

<style scoped>
.difference { border: 1px solid #cbd5e1; border-radius: 8px; padding: 12px; margin: 12px 0; }
header { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; }
header label { font-weight: 600; }
small, .coordinate-details { color: #475569; }
.snapshots { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin: 12px 0; }
.snapshot { background: #f8fafc; padding: 10px; border-radius: 6px; min-width: 0; }
.candidate-image { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: 8px; overflow-wrap: anywhere; }
.change-summary { font-weight: 600; }
.coordinate-details { margin-top: 10px; font-size: 0.85rem; }
.previews { display: grid; grid-template-columns: minmax(100px, 1fr) minmax(0, 2fr); gap: 12px; }
svg { width: 100%; height: 300px; background: #e2e8f0; }
button { padding: 8px 12px; border: 1px solid #cbd5e1; border-radius: 6px; background: white; }
button:disabled { opacity: 0.5; }
@media (max-width: 600px) { .previews { grid-template-columns: 1fr; } svg { height: 240px; } }
</style>
