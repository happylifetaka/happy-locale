<script setup lang="ts">
import type { RegionApplyIssue } from '~/services/asset-discovery/apply-issues'
import type { FolderProjectCard } from '~/types/editor'
import type { RegionCandidate } from '~/types/ocr'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import RegionSourcePreview from '~/components/RegionSourcePreview.vue'

const props = defineProps<{
  issues?: readonly RegionApplyIssue[]
  status?: string
  card: FolderProjectCard
  candidates: RegionCandidate[]
  selected: boolean
  disabled: boolean
  sourceFile: File | null
  loadImage: (card: FolderProjectCard) => Promise<Blob>
}>()
const emit = defineEmits<{ select: [id: string, selected: boolean], open: [regionId?: string], resolve: [issue: RegionApplyIssue, target: 'region' | 'discovery' | 'preview'] }>()
const element = ref<HTMLElement | null>(null)
const visible = ref(false)
const imageUrl = ref('')
const error = ref('')
let observer: IntersectionObserver | undefined
const previewHeight = (bounds: { width: number, height: number }) => Math.min(180, bounds.height, bounds.height * 700 / Math.max(1, bounds.width))
const previewStyle = (bounds: { width: number, height: number }) => ({ maxWidth: `${bounds.width}px`, minHeight: `${previewHeight(bounds) + 16}px` })

// カード単位で原画像を共有する。画面外では読み込まず、切替・破棄時にURLを解放する。
watch([visible, () => props.card.id, () => props.card.imagePath, () => props.sourceFile], async (_, __, onCleanup) => {
  let active = true
  let ownedUrl = ''
  imageUrl.value = ''
  error.value = ''
  onCleanup(() => {
    active = false
    if (ownedUrl)
      URL.revokeObjectURL(ownedUrl)
  })
  if (!visible.value)
    return
  try {
    const blob = await props.loadImage(props.card)
    if (!active)
      return
    ownedUrl = URL.createObjectURL(blob)
    imageUrl.value = ownedUrl
  }
  catch {
    if (active)
      error.value = '原画像を読み込めませんでした。カードを開いて画像を確認してください。'
  }
})
onMounted(() => {
  if (typeof IntersectionObserver === 'undefined') {
    visible.value = true
    return
  }
  observer = new IntersectionObserver((entries) => {
    visible.value = entries.some(entry => entry.isIntersecting)
  }, { rootMargin: '200px' })
  if (element.value)
    observer.observe(element.value)
})
onBeforeUnmount(() => observer?.disconnect())
</script>

<template>
  <article ref="element" class="candidate-card">
    <h4>{{ card.imageName }}</h4>
    <p v-if="!selected">
      閲覧中のカードは処理対象に含まれていません。左のチェックで対象に追加できます。
    </p>
    <p class="card-status">
      {{ status }} · 作成済み {{ card.regions.length }}件 · 未追加候補 {{ candidates.length }}件
    </p>
    <ul v-if="issues?.length" class="card-issues" aria-label="このカードの確認事項">
      <li v-for="(issue, index) in issues" :key="index">
        <span v-if="issue.regionId">{{ card.regions.some(region => region.id === issue.regionId) ? `作成済み ${card.regions.findIndex(region => region.id === issue.regionId) + 1}` : '削除・変更された領域' }} — </span>
        <strong>{{ issue.preview ? '更新を保留' : '処理上の問題' }}</strong>：{{ issue.message }}
        <button v-if="issue.preview" type="button" :disabled="disabled || !card.regions.some(region => region.id === issue.regionId)" @click="emit('resolve', issue, 'preview')">
          OCR結果と比較
        </button>
        <button v-if="issue.occurrenceId" type="button" :disabled="disabled" @click="emit('resolve', issue, 'discovery')">
          アイコン候補を調整
        </button>
        <button v-else-if="!issue.regionId" type="button" :disabled="disabled" @click="emit('open')">
          カードを開く
        </button>
      </li>
    </ul>
    <p v-if="!candidates.length && !card.regions.length">
      新しい領域候補は見つかりませんでした。カードを開いて手動で領域を追加するか、再検出してください。
    </p>
    <p v-if="error" role="status">
      {{ error }}
    </p>
    <section v-for="(region, index) in card.regions" :key="region.id" class="existing-region" :aria-label="`作成済み領域 ${index + 1}`">
      <div class="region-heading">
        <strong>作成済み {{ index + 1 }}</strong><button type="button" :disabled="disabled" @click="emit('open', region.id)">
          この領域を編集
        </button>
      </div>
      <div class="candidate-image" :style="previewStyle(region)">
        <RegionSourcePreview v-if="imageUrl" :src="imageUrl" :region="region" :image-width="card.imageWidth" :image-height="card.imageHeight" :preview-height="previewHeight(region)" />
        <span v-else class="preview-placeholder">{{ error ? '原画像を表示できません' : '原画像を読み込み中…' }}</span>
      </div>
      <p class="candidate-text">
        {{ region.originalText || '（原文は空欄）' }}
      </p>
    </section>
    <label v-for="candidate in candidates" :key="candidate.id" class="candidate-choice">
      <input type="checkbox" :checked="candidate.selected" :disabled="disabled || !selected" :aria-label="`${card.imageName}の候補を追加対象にする`" @change="emit('select', candidate.id, ($event.target as HTMLInputElement).checked)">
      <div class="candidate-image" :style="previewStyle(candidate)">
        <RegionSourcePreview v-if="imageUrl" :src="imageUrl" :region="candidate" :image-width="card.imageWidth" :image-height="card.imageHeight" :preview-height="previewHeight(candidate)" />
        <span v-else class="preview-placeholder">{{ error ? '原画像を表示できません' : '原画像を読み込み中…' }}</span>
      </div>
      <span class="candidate-text"><small>未追加候補</small><span>{{ candidate.text || '（原文は空欄）' }}</span></span>
    </label>
    <button v-if="candidates.length || !card.regions.length" type="button" :disabled="disabled" @click="emit('open')">
      {{ candidates.length ? 'カードで領域・候補を修正' : 'カードで領域を追加' }}
    </button>
  </article>
</template>

<style scoped>
.candidate-card { margin: 16px 0; padding: 16px; border: 1px solid #e2e8f0; border-radius: 8px; }
.candidate-card h4 { margin: 0 0 12px; overflow-wrap: anywhere; }
.candidate-choice { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: 8px 12px; padding: 8px 0; overflow-wrap: anywhere; }
.candidate-image { min-width: 0; }
.candidate-text { grid-column: 2; white-space: pre-wrap; line-height: 1.6; margin: 0; }
.candidate-text small { display: block; color: #64748b; }
.existing-region { border-top: 1px solid #e2e8f0; padding: 12px 0; overflow-wrap: anywhere; }
.region-heading { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; }
.card-status { color: #52647d; font-size: 13px; }
.card-issues { background: #fff7ed; padding: 12px 12px 12px 32px; overflow-wrap: anywhere; }
.card-issues li + li { margin-top: 8px; }
.preview-placeholder { display: flex; align-items: center; height: 64px; margin: 8px 0; color: #64748b; background: #eef1f5; font-size: 13px; }
</style>
