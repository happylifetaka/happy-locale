<script setup lang="ts">
import type { DiscoveryWorkspaceOptions } from './useDiscoveryWorkspace'
import type { useQuickRegionApply } from './useQuickRegionApply'
import type { useRegionApplyFlow } from './useRegionApplyFlow'
import type { FolderProjectCard } from '~/types/editor'
import { computed, nextTick, ref, watch } from 'vue'
import { applyIssueDetails } from '~/services/asset-discovery/apply-issues'
import { describeCardApplyPlan } from '~/services/asset-discovery/apply-plan'
import { intersectionArea } from '~/services/asset-discovery/geometry'
import { loadFolderProjectCardImage } from '~/services/project/folder'
import BatchWorkflowSteps from './BatchWorkflowSteps.vue'
import RegionOCRCandidateCard from './RegionOCRCandidateCard.vue'

const props = defineProps<{
  options: DiscoveryWorkspaceOptions
  flow: ReturnType<typeof useRegionApplyFlow>
  runner: ReturnType<typeof useQuickRegionApply>
  thumbnails: ReadonlyMap<string, string>
}>()
const emit = defineEmits<{ close: [], translate: [], requestThumbnail: [id: string] }>()
const targets = computed(() => props.runner.eligible.value.filter(card => props.flow.applyTargetIds.value?.includes(card.id)))
const records = computed(() => targets.value.map(card => ({
  card,
  state: props.runner.states.value.get(card.id),
  issues: props.runner.issues.value.find(item => item.cardId === card.id),
})))
const completed = computed(() => records.value.filter(item => item.state && ['applied', 'review', 'empty'].includes(item.state.status)).length)
const failed = computed(() => records.value.filter(item => item.state?.status === 'error').length)
const held = computed(() => records.value.filter(item => item.issues && applyIssueDetails(item.issues).some(issue => issue.preview)).length)
const problems = computed(() => records.value.filter(item => item.issues && applyIssueDetails(item.issues).some(issue => !issue.preview)).length)
const isDemo = computed(() => props.options.store.document?.demoPreset === 'sample-v1')
const root = ref<HTMLElement | null>(null)
let scrollPositions: { element: Element, top: number }[] = []
function rememberPosition() {
  scrollPositions = []
  for (let element = root.value?.parentElement; element; element = element.parentElement)
    scrollPositions.push({ element, top: element.scrollTop })
}
function openRegion(cardId: string, regionId?: string) {
  rememberPosition()
  void props.flow.resolveApplyIssue(cardId, { message: '', regionId }, 'region')
}
watch(() => props.flow.applyResultsOpen.value, async (open) => {
  if (!open)
    return
  await nextTick()
  scrollPositions.forEach(({ element, top }) => {
    element.scrollTop = top
  })
  scrollPositions = []
})
function cardStatus(id: string) {
  const status = props.runner.states.value.get(id)?.status
  return status === 'error' ? '処理失敗' : status && ['applied', 'review', 'empty'].includes(status) ? '処理完了' : '未処理'
}
const summary = computed(() => targets.value.reduce((sum, card) => {
  const plan = describeCardApplyPlan(card, props.options.store.assetDiscovery, props.options.store.assets)
  return { existing: sum.existing + card.regions.length, assigned: sum.assigned + plan.assigned }
}, { existing: 0, assigned: 0 }))
const candidateCards = computed(() => records.value.map(({ card, issues }) => ({ card, issues: issues ? applyIssueDetails(issues) : [], candidates: (card.ocrCandidates ?? []).filter(candidate => !card.regions.some(region => intersectionArea(region, candidate) > 0)) })))
const remainingCandidateCount = computed(() => candidateCards.value.reduce((sum, item) => sum + item.candidates.length, 0))
const canContinueToTranslation = computed(() => targets.value.some(card => card.regions.length > 0))
const selectedCount = computed(() => candidateCards.value.reduce((sum, item) => sum + item.candidates.filter(candidate => candidate.selected).length, 0))
const isDetection = computed(() => props.flow.operation.value === 'detect')
const availableTargets = computed(() => props.runner.eligible.value.filter(card => isDetection.value || card.regions.length))
const noUncreatedCards = computed(() => isDetection.value && availableTargets.value.length > 0 && availableTargets.value.every(card => card.regions.length))
const savedCandidateCount = computed(() => targets.value.reduce((sum, card) => sum + (card.ocrCandidates?.length ?? 0), 0))
const step = computed(() => props.runner.running.value ? 2 : props.flow.applyResultsOpen.value ? 3 : 1)
async function loadCandidateImage(card: FolderProjectCard): Promise<Blob> {
  const { runtime, currentImageId } = props.options
  if (card.id === currentImageId.value && runtime.cardSourceFile.value)
    return runtime.cardSourceFile.value
  if (!runtime.directory.value)
    throw new Error('カード画像が見つかりません。')
  return loadFolderProjectCardImage(runtime.directory.value, card)
}
function selectAll(selected: boolean) {
  for (const { card, candidates } of candidateCards.value)
    props.runner.selectCandidates(card.id, candidates.map(candidate => candidate.id), selected)
}
watch(targets, cards => cards.forEach(card => emit('requestThumbnail', card.id)), { immediate: true })
</script>

<template>
  <section ref="root" class="region-ocr-workspace" aria-label="領域検出・OCR">
    <header>
      <div>
        <h2>{{ flow.operation.value === 'detect' ? '領域検出' : '原文を読み直す' }}</h2>
        <p>{{ flow.operation.value === 'detect' ? '既存の領域を残して、追加する候補を探します。' : '作成済みの領域を使って原文を読み直します。手直しした原文と既存の訳文は保護します。' }}</p>
      </div>
      <button type="button" :disabled="runner.running.value" @click="emit('close')">
        カード編集に戻る
      </button>
    </header>
    <BatchWorkflowSteps :step="step" :labels="['対象選択', isDetection ? '検出' : '読み直し', isDetection ? '候補確認' : '結果確認']" />
    <details class="workflow-help">
      <summary>処理について</summary>
      <p v-if="isDetection">
        検出だけでは領域は追加されません。保存済み候補の調整内容と選択は保持し、重ならない新しい候補を追加します。選択した候補の追加はカードごとに元に戻せます。
      </p>
      <p v-else>
        作成済みの領域から原文を読み直します。編集済みの原文と既存の訳文は保護し、確認が必要な内容は結果に表示します。
      </p>
    </details>
    <nav v-if="!runner.running.value && (flow.applyResultsOpen.value || flow.resultsVisited.value || savedCandidateCount)" class="workflow-navigation" aria-label="OCRの操作">
      <button v-if="flow.applyResultsOpen.value" type="button" @click="flow.openApplyTargets(undefined, flow.operation.value)">
        対象選択に戻る
      </button>
      <button v-else-if="flow.resultsVisited.value || savedCandidateCount" type="button" @click="flow.openApplyResults">
        {{ savedCandidateCount ? `保存済みの候補を確認（${savedCandidateCount}件）` : 'OCR結果' }}
      </button>
    </nav>
    <div class="workflow-content">
      <section v-if="runner.running.value" class="ocr-progress" role="status" aria-label="OCRの進捗">
        <h3>{{ flow.operation.value === 'reocr' ? '原文を読み直しています' : '領域と原文を準備しています' }}</h3>
        <p>{{ runner.completed.value }} / {{ runner.total.value }}枚完了</p>
        <progress :value="runner.completed.value" :max="runner.total.value" />
        <p>{{ runner.status.value }}</p>
      </section>
      <section v-else-if="flow.applyResultsOpen.value" aria-label="OCR結果" class="ocr-results">
        <h3>原画像と原文の確認</h3>
        <p role="status">
          処理完了 {{ completed }}枚 ／ 失敗 {{ failed }}枚 ／ 原文保護で保留 {{ held }}枚<span v-if="problems"> ／ 処理上の問題 {{ problems }}枚</span>
        </p>
        <p v-if="runner.cancelled.value">
          処理終了（中止）。完了分は保持しています。
        </p>
        <p v-if="isDemo">
          デモは同梱の固定データを使っています。実OCRは実行していません。
        </p>
        <p>各カードの原画像と現在の原文を照合してください。処理完了や保留なしは、原文の正確さを保証しません。範囲・原文・アイコン・背景の調整は各領域の「この領域を編集」から行えます。</p>
        <p v-if="held">
          原文保護の保留は、編集済み原文などの上書きを防いだ結果です。現在の内容を使う場合は操作不要です。
        </p>
        <small>件数・確認事項は対象カードの最後の処理結果です。保留のあるカードも処理完了に含まれます。</small>
      </section>
      <section v-if="!runner.running.value && !flow.applyResultsOpen.value" aria-label="実行する内容">
        <div v-if="!targets.length" class="workflow-empty">
          <h3>{{ noUncreatedCards ? '領域未作成のカードはありません' : availableTargets.length ? '処理するカードを選んでください' : '読み直せる領域がありません' }}</h3>
          <p>{{ noUncreatedCards ? '追加検出するカードを左の一覧で選んでください。' : availableTargets.length ? '左のチェックで対象を選択できます。' : '先に領域を検出するか、カード編集で領域を作成してください。' }}</p>
          <button v-if="availableTargets.length" type="button" :disabled="options.busy.value" @click="flow.openApplyTargets(availableTargets.map(card => card.id), flow.operation.value)">
            全カードを選択
          </button>
        </div>
        <p v-else class="plan-summary">
          対象 {{ targets.length }}枚 · 設定済みの領域 {{ summary.existing }}か所 ／ 使うアイコン {{ summary.assigned }}個
        </p>
        <div v-for="card in targets" :key="card.id" class="batch-card-preview">
          <img v-if="thumbnails.get(card.id)" :src="thumbnails.get(card.id)" :alt="card.imageName" width="100">
          <div>
            <strong>{{ card.imageName }}</strong><p>領域 {{ card.regions.length }}件</p><p v-for="region in card.regions" :key="region.id">
              {{ region.originalText }}
            </p>
          </div>
        </div>
      </section>
      <section v-if="step === 3" aria-label="領域候補の確認">
        <h3>カードごとの原画像・原文</h3>
        <p v-if="!targets.length">
          確認するカードを左の一覧で選んでください。
        </p>
        <div v-if="isDetection && candidateCards.some(item => item.candidates.length)" class="candidate-actions">
          <button type="button" :disabled="options.busy.value" @click="selectAll(true)">
            表示中の候補をすべて選択
          </button>
          <button type="button" :disabled="options.busy.value" @click="selectAll(false)">
            候補の選択を解除
          </button>
        </div>
        <RegionOCRCandidateCard
          v-for="{ card, candidates, issues } in candidateCards"
          :key="card.id"
          :card="card"
          :candidates="isDetection ? candidates : []"
          :status="cardStatus(card.id)"
          :issues="issues"
          :selected="targets.some(target => target.id === card.id)"
          :disabled="options.busy.value"
          :source-file="card.id === options.currentImageId.value ? options.runtime.cardSourceFile.value : null"
          :load-image="loadCandidateImage"
          @select="(id, selected) => runner.selectCandidates(card.id, [id], selected)"
          @open="openRegion(card.id, $event)"
          @resolve="(issue, target) => { rememberPosition(); flow.resolveApplyIssue(card.id, issue, target) }"
        />
      </section>
    </div>
    <footer class="workflow-footer">
      <strong>{{ runner.running.value ? `${runner.completed.value} / ${runner.total.value}枚` : `対象 ${targets.length}枚` }}</strong>
      <button v-if="runner.running.value" type="button" :disabled="runner.cancelled.value" @click="runner.cancel">
        中止（完了分は保持）
      </button>
      <button v-else-if="step === 1" type="button" class="primary" :disabled="!targets.length || options.busy.value" @click="flow.applyTargetCards(targets.map(card => card.id))">
        {{ isDetection ? `${targets.length}枚の領域を検出` : `${targets.length}枚を再OCR` }}
      </button>
      <template v-else-if="isDetection">
        <span v-if="remainingCandidateCount" class="next-action">未追加 {{ remainingCandidateCount }}件・選択 {{ selectedCount }}件。{{ selectedCount ? '選択した候補だけを追加します。' : canContinueToTranslation ? '未選択候補は残して翻訳へ進めます。' : '追加する候補を選択してください。' }}</span>
        <button v-if="selectedCount" type="button" class="primary" :disabled="options.busy.value" @click="flow.applyTargetCards(targets.map(card => card.id), true)">
          選択した候補を追加（{{ selectedCount }}件）
        </button>
        <button v-else-if="canContinueToTranslation" type="button" class="primary" :disabled="options.busy.value" @click="emit('translate')">
          翻訳へ進む
        </button>
        <button v-else-if="!remainingCandidateCount" type="button" :disabled="options.busy.value" @click="flow.openApplyTargets(undefined, 'detect')">
          対象選択に戻る
        </button>
      </template>
      <button v-else type="button" @click="emit('close')">
        結果を保持して編集へ
      </button>
    </footer>
  </section>
</template>

<style scoped>
.region-ocr-workspace { min-height: 100%; display: flex; flex-direction: column; padding: 24px 24px 0; background: #fff; }
header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
header > div { min-width: 0; }
header > button { flex-shrink: 0; }
header h2 { margin: 0; font-size: 22px; }
header p { margin: 8px 0 0; color: #52647d; font-size: 14px; }
.workflow-help { font-size: 13px; color: #64748b; margin-bottom: 16px; }
.workflow-help summary { cursor: pointer; width: fit-content; }
.workflow-help p { max-width: 720px; line-height: 1.7; }
.workflow-content { flex: 1; padding-bottom: 24px; }
.workflow-navigation, .candidate-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }
.workflow-empty { padding: 32px; border: 1px solid #e2e8f0; border-radius: 10px; background: #f8fafc; }
.workflow-empty h3 { margin: 0 0 8px; font-size: 18px; }
.workflow-empty p { margin: 0 0 20px; color: #52647d; }
.plan-summary { margin: 0 0 16px; font-size: 14px; color: #52647d; }
.batch-card-preview { margin-bottom: 12px; display: flex; align-items: flex-start; gap: 16px; max-height: 260px; overflow: auto; overflow-wrap: anywhere; padding: 16px; background: #f8fafc; border-radius: 8px; }
.batch-card-preview img { object-fit: contain; flex-shrink: 0; }
.workflow-footer { position: sticky; bottom: 0; z-index: 2; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; padding: 16px 0; border-top: 1px solid #e2e8f0; background: #fff; }
.workflow-footer strong { font-size: 14px; }
.ocr-progress { padding: 24px; background: #f1f5f9; border-radius: 8px; }
.next-action { flex: 1; min-width: 180px; font-size: 13px; color: #52647d; }
.ocr-results h3 { margin-top: 0; }
progress { width: min(100%, 600px); }
@media (max-width: 850px) {
  .region-ocr-workspace { padding: 16px 12px 0; min-height: 60dvh; }
  header { flex-wrap: wrap; }
  .workflow-empty { padding: 20px; }
  .workflow-footer { bottom: 0; }
}
</style>
