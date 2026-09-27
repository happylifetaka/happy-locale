<script setup lang="ts">
import type { DiscoveryWorkspaceOptions } from './useDiscoveryWorkspace'
import type { RegionOCRMode } from '~/services/asset-discovery/analyze-regions'
import type { IconProposalChoice } from '~/services/asset-discovery/proposal-review'
import { computed, onScopeDispose, ref, useId, watch } from 'vue'
import AssetCreationPanel from '~/components/AssetCreationPanel.vue'
import { groupAssetState } from '~/services/asset-discovery/group-asset'
import { activeReviewGroups } from '~/services/asset-discovery/review-groups'
import DiscoveryBoundsEditor from './DiscoveryBoundsEditor.vue'
import DiscoveryProposalComparison from './DiscoveryProposalComparison.vue'
import DiscoveryThumbnail from './DiscoveryThumbnail.vue'
import { useDiscoveryThumbnails } from './useDiscoveryThumbnails'
import { useDiscoveryWorkspace } from './useDiscoveryWorkspace'

const props = withDefaults(defineProps<{ options: DiscoveryWorkspaceOptions, active?: boolean, focusOccurrence?: { id: string, request: number } | null }>(), { active: true })
const emit = defineEmits<{ working: [value: boolean], openOcr: [ids: string[], mode: RegionOCRMode] }>()
const model = useDiscoveryWorkspace(props.options)
const thumbnails = useDiscoveryThumbnails(props.options)
const titleId = useId()
const collectionScope = ref<'image' | 'regions'>(model.activeCard.value?.regions.length ? 'regions' : 'image')
const cardIds = ref([props.options.currentImageId.value])
const collectionCardIds = computed(() => cardIds.value.filter(id => model.cards.value.some(card => card.id === id && (collectionScope.value === 'image' || card.regions.length > 0))))
const groupId = ref('all')
const groupSearch = ref('')
const checked = ref<string[]>([])
const destination = ref('')
const newGroupName = ref('')
const adding = ref(false)
const detailsHeading = ref<HTMLElement | null>(null)
const comparisonStart = ref<HTMLElement | null>(null)
const occurrencePage = ref(0)
const diffIds = ref<string[]>([])
const discardPending = ref(false)
const reviewGroups = computed(() => activeReviewGroups({ groups: model.groups.value, occurrences: model.occurrences.value }))
const excludedCount = computed(() => model.occurrences.value.filter(item => item.decision === 'excluded').length)
const activeCount = computed(() => model.occurrences.value.length - excludedCount.value)
const groupLabels = computed(() => new Map(model.groups.value.map((group, index) => [group.id, group.name.trim() || `グループ${index + 1}`])))
const groupLabel = (id: string) => groupLabels.value.get(id) ?? ''
const activeGroup = computed(() => reviewGroups.value.find(group => group.id === groupId.value))
const groupAsset = ref('')
const assignment = computed(() => {
  const storedGroup = model.groups.value.find(group => group.id === activeGroup.value?.id)
  return storedGroup ? groupAssetState({ groups: model.groups.value, occurrences: model.occurrences.value }, storedGroup) : null
})
watch(() => [activeGroup.value?.id, assignment.value?.assetId, assignment.value?.needsSync], () => {
  groupAsset.value = assignment.value?.assetId ?? ''
}, { immediate: true })
const representativeIds = computed(() => new Set(reviewGroups.value.map(group => group.representativeId)))
const filtered = computed(() => model.occurrences.value.filter(item => groupId.value === 'excluded'
  ? item.decision === 'excluded'
  : item.decision !== 'excluded' && (groupId.value === 'all' || (groupId.value === 'ungrouped' ? !model.groups.value.some(group => group.memberIds.includes(item.id)) : activeGroup.value?.memberIds.includes(item.id)))))
const visible = computed(() => filtered.value.slice(occurrencePage.value * 24, (occurrencePage.value + 1) * 24))
const checkedCount = computed(() => filtered.value.filter(item => checked.value.includes(item.id)).length)
const allChecked = computed(() => filtered.value.length > 0 && checkedCount.value === filtered.value.length)
function checkAll(event: Event) {
  checked.value = (event.target as HTMLInputElement).checked ? filtered.value.map(item => item.id) : []
}
const selectedGroup = computed(() => reviewGroups.value.find(group => group.memberIds.includes(model.selectedId.value ?? '')))
watch(() => props.focusOccurrence, async (request) => {
  if (!request)
    return
  const item = model.occurrences.value.find(item => item.id === request.id)
  if (!item)
    return
  groupId.value = item.decision === 'excluded' ? 'excluded' : model.groups.value.find(group => group.memberIds.includes(item.id))?.id ?? 'ungrouped'
  await model.select(item.id)
  occurrencePage.value = Math.max(0, Math.floor(filtered.value.findIndex(candidate => candidate.id === item.id) / 24))
}, { immediate: true })
const currentSelection = computed(() => model.selected.value?.cardId === props.options.currentImageId.value ? model.selected.value : undefined)
const currentImage = computed(() => props.options.runtime.cardImage.value)
const editableCard = computed(() => model.activeCard.value)
const comparisonCard = computed(() => model.cards.value.find(card => card.id === model.comparison.value?.cardId))
const assets = computed(() => props.options.store.assets)
const cardName = (id: string) => model.cards.value.find(card => card.id === id)?.imageName ?? id
const cardNumber = (id: string) => model.cards.value.findIndex(card => card.id === id) + 1
const occurrencesById = computed(() => new Map(model.occurrences.value.map(item => [item.id, item])))
const representative = (id: string) => occurrencesById.value.get(id)
const groupStats = computed(() => new Map(reviewGroups.value.map((group) => {
  const items = group.memberIds.flatMap(id => occurrencesById.value.get(id) ?? [])
  const storedGroup = model.groups.value.find(item => item.id === group.id)!
  const linked = groupAssetState({ groups: model.groups.value, occurrences: model.occurrences.value }, storedGroup)
  const asset = !linked.needsSync ? assets.value.find(asset => asset.id === linked.assetId) : undefined
  return [group.id, { cards: new Set(items.map(item => item.cardId)).size, asset, needsSync: linked.needsSync }]
})))
const registeredCount = computed(() => [...groupStats.value.values()].filter(group => group.asset).length)
const listedGroups = computed(() => reviewGroups.value.filter(group => `${groupLabel(group.id)} ${groupStats.value.get(group.id)?.asset?.name ?? ''}`.toLocaleLowerCase().includes(groupSearch.value.trim().toLocaleLowerCase())))
const ungroupedCount = computed(() => {
  const grouped = new Set(model.groups.value.flatMap(group => group.memberIds))
  return model.occurrences.value.filter(item => item.decision !== 'excluded' && !grouped.has(item.id)).length
})
const pageCount = computed(() => Math.max(1, Math.ceil(filtered.value.length / 24)))
function action(fn: () => unknown) {
  if (!model.working.value)
    void model.run(fn)
}
function startRegistration(id: string) {
  adding.value = false
  void model.prepareRegistration(id)
}
function toggleExcluded() {
  const item = currentSelection.value
  if (!item)
    return
  action(() => {
    const restoring = item.decision === 'excluded'
    model.review.change(item.id, { kind: 'decision', decision: restoring ? 'pending' : 'excluded' })
    checked.value = checked.value.filter(id => id !== item.id)
    model.selectedId.value = null
    const originalGroup = model.groups.value.find(group => group.memberIds.includes(item.id))
    model.notice.value = restoring ? `「${originalGroup ? groupLabel(originalGroup.id) : '未分類'}」に戻しました。` : '「誤検出」に移しました。除外を取り消すと元のグループに戻せます。'
  })
}
function revealPanel(element: HTMLElement | null) {
  const workspace = element?.closest<HTMLElement>('.discovery-workspace')
  if (!props.active || !element || !workspace)
    return
  const viewport = workspace.getBoundingClientRect()
  const top = element.getBoundingClientRect().top
  if (top < viewport.top || top > viewport.bottom - Math.min(360, viewport.height * 0.65))
    workspace.scrollBy({ top: top - viewport.top - 16 })
}
function discardProposals() {
  if (model.working.value)
    return
  model.pending.value = new Map()
  model.comparison.value = null
  discardPending.value = false
}
function moveChecked() {
  if (!destination.value)
    return
  action(() => {
    model.review.moveWithGroupAsset(checked.value, destination.value === 'new' ? { kind: 'new', id: crypto.randomUUID(), name: newGroupName.value } : destination.value === 'ungrouped' ? { kind: 'ungrouped' } : { kind: 'existing', id: destination.value })
    checked.value = []
  })
}
function applyDifference() {
  const review = model.comparison.value
  if (!review)
    return
  const choices = review.differences.flatMap<IconProposalChoice>((difference) => {
    if (!difference.detectedId || !diffIds.value.includes(difference.detectedId))
      return []
    if (difference.status === 'new')
      return [{ action: 'add' as const, detectedId: difference.detectedId }]
    if (difference.status === 'changed' && difference.occurrenceIds.length === 1)
      return [{ action: 'replace' as const, detectedId: difference.detectedId, occurrenceId: difference.occurrenceIds[0]! }]
    return []
  })
  model.adopt(choices)
}
watch(groupId, () => {
  occurrencePage.value = 0
  checked.value = []
  destination.value = ''
  model.creation.value = null
  adding.value = false
  if (model.selectedId.value && !filtered.value.some(item => item.id === model.selectedId.value))
    model.selectedId.value = null
})
watch(() => model.comparison.value, () => {
  diffIds.value = []
})
watch(() => model.comparison.value, () => revealPanel(comparisonStart.value), { flush: 'post' })
watch(() => model.selectedId.value, () => {
  adding.value = false
})
// 下書きの設定変更では移動せず、対象の切替やパネルの開閉時だけ表示位置を合わせる。
watch([() => model.selectedId.value, () => Boolean(model.creation.value), adding], () => {
  if (props.active && (currentSelection.value || adding.value))
    revealPanel(detailsHeading.value)
}, { flush: 'post' })
watch(filtered, (items, previous) => {
  checked.value = checked.value.filter(id => items.some(item => item.id === id))
  const id = model.selectedId.value
  if (id && previous.some(item => item.id === id) && !items.some(item => item.id === id))
    model.selectedId.value = null
  occurrencePage.value = Math.min(occurrencePage.value, Math.max(0, Math.ceil(items.length / 24) - 1))
})
watch(() => model.groups.value, (groups) => {
  if (!['all', 'ungrouped', 'excluded'].includes(groupId.value) && !groups.some(group => group.id === groupId.value))
    groupId.value = 'all'
  if (destination.value && !['new', 'ungrouped'].includes(destination.value) && !groups.some(group => group.id === destination.value))
    destination.value = ''
})
watch(reviewGroups, (groups) => {
  if (!['all', 'ungrouped', 'excluded'].includes(groupId.value) && !groups.some(group => group.id === groupId.value))
    groupId.value = 'all'
})
async function splitCandidate(axis: 'horizontal' | 'vertical', ratio: number) {
  if (await model.split(axis, ratio))
    groupId.value = 'ungrouped'
}
watch(model.working, value => emit('working', value), { immediate: true, flush: 'sync' })
onScopeDispose(() => emit('working', false))
</script>

<template>
  <section class="discovery-workspace" :aria-labelledby="titleId">
    <header class="workspace-header">
      <div>
        <h2 :id="titleId">
          アイコン検出
        </h2>
        <p>同じアイコンをまとめて、カードで使う画像として登録します。</p>
      </div>
      <div class="next-action">
        <span v-if="reviewGroups.length">登録済み {{ registeredCount }} / {{ reviewGroups.length }}グループ</span>
        <button type="button" :class="{ primary: registeredCount > 0 }" :disabled="model.working.value || model.pending.value.size > 0 || Boolean(model.creation.value)" @click="emit('openOcr', cardIds, 'detect')">
          領域検出へ
        </button>
        <button type="button" :disabled="model.working.value || model.pending.value.size > 0 || Boolean(model.creation.value)" @click="emit('openOcr', cardIds, 'reocr')">
          まとめて再OCRへ
        </button>
        <small v-if="model.pending.value.size">再収集の比較を終えるとOCRに進めます。</small>
        <small v-else-if="model.creation.value">アイコンの登録を確定するか、キャンセルしてください。</small>
      </div>
    </header>
    <ol class="workflow-steps" aria-label="作業の流れ">
      <li :class="{ current: !model.occurrences.value.length }">
        <span>1</span>カードから集める
      </li>
      <li :class="{ current: model.occurrences.value.length > 0 }">
        <span>2</span>同じ図柄をまとめて登録
      </li>
      <li><span>3</span>カードで使う</li>
    </ol>
    <details class="collection-panel" :open="model.occurrences.value.length === 0">
      <summary><span>収集するカードを選ぶ</span> <span class="collection-count">{{ cardIds.length }}枚を選択中</span></summary>
      <fieldset :disabled="model.working.value">
        <legend>対象カード</legend>
        <div class="collection-actions">
          <button type="button" @click="cardIds = model.cards.value.map(card => card.id)">
            すべて対象にする
          </button>
          <button type="button" @click="cardIds = [options.currentImageId.value]">
            現在のカードだけ
          </button>
        </div>
        <label>探索範囲
          <select v-model="collectionScope" aria-label="アイコンの探索範囲">
            <option value="image">カード全体</option>
            <option value="regions">確定した領域内</option>
          </select>
        </label>
        <p v-if="collectionScope === 'regions'">
          確定した領域内のアイコンを探します。小さなはみ出しは許容します。領域がないカードは対象にしません。
        </p>
        <p v-else>
          カード全体の文章付近からアイコン候補を探します。
        </p>
        <div class="targets">
          <label v-for="card in model.cards.value" :key="card.id">
            <input v-model="cardIds" type="checkbox" :value="card.id" :disabled="collectionScope === 'regions' && !card.regions.length">
            <span><strong>カード {{ cardNumber(card.id) }}</strong><small>{{ card.imageName }}</small></span>
          </label>
        </div>
        <div class="collection-start">
          <button type="button" class="primary" :disabled="!collectionCardIds.length" @click="model.collect(collectionCardIds, collectionScope)">
            選択したカードから収集
          </button>
        </div>
        <p>候補を探すために画像を端末内で読み取ります。カードの原文は変更しません。もう一度収集した場合は、現在の候補と比較してから変更できます。</p>
      </fieldset>
    </details>
    <div v-if="model.collection.running.value" class="collection-progress" role="status">
      <div><strong>{{ model.collection.progress.value.started }} / {{ model.collection.progress.value.total }}枚目を収集中</strong><small>{{ model.collection.progress.value.cardId ? `カード ${cardNumber(model.collection.progress.value.cardId)}` : '' }}</small></div>
      <progress :value="model.collection.progress.value.started" :max="model.collection.progress.value.total" aria-label="収集の進捗" />
      <button type="button" :disabled="model.collection.cancelRequested.value" @click="model.collection.cancel()">
        収集を中止
      </button>
      <small>中止しても、収集できた候補は残ります。</small>
    </div>
    <p v-if="model.notice.value" class="workspace-notice" role="status">
      {{ model.notice.value }}
    </p>
    <p v-if="model.error.value" class="error" role="alert">
      {{ model.error.value }}
    </p>
    <div class="workspace-tools">
      <div class="history">
        <button type="button" :disabled="model.working.value || !model.review.canUndo.value" @click="action(model.review.undo)">
          候補編集を戻す
        </button>
        <button type="button" :disabled="model.working.value || !model.review.canRedo.value" @click="action(model.review.redo)">
          候補編集をやり直す
        </button>
        <small v-if="model.review.historyTruncated.value">古い候補編集は履歴の上限を超えています。</small>
      </div>
      <details class="help">
        <summary>使い方・保存について</summary>
        <p>候補の整理・登録だけではカードの原文や訳文は変わりません。登録が済んだら「領域検出」または「まとめて再OCR」で原文に取り込みます。</p>
        <p>作業内容は上部の「プロジェクト保存」で保存します。候補の移動や代表変更は「候補編集を戻す」で取り消せます。</p>
        <p>未適用の再収集案は、プロジェクトを開き直すと破棄されます。</p>
      </details>
    </div>
    <section v-if="model.pending.value.size" class="comparison-panel">
      <div class="section-heading">
        <div><h3>再収集の比較待ち</h3><p>{{ model.pending.value.size }}枚の候補を、現在の内容と比べてください。</p></div><button type="button" :disabled="model.working.value" @click="discardPending = true">
          再収集案をすべて破棄
        </button>
      </div>
      <section v-if="discardPending" role="alert" class="discard-confirmation">
        <p>再収集案を破棄しますか？現在の候補と調整内容は残ります。</p>
        <button type="button" :disabled="model.working.value" @click="discardProposals">
          再収集案を破棄
        </button>
        <button type="button" @click="discardPending = false">
          確認に戻る
        </button>
      </section>
      <div class="comparison-cards">
        <button v-for="id in model.pending.value.keys()" :key="id" type="button" :disabled="model.working.value" @click="model.compare(id)">
          {{ cardName(id) }}の案を比較
        </button>
      </div>
      <section v-if="model.comparison.value" ref="comparisonStart" class="comparison-start">
        <DiscoveryProposalComparison v-if="comparisonCard" v-model:selected-ids="diffIds" :review="model.comparison.value" :occurrences="model.occurrences.value" :groups="model.groups.value" :assets="assets" :card="comparisonCard" :image-url="comparisonCard.id === options.currentImageId.value ? currentImage?.src : undefined" :thumbnails="thumbnails" :active="active" :disabled="model.working.value" />
        <button type="button" class="primary" :disabled="model.working.value || !diffIds.length" @click="applyDifference">
          選択した再収集案を採用
        </button>
      </section>
    </section>
    <div v-if="model.occurrences.value.length" class="review-columns">
      <aside class="groups">
        <div class="section-heading">
          <h3>グループ（{{ reviewGroups.length }}）</h3>
        </div>
        <p>同じ図柄がまとまっているか確認します。</p>
        <input v-model="groupSearch" type="search" aria-label="グループを検索" placeholder="グループ名で検索">
        <div class="group-filters">
          <button type="button" aria-label="すべての候補" :disabled="model.working.value" :aria-pressed="groupId === 'all'" @click="groupId = 'all'">
            すべての候補 <span>{{ activeCount }}</span>
          </button>
          <button type="button" aria-label="未分類" :disabled="model.working.value" :aria-pressed="groupId === 'ungrouped'" @click="groupId = 'ungrouped'">
            未分類 <span>{{ ungroupedCount }}</span>
          </button>
        </div>
        <div class="group-list" tabindex="0" aria-label="グループ一覧（スクロールできます）">
          <button v-for="group in listedGroups" :key="group.id" type="button" :disabled="model.working.value" :aria-pressed="groupId === group.id" @click="groupId = group.id">
            <DiscoveryThumbnail v-if="representative(group.representativeId)" :item="representative(group.representativeId)!" :thumbnails="thumbnails" :active="active" />
            <span class="group-text"><strong>{{ groupLabel(group.id) }}：</strong><small>{{ group.memberIds.length }}件・{{ groupStats.get(group.id)?.cards }}枚</small><span class="group-status" :class="{ registered: groupStats.get(group.id)?.asset }">{{ groupStats.get(group.id)?.asset?.name || (groupStats.get(group.id)?.needsSync ? '設定の確認が必要' : '未登録') }}</span></span>
          </button>
          <p v-if="!listedGroups.length">
            一致するグループはありません。
          </p>
        </div>
        <button type="button" class="false-positive-group" aria-label="誤検出" :disabled="model.working.value" :aria-pressed="groupId === 'excluded'" @click="groupId = 'excluded'">
          <span><strong>誤検出</strong><span>{{ excludedCount }}件</span></span>
          <small>カードには反映しません</small>
        </button>
      </aside>
      <div class="group-workspace">
        <section v-if="activeGroup" class="group-settings" aria-label="選択中のグループ">
          <div class="group-identity">
            <label>グループ名<input :key="activeGroup.id + activeGroup.name" :value="groupLabel(activeGroup.id)" :disabled="model.working.value" @change="action(() => model.review.editGroup(activeGroup!.id, { name: ($event.target as HTMLInputElement).value.trim() }))"></label>
            <span>{{ activeGroup.memberIds.length }}個の候補</span>
          </div>
          <div class="group-registration">
            <div class="representative-preview">
              <DiscoveryThumbnail v-if="representative(activeGroup.representativeId)" :item="representative(activeGroup.representativeId)!" :thumbnails="thumbnails" :active="active" />
              <div><strong>代表候補</strong><small>この画像をアイコンとして使います。</small></div>
            </div>
            <div class="registration-action">
              <p v-if="groupStats.get(activeGroup.id)?.asset" class="registered-note">
                使用中：{{ groupStats.get(activeGroup.id)?.asset?.name }}
              </p>
              <button type="button" class="primary" :disabled="model.working.value || Boolean(model.creation.value) || representative(activeGroup.representativeId)?.decision === 'excluded'" @click="startRegistration(activeGroup!.id)">
                代表画像をアイコンに登録
              </button>
              <small v-if="representative(activeGroup.representativeId)?.decision === 'excluded'">代表が除外されています。別の候補を代表にしてください。</small>
            </div>
          </div>
          <details class="existing-asset" :open="Boolean(assignment?.needsSync)">
            <summary>登録済みのアイコンを使う・変更する</summary>
            <fieldset :disabled="model.working.value">
              <label>グループに関連付けるアイコン<select v-model="groupAsset" aria-label="グループに関連付けるアイコン"><option value="">未割当</option><option v-for="asset in assets" :key="asset.id" :value="asset.id">{{ asset.name }}</option></select></label>
              <button type="button" @click="action(() => model.review.linkGroupAsset(activeGroup!.id, groupAsset || null))">
                グループ全体に関連付け
              </button>
              <p v-if="assignment?.needsSync" role="status">
                候補ごとに設定が異なります。このグループで使うアイコンを選んでください。
              </p>
              <small>このグループの全候補に使います。除外した候補はカードに反映しません。</small>
            </fieldset>
          </details>
        </section>
        <div v-else class="group-context">
          <h3>{{ groupId === 'excluded' ? '誤検出' : groupId === 'ungrouped' ? '未分類の候補' : 'すべての候補' }}</h3>
          <p>{{ groupId === 'excluded' ? '誤検出として除外した候補です。画像を開いて「除外を取り消す」と、元のグループに戻せます。' : groupId === 'ungrouped' ? '候補にチェックを入れて、同じ図柄のグループへ移動できます。' : '左からグループを選ぶと、代表画像の確認とアイコン登録ができます。誤検出は専用グループにまとめています。' }}</p>
        </div>
        <div class="candidate-layout" :class="{ 'has-detail': (currentSelection || adding) && !model.creation.value }">
          <section v-show="!model.creation.value" class="occurrences">
            <div class="section-heading">
              <h3>候補画像 <span>{{ filtered.length }}件</span></h3><button v-if="groupId !== 'excluded'" type="button" class="text-button" :disabled="model.working.value || !currentImage || Boolean(model.creation.value)" @click="adding = !adding">
                {{ adding ? '手動追加を終了' : '現在のカードに手動追加' }}
              </button>
            </div>
            <p v-if="groupId !== 'excluded'" class="candidate-help">
              画像を押すと拡大・修正できます。チェックはグループ移動に使います。
            </p>
            <fieldset v-if="checked.length" class="move-toolbar" :disabled="model.working.value">
              <legend>選択した{{ checked.length }}件を移動</legend>
              <select v-model="destination" aria-label="候補の移動先">
                <option disabled value="">
                  移動先グループを選択
                </option><option value="new">
                  新しいグループへ分ける
                </option><option value="ungrouped">
                  未分類に戻す
                </option><option v-for="group in reviewGroups" :key="group.id" :value="group.id">
                  {{ groupLabel(group.id) }}へ統合・移動
                </option>
              </select>
              <input v-if="destination === 'new'" v-model="newGroupName" aria-label="新しいグループ名" placeholder="グループ名（任意）">
              <button type="button" :disabled="!destination" @click="moveChecked">
                選択{{ checked.length }}件を移動
              </button>
              <small>移動先のアイコンを使います。新しいグループ・未分類では設定を解除します。</small>
            </fieldset>
            <div class="candidate-toolbar">
              <label v-if="groupId !== 'excluded'" class="select-all"><input type="checkbox" :checked="allChecked" :indeterminate="checkedCount > 0 && !allChecked" :disabled="model.working.value || !filtered.length" @change="checkAll">すべて選択（{{ filtered.length }}件・ページ外を含む）</label>
              <span v-if="filtered.length">{{ occurrencePage * 24 + 1 }}–{{ Math.min((occurrencePage + 1) * 24, filtered.length) }}件</span>
            </div>
            <div class="candidate-grid">
              <div v-for="item in visible" :key="item.id" class="occurrence" :class="{ excluded: item.decision === 'excluded', selected: model.selectedId.value === item.id }">
                <input v-if="item.decision !== 'excluded'" v-model="checked" type="checkbox" :value="item.id" :aria-label="`${cardName(item.cardId)}の候補を整理対象にする ${item.id}`" :disabled="model.working.value">
                <button type="button" :disabled="model.working.value" :aria-pressed="model.selectedId.value === item.id" :title="cardName(item.cardId)" @click="model.select(item.id)">
                  <span class="candidate-image"><DiscoveryThumbnail :item="item" :thumbnails="thumbnails" :active="active" /><span v-if="representativeIds.has(item.id)" class="representative-label">代表候補</span><span v-if="item.decision === 'excluded'" class="excluded-label">誤検出</span></span>
                  <strong>カード {{ cardNumber(item.cardId) }}</strong><small class="candidate-filename">{{ cardName(item.cardId) }}</small>
                  <small class="candidate-asset">{{ item.decision === 'excluded' ? 'カードには反映しません' : item.assetId ? assets.find(asset => asset.id === item.assetId)?.name : 'アイコン未割当' }}</small>
                </button>
              </div>
            </div>
            <p v-if="!filtered.length" class="empty-candidates">
              このグループには候補がありません。
            </p>
            <nav v-if="filtered.length > 24" aria-label="候補のページ">
              <button type="button" :disabled="occurrencePage === 0" @click="occurrencePage--">
                前へ
              </button><span>{{ occurrencePage + 1 }} / {{ pageCount }}ページ</span><button type="button" :disabled="(occurrencePage + 1) * 24 >= filtered.length" @click="occurrencePage++">
                次へ
              </button>
            </nav>
          </section>
          <section v-if="currentSelection || adding" class="details" :aria-label="model.creation.value ? 'アイコン登録' : '候補の確認と修正'">
            <div ref="detailsHeading" class="section-heading">
              <h3>{{ model.creation.value ? 'アイコン登録' : adding ? '候補を手動追加' : '候補を確認' }}</h3><button type="button" :disabled="model.working.value" @click="model.selectedId.value = null; adding = false; model.creation.value = null">
                閉じる
              </button>
            </div>
            <template v-if="editableCard && currentImage">
              <div v-if="currentSelection && !adding" class="candidate-identity">
                <strong>カード {{ cardNumber(currentSelection.cardId) }}</strong><small>{{ cardName(currentSelection.cardId) }}</small><span>{{ currentSelection.decision === 'excluded' ? '誤検出' : selectedGroup ? groupLabel(selectedGroup.id) : '未分類' }}</span>
              </div>
              <fieldset v-if="currentSelection && !adding && !model.creation.value" class="candidate-actions" :disabled="model.working.value">
                <legend>候補の設定</legend>
                <template v-if="selectedGroup">
                  <span v-if="selectedGroup.representativeId === currentSelection.id" class="representative-label">このグループの代表候補です</span><button type="button" :disabled="selectedGroup.representativeId === currentSelection.id" @click="action(() => model.review.editGroup(selectedGroup!.id, { representativeId: currentSelection!.id }))">
                    この候補を代表にする
                  </button><button type="button" class="text-button" @click="groupId = selectedGroup!.id">
                    {{ groupLabel(selectedGroup.id) }}の名前を編集
                  </button>
                </template>
                <p v-else-if="currentSelection.decision !== 'excluded'">
                  使うには、チェックを入れてグループへ移動してください。
                </p>
                <button type="button" class="exclude-button" @click="toggleExcluded">
                  {{ currentSelection.decision === 'excluded' ? '除外を取り消す' : '誤検出として除外' }}
                </button>
              </fieldset>
              <div v-if="currentSelection?.decision === 'excluded' && !adding" class="excluded-preview">
                <DiscoveryThumbnail :item="currentSelection" :thumbnails="thumbnails" :active="active" />
                <p>範囲の修正やグループの移動は、除外を取り消してから行えます。</p>
              </div>
              <AssetCreationPanel v-else-if="model.creation.value" :image="currentImage" :draft="model.creation.value" :existing-assets="assets" :running="model.registration.running.value" @update="model.creation.value = { ...model.creation.value!, ...$event }" @confirm="model.register" @cancel="model.creation.value = null" />
              <DiscoveryBoundsEditor v-else :key="adding ? 'new' : currentSelection?.id" :image-url="currentImage.src" :image-width="editableCard.imageWidth" :image-height="editableCard.imageHeight" :bounds="adding ? undefined : currentSelection?.bounds" :disabled="model.working.value" @commit="model.changeBounds($event, adding)" @split="splitCandidate" />
            </template>
          </section>
        </div>
      </div>
    </div>
    <section v-else-if="!model.collection.running.value" class="empty-workspace">
      <h3>まずはカードからアイコンを集めましょう</h3><p>上の「収集するカードを選ぶ」で対象を選び、収集を開始します。</p><p>結果は同じ図柄ごとのグループで表示されます。あとからまとめ直すこともできます。</p><button type="button" :disabled="model.working.value || !currentImage" @click="adding = !adding">
        {{ adding ? '手動追加を終了' : '現在のカードに手動追加' }}
      </button><DiscoveryBoundsEditor v-if="adding && editableCard && currentImage" :image-url="currentImage.src" :image-width="editableCard.imageWidth" :image-height="editableCard.imageHeight" :disabled="model.working.value" @commit="model.changeBounds($event, true)" />
    </section>
  </section>
</template>

<style scoped>
.discovery-workspace { flex: 1; min-height: 0; padding: 24px; overflow: auto; background: #f5f7fb; color: #172033; }
.workspace-header, .section-heading, .workspace-tools, .history, .collection-actions, .collection-start, .candidate-toolbar, nav { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
h2 { margin: 0; font-size: 1.4rem; letter-spacing: .02em; }
h3 { margin: 0; font-size: 1rem; }
p { margin: 8px 0; font-size: .875rem; line-height: 1.65; }
small { display: block; color: #64748b; font-size: .75rem; line-height: 1.5; }
button, input, select { font-size: .85rem; }
button { line-height: 1.5; }
button:disabled { cursor: not-allowed; }
input:not([type=checkbox]), select { min-width: 0; width: 100%; border: 1px solid #cbd5e1; border-radius: 6px; padding: 9px 10px; background: #fff; color: inherit; }
input[type=checkbox] { width: 16px; height: 16px; accent-color: #2563d4; flex-shrink: 0; }
label { font-size: .8rem; line-height: 1.6; }
fieldset { min-width: 0; border: 0; padding: 0; margin: 12px 0 0; }
legend { font-weight: 600; font-size: .85rem; margin-bottom: 8px; }
.next-action { display: grid; justify-items: end; gap: 5px; }
.next-action > span { color: #475569; font-size: .8rem; }
.workflow-steps { display: flex; flex-wrap: wrap; gap: 20px; list-style: none; margin: 16px 0; padding: 0; font-size: .8rem; color: #64748b; }
.workflow-steps li { display: flex; gap: 8px; align-items: center; }
.workflow-steps li > span { display: grid; place-items: center; border-radius: 50%; width: 24px; height: 24px; background: #e2e8f0; }
.workflow-steps .current { color: #1d4ed8; font-weight: 600; }
.workflow-steps .current > span { background: #dbeafe; }
.collection-panel, .comparison-panel { padding: 14px 16px; border: 1px solid #dbe2ed; border-radius: 10px; background: #fff; }
summary { cursor: pointer; font-size: .85rem; line-height: 1.6; }
.collection-panel > summary { font-weight: 600; }
.collection-panel > summary .collection-count { margin-left: 12px; color: #64748b; font-weight: normal; }
.collection-actions { justify-content: flex-start; }
.targets { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 6px; max-height: 200px; overflow: auto; margin: 12px 0; }
.targets label { display: flex; align-items: center; gap: 8px; padding: 8px; border: 1px solid #e2e8f0; border-radius: 6px; min-width: 0; }
.targets label > span { min-width: 0; }
.targets small { overflow-wrap: anywhere; }
.collection-start { border-top: 1px solid #e2e8f0; padding-top: 12px; }
.collection-start label { display: flex; align-items: center; gap: 6px; }
.collection-progress { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; padding: 14px; background: #eff6ff; border-radius: 8px; margin-top: 12px; }
.collection-progress progress { flex: 1; min-width: 100px; }
.collection-progress > small { flex-basis: 100%; }
.workspace-notice { padding: 10px 14px; border-left: 3px solid #60a5fa; background: #eff6ff; color: #1e40af; overflow-wrap: anywhere; }
.error { color: #9f2525; white-space: pre-wrap; overflow-wrap: anywhere; padding: 12px; background: #fff1f2; border-radius: 8px; }
.workspace-tools { margin: 12px 0 18px; align-items: flex-start; }
.history { justify-content: flex-start; gap: 6px; }
.history button { font-size: .75rem; padding: 6px 10px; }
.help { max-width: 520px; }
.help > summary { color: #475569; }
.comparison-panel { margin-bottom: 16px; }
.comparison-cards { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
.comparison-cards button { overflow-wrap: anywhere; text-align: left; }
.discard-confirmation { padding: 12px; background: #fff7ed; margin: 12px 0; }
.review-columns { display: grid; grid-template-columns: 240px minmax(0, 1fr); gap: 20px; align-items: start; }
.groups { min-width: 0; padding: 16px 12px; background: #fff; border: 1px solid #dbe2ed; border-radius: 10px; }
.groups > p { color: #64748b; font-size: .75rem; }
.group-filters { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin: 12px 0; }
.group-filters button { font-size: .75rem; padding: 8px 4px; }
.group-filters span { color: #64748b; }
.group-list { max-height: 65vh; overflow-y: auto; padding: 3px; display: grid; gap: 8px; }
.group-list > button { display: flex; align-items: center; gap: 8px; width: 100%; padding: 10px 8px; text-align: left; min-width: 0; }
.group-list :deep(.discovery-thumbnail) { width: 48px; height: 48px; flex-basis: 48px; margin: 0; border-radius: 5px; }
.group-text { display: grid; gap: 3px; min-width: 0; flex: 1; overflow-wrap: anywhere; }
.group-text strong { font-size: .85rem; }
.group-text small { font-size: .7rem; }
.group-status { color: #8b5b16; font-size: .7rem; }
.group-status.registered, .registered-note { color: #166534; }
.false-positive-group { display: grid; width: 100%; gap: 4px; padding: 12px; margin-top: 12px; text-align: left; color: #9f2525; }
.false-positive-group > span { display: flex; justify-content: space-between; gap: 8px; }
.false-positive-group small { font-size: .7rem; }
[aria-pressed="true"] { border-color: #3970d5; background: #eff6ff; box-shadow: inset 0 0 0 1px #3970d5; }
.group-workspace { min-width: 0; }
.group-settings, .group-context { border: 1px solid #dbe2ed; background: #fff; border-radius: 10px; padding: 18px; margin-bottom: 16px; }
.group-identity { display: flex; gap: 16px; align-items: end; }
.group-identity label { flex: 1; max-width: 380px; font-weight: 600; }
.group-identity input { margin-top: 4px; font-weight: 600; }
.group-identity > span { color: #64748b; font-size: .8rem; padding-bottom: 10px; }
.group-registration { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-top: 16px; }
.representative-preview { display: flex; align-items: center; gap: 12px; }
.representative-preview :deep(.discovery-thumbnail) { border-radius: 6px; margin: 0; }
.representative-preview strong { font-size: .9rem; }
.registration-action { display: grid; gap: 6px; }
.registered-note { margin: 0; font-size: .8rem; }
.existing-asset { margin-top: 16px; padding-top: 12px; border-top: 1px solid #e2e8f0; }
.existing-asset summary { color: #475569; }
.existing-asset fieldset { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: end; gap: 10px; }
.existing-asset p, .existing-asset small { grid-column: 1/-1; }
.candidate-layout { display: grid; grid-template-columns: minmax(0, 1fr); gap: 18px; align-items: start; }
.candidate-layout.has-detail { grid-template-columns: minmax(0, 1fr) 340px; }
.occurrences, .details { min-width: 0; padding: 16px; border: 1px solid #dbe2ed; border-radius: 10px; background: #fff; }
.section-heading h3 > span { color: #64748b; font-size: .8rem; font-weight: normal; margin-left: 8px; }
.text-button { border-color: transparent; color: #245cc7; background: transparent; padding: 4px 0; font-size: .75rem; }
.candidate-help { font-size: .75rem; color: #64748b; margin: 8px 0 12px; }
.move-toolbar { background: #eff6ff; padding: 12px; border-radius: 8px; margin: 8px 0 12px; display: grid; gap: 8px; }
.move-toolbar legend { padding-top: 8px; }
.candidate-toolbar { font-size: .75rem; color: #64748b; margin-bottom: 12px; }
.select-all { display: flex; align-items: center; gap: 6px; font-size: .75rem; color: #475569; }
.candidate-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px; }
.occurrence { position: relative; min-width: 0; }
.occurrence > input { position: absolute; top: 10px; left: 10px; z-index: 1; margin: 0; }
.occurrence > button { display: grid; gap: 4px; width: 100%; min-width: 0; text-align: left; padding: 8px 10px 10px; border-radius: 8px; }
.candidate-image { height: 106px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 5px; background: #f3f5f8; border-radius: 5px; margin-bottom: 6px; position: relative; }
.candidate-image :deep(.discovery-thumbnail) { margin: 0; background: transparent; }
.representative-label { display: inline-block; font-size: .68rem; font-weight: 600; color: #1e40af; background: #dbeafe; border-radius: 4px; padding: 2px 6px; }
.excluded-label { font-size: .68rem; color: #9f2525; }
.occurrence strong { font-size: .8rem; }
.candidate-filename { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: .68rem; }
.candidate-asset { font-size: .7rem; overflow-wrap: anywhere; }
.empty-candidates { text-align: center; padding: 24px; color: #64748b; }
nav { justify-content: center; font-size: .75rem; color: #64748b; margin-top: 18px; }
nav button { padding: 5px 12px; font-size: .75rem; }
.details { border-color: #c4d4ef; }
.details .section-heading { padding-bottom: 12px; border-bottom: 1px solid #e2e8f0; }
.details .section-heading button { padding: 4px 10px; font-size: .75rem; }
.candidate-identity { display: grid; gap: 3px; margin: 12px 0; font-size: .8rem; }
.candidate-identity small { overflow-wrap: anywhere; }
.candidate-identity > span { color: #64748b; }
.candidate-actions { display: grid; gap: 8px; padding-bottom: 12px; border-bottom: 1px solid #e2e8f0; margin-bottom: 12px; }
.candidate-actions legend { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.candidate-actions .text-button { text-align: left; }
.exclude-button { color: #9f2525; background: #fff; }
.excluded-preview { text-align: center; padding: 12px 0; }
.excluded-preview :deep(.discovery-thumbnail) { width: 128px; height: 128px; }
.empty-workspace { padding: 48px 20px; border: 1px dashed #cbd5e1; border-radius: 10px; text-align: center; background: #fff; color: #475569; }
.empty-workspace :deep(.bounds-editor) { max-width: 600px; margin: 20px auto 0; text-align: left; }
@media (max-width: 1200px) { .candidate-layout.has-detail { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 850px) { .discovery-workspace { padding: 16px; } .review-columns { grid-template-columns: minmax(0, 1fr); } .group-list { max-height: 260px; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); } .workflow-steps { gap: 10px; } .workspace-header { align-items: flex-start; } .next-action { justify-items: start; } }
@media (max-width: 500px) { .discovery-workspace { padding: 12px; } .workflow-steps { font-size: .72rem; } .existing-asset fieldset { grid-template-columns: minmax(0, 1fr); } .group-settings, .occurrences, .details { padding: 12px; } .group-identity { align-items: stretch; flex-direction: column; gap: 4px; } .candidate-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; } .registration-action, .registration-action button { width: 100%; } }
</style>
