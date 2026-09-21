<script setup lang="ts">
import type { DiscoveryWorkspaceOptions } from './useDiscoveryWorkspace'
import type { IconProposalChoice } from '~/services/asset-discovery/proposal-review'
import type { IconOccurrence } from '~/types/asset-discovery'
import { computed, onScopeDispose, ref, useId, watch } from 'vue'
import AssetCreationPanel from '~/components/AssetCreationPanel.vue'
import { groupAssetState } from '~/services/asset-discovery/group-asset'
import DiscoveryBoundsEditor from './DiscoveryBoundsEditor.vue'
import DiscoveryProposalComparison from './DiscoveryProposalComparison.vue'
import DiscoveryThumbnail from './DiscoveryThumbnail.vue'
import { useDiscoveryThumbnails } from './useDiscoveryThumbnails'
import { useDiscoveryWorkspace } from './useDiscoveryWorkspace'

const props = withDefaults(defineProps<{ options: DiscoveryWorkspaceOptions, active?: boolean }>(), { active: true })
const emit = defineEmits<{ working: [value: boolean], analyzeRegions: [] }>()
const model = useDiscoveryWorkspace(props.options)
const thumbnails = useDiscoveryThumbnails(props.options)
const titleId = useId()
const optedIn = ref(false)
const cardIds = ref([props.options.currentImageId.value])
const groupId = ref('all')
const checked = ref<string[]>([])
const destination = ref('')
const newGroupName = ref('')
const adding = ref(false)
const occurrencePage = ref(0)
const diffIds = ref<string[]>([])
const discardPending = ref(false)
const groupLabels = computed(() => new Map(model.groups.value.map((group, index) => [group.id, group.name.trim() || `グループ${index + 1}`])))
const groupLabel = (id: string) => groupLabels.value.get(id) ?? ''
const activeGroup = computed(() => model.groups.value.find(group => group.id === groupId.value))
const groupAsset = ref('')
const assignment = computed(() => activeGroup.value ? groupAssetState({ groups: model.groups.value, occurrences: model.occurrences.value }, activeGroup.value) : null)
watch(() => [activeGroup.value?.id, assignment.value?.assetId, assignment.value?.needsSync], () => {
  groupAsset.value = assignment.value?.assetId ?? ''
}, { immediate: true })
const filtered = computed(() => model.occurrences.value.filter(item => groupId.value === 'all' || (groupId.value === 'ungrouped' ? !model.groups.value.some(group => group.memberIds.includes(item.id)) : model.groups.value.find(group => group.id === groupId.value)?.memberIds.includes(item.id))))
const visible = computed(() => filtered.value.slice(occurrencePage.value * 24, (occurrencePage.value + 1) * 24))
const checkedCount = computed(() => filtered.value.filter(item => checked.value.includes(item.id)).length)
const allChecked = computed(() => filtered.value.length > 0 && checkedCount.value === filtered.value.length)
function checkAll(event: Event) {
  checked.value = (event.target as HTMLInputElement).checked ? filtered.value.map(item => item.id) : []
}
const selectedGroup = computed(() => model.groups.value.find(group => group.memberIds.includes(model.selectedId.value ?? '')))
const currentSelection = computed(() => model.selected.value?.cardId === props.options.currentImageId.value ? model.selected.value : undefined)
const currentImage = computed(() => props.options.runtime.cardImage.value)
const editableCard = computed(() => model.activeCard.value)
const comparisonCard = computed(() => model.cards.value.find(card => card.id === model.comparison.value?.cardId))
const assets = computed(() => props.options.store.assets)
const stateLabel = (item: IconOccurrence) => item.decision === 'excluded' ? '除外' : '候補'
const cardName = (id: string) => model.cards.value.find(card => card.id === id)?.imageName ?? id
const occurrencesById = computed(() => new Map(model.occurrences.value.map(item => [item.id, item])))
const representative = (id: string) => occurrencesById.value.get(id)
const groupStats = computed(() => new Map(model.groups.value.map((group) => {
  const items = group.memberIds.flatMap(id => occurrencesById.value.get(id) ?? [])
  return [group.id, { cards: new Set(items.map(item => item.cardId)).size, excluded: items.filter(item => item.decision === 'excluded').length }]
})))
function action(fn: () => unknown) {
  if (!model.working.value)
    void model.run(fn)
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
})
watch(() => model.comparison.value, () => {
  diffIds.value = []
})
watch(() => model.selectedId.value, () => {
  adding.value = false
})
watch(() => model.occurrences.value, (items) => {
  checked.value = checked.value.filter(id => items.some(item => item.id === id))
  occurrencePage.value = Math.min(occurrencePage.value, Math.max(0, Math.ceil(filtered.value.length / 24) - 1))
})
watch(() => model.groups.value, (groups) => {
  if (!['all', 'ungrouped'].includes(groupId.value) && !groups.some(group => group.id === groupId.value))
    groupId.value = 'all'
  if (destination.value && !['new', 'ungrouped'].includes(destination.value) && !groups.some(group => group.id === destination.value))
    destination.value = ''
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
    <header>
      <h2 :id="titleId">
        アセット検出
      </h2>
      <button type="button" :disabled="model.working.value || model.pending.value.size > 0 || Boolean(model.creation.value)" @click="emit('analyzeRegions')">
        次へ：領域検出・アイコン反映
      </button>
    </header>
    <p>アイコン候補の収集・確認 → グループ整理・登録 → 領域へ反映。登録済みアセットの調整は「アセット編集」で行えます。</p>
    <details class="help">
      <summary>使い方・保存について</summary>
      <p>画像は端末内で処理します。候補の整理・登録だけでは、原文・訳文・カードの描画を変更しません。</p>
      <p>候補と調整内容は「プロジェクト保存」で保存できます。この画面の編集は即時に保存対象へ反映され、「候補編集を戻す」で取り消せます。</p>
      <p>画面を切り替えても選択・比較案は保持します。処理中は画面切替と保存を待ってください。未適用の再収集案は保存されず、別プロジェクトを開く・ページを閉じると破棄されます。</p>
      <p>分類・アセット割当後は「次へ」で位置を引き継ぎ、アイコンタグ付きの原文を確認できます。</p>
    </details>
    <details :open="model.occurrences.value.length === 0">
      <summary>収集するカードを選ぶ</summary>
      <fieldset :disabled="model.working.value">
        <legend>対象カード</legend>
        <button type="button" @click="cardIds = model.cards.value.map(card => card.id)">
          すべて対象にする
        </button>
        <button type="button" @click="cardIds = [options.currentImageId.value]">
          現在のカードだけ
        </button>
        <div class="targets">
          <label v-for="card in model.cards.value" :key="card.id"><input v-model="cardIds" type="checkbox" :value="card.id">{{ card.imageName }}</label>
        </div>
        <label><input v-model="optedIn" type="checkbox">アイコン候補を収集する（追加のOCRを実行）</label>
        <button type="button" :disabled="!optedIn || !cardIds.length" @click="model.collect(cardIds)">
          選択したカードから収集
        </button>
        <p>領域・OCR候補があればその周辺を読み直します。既存のアイコン候補は上書きせず、再収集案として比較します。</p>
      </fieldset>
    </details>
    <p v-if="model.collection.running.value" role="status">
      {{ model.collection.progress.value.started }}/{{ model.collection.progress.value.total }}枚目を処理中
      {{ model.collection.progress.value.cardId ? cardName(model.collection.progress.value.cardId) : '' }}
      <button type="button" :disabled="model.collection.cancelRequested.value" @click="model.collection.cancel()">
        収集を中止
      </button>
      <small>完了分は残し、処理中カードの結果は採用しません。Workerの即時停止ではありません。</small>
    </p>
    <p v-if="model.notice.value" role="status">
      {{ model.notice.value }}
    </p>
    <p v-if="model.error.value" class="error" role="alert">
      {{ model.error.value }}
    </p>
    <div class="history">
      <button type="button" :disabled="model.working.value || !model.review.canUndo.value" @click="action(model.review.undo)">
        候補編集を戻す
      </button>
      <button type="button" :disabled="model.working.value || !model.review.canRedo.value" @click="action(model.review.redo)">
        候補編集をやり直す
      </button>
      <span v-if="model.review.historyTruncated.value">履歴の上限に達したため、古い候補編集は戻せません。</span>
    </div>
    <section v-if="model.pending.value.size">
      <h3>再収集の比較待ち</h3>
      <button type="button" :disabled="model.working.value" @click="discardPending = true">
        再収集案をすべて破棄
      </button>
      <section v-if="discardPending" role="alert">
        <p>未適用の再収集案を破棄しますか？保存対象の候補・調整内容は残ります。</p>
        <button type="button" :disabled="model.working.value" @click="discardProposals">
          再収集案を破棄
        </button>
        <button type="button" @click="discardPending = false">
          確認に戻る
        </button>
      </section>
      <button v-for="id in model.pending.value.keys()" :key="id" type="button" :disabled="model.working.value" @click="model.compare(id)">
        {{ cardName(id) }}の案を比較
      </button>
      <section v-if="model.comparison.value">
        <DiscoveryProposalComparison v-if="comparisonCard" v-model:selected-ids="diffIds" :review="model.comparison.value" :occurrences="model.occurrences.value" :groups="model.groups.value" :assets="assets" :card="comparisonCard" :image-url="comparisonCard.id === options.currentImageId.value ? currentImage?.src : undefined" :thumbnails="thumbnails" :active="active" :disabled="model.working.value" />
        <button type="button" :disabled="model.working.value || !diffIds.length" @click="applyDifference">
          選択した再収集案を採用
        </button>
      </section>
    </section>
    <div class="review-columns">
      <section class="groups">
        <h3>グループ（{{ model.groups.value.length }}）</h3>
        <p>全{{ model.groups.value.length }}件。スクロールして確認できます。</p>
        <button type="button" :aria-pressed="groupId === 'all'" @click="groupId = 'all'">
          すべての候補
        </button>
        <button type="button" :aria-pressed="groupId === 'ungrouped'" @click="groupId = 'ungrouped'">
          未分類
        </button>
        <fieldset v-if="activeGroup" :disabled="model.working.value">
          <legend>選択中のグループ</legend>
          <label>グループ名<input :key="activeGroup.id + activeGroup.name" :value="groupLabel(activeGroup.id)" @change="action(() => model.review.editGroup(activeGroup!.id, { name: ($event.target as HTMLInputElement).value.trim() }))"></label>
          <small>変更した名前はプロジェクト保存で保存されます。</small>
          <label>グループに関連付けるアセット
            <select v-model="groupAsset" aria-label="グループに関連付けるアセット">
              <option value="">未割当</option>
              <option v-for="asset in assets" :key="asset.id" :value="asset.id">{{ asset.name }}</option>
            </select>
          </label>
          <p v-if="assignment?.needsSync" role="status">
            既存の個別割当がグループと揃っていません。アセットを選んでグループ全体へ関連付けてください。
          </p>
          <button type="button" @click="action(() => model.review.linkGroupAsset(activeGroup!.id, groupAsset || null))">
            グループ全体に関連付け
          </button>
          <button type="button" :disabled="Boolean(model.creation.value) || representative(activeGroup.representativeId)?.decision === 'excluded'" @click="model.prepareRegistration(activeGroup!.id)">
            代表候補からグループ用アセットを登録
          </button>
          <small>全{{ activeGroup.memberIds.length }}候補に同じアセットを使います。原文への反映は「次へ：領域検出・アイコン反映」で確認します。除外した候補は反映しません。</small>
        </fieldset>
        <div class="group-list" tabindex="0" aria-label="グループ一覧（スクロールできます）">
          <button v-for="group in model.groups.value" :key="group.id" type="button" :aria-pressed="groupId === group.id" @click="groupId = group.id">
            <DiscoveryThumbnail v-if="representative(group.representativeId)" :item="representative(group.representativeId)!" :thumbnails="thumbnails" :active="active" />
            {{ groupLabel(group.id) }}：{{ group.memberIds.length }}件・{{ groupStats.get(group.id)?.cards }}枚
            <small>除外 {{ groupStats.get(group.id)?.excluded }}件</small>
          </button>
        </div>
      </section>
      <section class="occurrences">
        <h3>出現候補（{{ filtered.length }}）</h3>
        <fieldset :disabled="model.working.value">
          <legend>選択した候補のグループ整理</legend>
          <select v-model="destination" aria-label="候補の移動先">
            <option disabled value="">
              移動先グループを選択
            </option>
            <option value="new">
              新しいグループへ分ける
            </option><option value="ungrouped">
              未分類に戻す
            </option>
            <option v-for="group in model.groups.value" :key="group.id" :value="group.id">
              {{ groupLabel(group.id) }}へ統合・移動
            </option>
          </select>
          <input v-if="destination === 'new'" v-model="newGroupName" aria-label="新しいグループ名" placeholder="グループ名（任意）">
          <button type="button" :disabled="!checked.length || !destination" @click="moveChecked">
            選択{{ checked.length }}件を移動
          </button>
          <small>移動すると移動先グループのアセットに揃います。未分類・新しいグループでは割当を解除します。</small>
        </fieldset>
        <label class="select-all">
          <input type="checkbox" :checked="allChecked" :indeterminate="checkedCount > 0 && !allChecked" :disabled="model.working.value || !filtered.length" @change="checkAll">
          すべて選択（{{ filtered.length }}件・ページ外を含む）
        </label>
        <div v-for="item in visible" :key="item.id" class="occurrence">
          <input v-model="checked" type="checkbox" :value="item.id" :aria-label="`${cardName(item.cardId)}の候補を整理対象にする ${item.id}`" :disabled="model.working.value">
          <button type="button" :disabled="model.working.value" :aria-pressed="model.selectedId.value === item.id" @click="model.select(item.id)">
            <DiscoveryThumbnail :item="item" :thumbnails="thumbnails" :active="active" />
            {{ cardName(item.cardId) }}・{{ stateLabel(item) }}
            <small>{{ item.assetId ? assets.find(asset => asset.id === item.assetId)?.name : 'アセット未割当' }}</small>
          </button>
        </div>
        <nav aria-label="候補のページ">
          <button type="button" :disabled="occurrencePage === 0" @click="occurrencePage--">
            前へ
          </button><button type="button" :disabled="(occurrencePage + 1) * 24 >= filtered.length" @click="occurrencePage++">
            次へ
          </button>
        </nav>
      </section>
      <section class="details">
        <h3>元画像で確認・登録</h3>
        <p>一覧はサムネイルです。候補を開くと元画像で確認できます。</p>
        <button type="button" :disabled="model.working.value || !currentImage" @click="adding = !adding">
          {{ adding ? '手動追加を終了' : '現在のカードに手動追加' }}
        </button>
        <template v-if="editableCard && currentImage && (currentSelection || adding)">
          <DiscoveryBoundsEditor :key="adding ? 'new' : currentSelection?.id" :image-url="currentImage.src" :image-width="editableCard.imageWidth" :image-height="editableCard.imageHeight" :bounds="adding ? undefined : currentSelection?.bounds" :disabled="model.working.value || Boolean(model.creation.value)" @commit="model.changeBounds($event, adding)" @split="splitCandidate" />
          <fieldset v-if="currentSelection && !adding" :disabled="model.working.value">
            <legend>この出現箇所の判断</legend>
            <button type="button" @click="action(() => model.review.change(currentSelection!.id, { kind: 'decision', decision: currentSelection!.decision === 'excluded' ? 'pending' : 'excluded' }))">
              {{ currentSelection.decision === 'excluded' ? '除外を取り消す' : '誤検出として除外' }}
            </button>
            <p v-if="selectedGroup">
              アセットは「{{ groupLabel(selectedGroup.id) }}」で設定します。
            </p>
            <p v-else>
              アセットを使うには、先にこの候補をグループに分類してください。
            </p>
            <template v-if="selectedGroup">
              <button type="button" @click="groupId = selectedGroup!.id">
                {{ groupLabel(selectedGroup.id) }}の名前を編集
              </button>
              <button type="button" :disabled="selectedGroup.representativeId === currentSelection.id" @click="action(() => model.review.editGroup(selectedGroup!.id, { representativeId: currentSelection!.id }))">
                この候補を代表にする
              </button>
            </template>
            <p>範囲と分類を調整し、誤検出は除外してください。位置と原文は次の画面で確認して反映します。</p>
          </fieldset>
          <AssetCreationPanel v-if="model.creation.value" :image="currentImage" :draft="model.creation.value" :existing-assets="assets" :running="model.registration.running.value" @update="model.creation.value = { ...model.creation.value!, ...$event }" @confirm="model.register" @cancel="model.creation.value = null" />
        </template>
        <p v-else>
          一覧の候補を選んでください。検出漏れは現在のカードへ手動追加できます。
        </p>
      </section>
    </div>
  </section>
</template>

<style scoped>
.discovery-workspace { flex: 1; min-height: 0; padding: 20px; overflow: auto; background: #fff; }
header { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 16px; }
.help { margin-bottom: 12px; }
h2, h3 { margin: 8px 0; }
p { font-size: 0.85rem; }
button, input, select { font-size: 0.85rem; }
fieldset { border: 1px solid #cbd5e1; border-radius: 6px; padding: 10px; display: grid; gap: 8px; margin: 8px 0; }
.targets { max-height: 180px; overflow: auto; display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); }
.targets label { overflow-wrap: anywhere; }
.review-columns { display: grid; grid-template-columns: minmax(180px, 1fr) minmax(230px, 1.25fr) minmax(330px, 2fr); gap: 16px; margin-top: 16px; }
.groups > button, .group-list > button { display: block; width: 100%; text-align: left; margin: 6px 0; }
.groups { min-width: 0; }
.groups input { min-width: 0; width: 100%; box-sizing: border-box; }
.group-list { max-height: 55vh; overflow-y: auto; padding: 3px; }
small { display: block; }
.occurrence { display: flex; gap: 6px; align-items: center; margin: 6px 0; }
.occurrence button { flex: 1; min-width: 0; text-align: left; overflow-wrap: anywhere; }
[aria-pressed="true"] { outline: 2px solid #2563eb; }
.error { color: #b91c1c; white-space: pre-wrap; }
.history, nav { display: flex; gap: 8px; margin: 10px 0; }
@media (max-width: 950px) { .review-columns { grid-template-columns: 1fr; } }
</style>
