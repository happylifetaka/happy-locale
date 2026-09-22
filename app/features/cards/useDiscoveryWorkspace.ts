import type { Ref } from 'vue'
import type { useDiscoveryImageIdentity } from './useDiscoveryImageIdentity'
import type { useCardEditor } from '~/composables/useCardEditor'
import type { useEditorAssets } from '~/composables/useEditorAssets'
import type { useProjectRuntime } from '~/composables/useProjectRuntime'
import type { CardIconProposal } from '~/services/asset-discovery/collect'
import type { IconProposalChoice, IconProposalReview } from '~/services/asset-discovery/proposal-review'
import type { OCRProvider } from '~/services/ocr/types'
import type { useProjectStore } from '~/stores/project'
import type { AssetCreationDraft, RegionDraft } from '~/types/editor'
import { computed, onScopeDispose, ref, shallowRef, watch } from 'vue'
import { createImageDigestCache } from '~/services/asset-discovery/digest'
import { useDiscoveryAssetRegistration } from './useDiscoveryAssetRegistration'
import { useDiscoveryCollection } from './useDiscoveryCollection'
import { useDiscoveryReview } from './useDiscoveryReview'

export interface DiscoveryWorkspaceOptions {
  store: ReturnType<typeof useProjectStore>
  runtime: ReturnType<typeof useProjectRuntime>
  identity: ReturnType<typeof useDiscoveryImageIdentity>
  editor: ReturnType<typeof useCardEditor>
  currentImageId: Ref<string>
  ocrRunning: Ref<boolean>
  busy: Readonly<Ref<boolean>>
  pendingDeletionIds: Readonly<Ref<Set<string>>>
  provider: OCRProvider
  createAsset: ReturnType<typeof useEditorAssets>['createSourceIconAsset']
  selectCard: (id: string) => Promise<void>
}

/** 候補レビュー画面の接続。通常領域・原文への適用はこの段階では公開しない。 */
export function useDiscoveryWorkspace(options: DiscoveryWorkspaceOptions) {
  const { store, runtime, identity, currentImageId, ocrRunning } = options
  const ownsOCR = ref(false)
  const checking = ref(false)
  const error = ref('')
  const notice = ref('')
  const selectedId = ref<string | null>(null)
  const creation = shallowRef<AssetCreationDraft | null>(null)
  const creationGroupId = ref<string | null>(null)
  const comparison = shallowRef<IconProposalReview | null>(null)
  const pending = shallowRef(new Map<string, CardIconProposal>())
  const digestCache = createImageDigestCache()
  const verified = shallowRef<{ id: string, file: File, generation: number, digest: string } | null>(null)
  let disposed = false
  const allCards = computed(() => store.document?.cards ?? [{ ...store.draftCard, id: currentImageId.value, ocrCandidates: store.draftOCRCandidates }])
  const cards = computed(() => allCards.value.filter(card => !options.pendingDeletionIds.value.has(card.id)))
  const activeCard = computed(() => cards.value.find(card => card.id === currentImageId.value))
  const occurrences = computed(() => store.assetDiscovery?.occurrences ?? [])
  const groups = computed(() => store.assetDiscovery?.groups ?? [])
  const selected = computed(() => occurrences.value.find(item => item.id === selectedId.value))
  const externalBusy = () => options.busy.value || (ocrRunning.value && !ownsOCR.value)
  const collection = useDiscoveryCollection({
    store,
    runtime,
    currentImageId: () => currentImageId.value,
    getProvider: async () => options.provider,
    pendingDeletionIds: () => options.pendingDeletionIds.value,
    busy: externalBusy,
    scope: () => [options.editor.project.value],
  })
  function imageDigest() {
    const checked = verified.value
    return checked?.id === currentImageId.value && checked.file === runtime.cardSourceFile.value && checked.generation === runtime.projectGeneration.value ? checked.digest : null
  }
  const review = useDiscoveryReview({
    store,
    draftCardId: () => currentImageId.value,
    scope: () => [runtime.projectGeneration.value, runtime.cardSourceFile.value, runtime.assetFiles.value, runtime.pendingAssetWrites.value],
    context: () => ({
      cards: allCards.value,
      assetIds: new Set(store.assets.map(asset => asset.id)),
      imageDigests: imageDigest() ? new Map([[currentImageId.value, imageDigest()!]]) : new Map(),
      assetDigests: identity.currentIdentity()?.assetDigests ?? new Map(),
    }),
    busy: () => externalBusy() || collection.running.value,
  })
  const registration = useDiscoveryAssetRegistration({
    store,
    runtime,
    identity,
    review,
    currentImageId,
    createAsset: options.createAsset,
    busy: () => externalBusy() || collection.running.value,
  })
  const working = computed(() => options.busy.value || ocrRunning.value || collection.running.value || registration.running.value || checking.value)
  async function run(action: () => unknown | Promise<unknown>) {
    error.value = ''
    const generation = runtime.projectGeneration.value
    try {
      await action()
    }
    catch (cause) {
      if (!disposed && generation === runtime.projectGeneration.value)
        error.value = cause instanceof Error ? cause.message : String(cause)
    }
  }
  async function verify() {
    const file = runtime.cardSourceFile.value
    const id = currentImageId.value
    const generation = runtime.projectGeneration.value
    if (!file)
      throw new Error('元画像を開いてください。')
    checking.value = true
    try {
      const digest = await digestCache.digest(file)
      if (disposed || file !== runtime.cardSourceFile.value || id !== currentImageId.value || generation !== runtime.projectGeneration.value)
        throw new Error('確認対象が変わりました。候補を選び直してください。')
      verified.value = { id, file, generation, digest }
      await identity.verifyCurrent()
      if (disposed || file !== runtime.cardSourceFile.value || id !== currentImageId.value || generation !== runtime.projectGeneration.value)
        throw new Error('確認対象が変わりました。候補を選び直してください。')
    }
    finally { checking.value = false }
  }
  async function select(id: string) {
    if (working.value)
      return
    await run(async () => {
      const item = occurrences.value.find(item => item.id === id)
      if (!item)
        return
      if (!cards.value.some(card => card.id === item.cardId))
        throw new Error('このカードは削除予定です。削除予定を取り消してから確認してください。')
      creation.value = null
      comparison.value = null
      if (item.cardId !== currentImageId.value)
        await options.selectCard(item.cardId)
      if (disposed || currentImageId.value !== item.cardId)
        return
      await verify()
      selectedId.value = id
    })
  }
  async function collect(ids: readonly string[]) {
    if (working.value)
      return
    await run(async () => {
      creation.value = null
      comparison.value = null
      pending.value = new Map()
      ownsOCR.value = true
      ocrRunning.value = true
      try {
        const result = await collection.start(ids)
        if (!result)
          return
        pending.value = new Map(result.proposals.filter(proposal => result.staged.some(item => item.cardId === proposal.cardId && item.status === 'review')).map(proposal => [proposal.cardId, proposal]))
        notice.value = `${result.cancelled ? '中止' : '収集完了'}：新規${result.staged.filter(item => item.status === 'stored').length}枚、比較待ち${pending.value.size}枚、候補なし${result.staged.filter(item => item.status === 'empty').length}枚、失敗${result.failures.length}枚。プロジェクト保存で候補を保存できます。`
        if (result.limitReached || result.proposals.some(item => item.limitsHit.length) || result.groups.truncated)
          notice.value += ' 処理上限による未探索・未比較があります。対象を絞って確認してください。'
        error.value = [result.groupingError, ...result.failures.map(item => `${cards.value.find(card => card.id === item.cardId)?.imageName ?? item.cardId}: ${item.message}`)].filter(Boolean).join('\n')
      }
      finally {
        ocrRunning.value = false
        ownsOCR.value = false
      }
    })
  }
  async function changeBounds(bounds: RegionDraft, add = false) {
    if (working.value)
      return
    await run(async () => {
      await verify()
      if (add)
        selectedId.value = review.add(currentImageId.value, bounds)
      else if (selectedId.value)
        review.change(selectedId.value, { kind: 'bounds', bounds })
    })
  }
  async function split(axis: 'horizontal' | 'vertical', ratio: number) {
    const item = selected.value
    if (working.value || !item || creation.value)
      return false
    let applied = false
    await run(async () => {
      await verify()
      if (selected.value !== item || item.cardId !== currentImageId.value)
        throw new Error('分割対象が変わりました。候補を選び直してください。')
      const ids = review.split(item.id, axis, ratio)
      selectedId.value = ids[0]!
      notice.value = '2つの未分類候補に分割しました。それぞれ範囲と登録先を確認してください。候補編集を戻す1回で元に戻せます。'
      applied = true
    })
    return applied
  }
  async function prepareRegistration(groupId: string) {
    if (working.value)
      return
    const generation = runtime.projectGeneration.value
    await run(async () => {
      const group = groups.value.find(group => group.id === groupId)
      if (!group)
        throw new Error('登録するグループを選んでください。')
      await select(group.representativeId)
      if (disposed || generation !== runtime.projectGeneration.value || selected.value?.id !== group.representativeId || !groups.value.some(current => current.id === groupId && current.representativeId === group.representativeId))
        throw new Error('グループの代表候補を選び直してください。')
      await verify()
      const item = selected.value!
      if (item.cardId !== currentImageId.value || item.decision === 'excluded' || item.imageDigest !== imageDigest())
        throw new Error('元画像と候補を確認し、除外している場合は除外を取り消してください。')
      creation.value = { editingAssetId: null, name: group?.name || `asset_${store.assets.length + 1}`, sourceRect: { ...item.bounds }, removeBackground: true, backgroundColor: null, backgroundThreshold: 48, edgeFeather: 12, manualMaskStrokes: [] }
      creationGroupId.value = groupId
    })
  }
  async function register() {
    const draft = creation.value
    const id = selected.value?.id
    const groupId = creationGroupId.value
    if (!draft || !id || !groupId || working.value)
      return
    await run(async () => {
      await verify()
      const result = await registration.register(id, draft, { groupId, linkGroupMembers: true, isCurrent: () => creation.value === draft && selectedId.value === id && creationGroupId.value === groupId })
      if (result) {
        notice.value = result.warning ?? 'グループに登録しました。「次へ」で対象カードに反映できます。'
        creation.value = null
      }
    })
  }
  async function compare(cardId: string) {
    if (working.value)
      return
    await run(async () => {
      const proposal = pending.value.get(cardId)
      if (!proposal)
        return
      if (cardId !== currentImageId.value)
        await options.selectCard(cardId)
      await verify()
      comparison.value = review.compare(proposal)
    })
  }
  function adopt(choices: readonly IconProposalChoice[]) {
    if (working.value || !comparison.value)
      return
    void run(() => {
      review.adopt(comparison.value!, choices)
      pending.value = new Map([...pending.value].filter(([id]) => id !== comparison.value!.cardId))
      comparison.value = null
    })
  }
  watch(() => [runtime.projectGeneration.value, runtime.directory.value], () => {
    pending.value = new Map()
    comparison.value = null
    selectedId.value = null
    creation.value = null
    verified.value = null
    digestCache.clear()
  }, { flush: 'sync' })
  watch(() => [currentImageId.value, runtime.cardSourceFile.value, selected.value], () => {
    creation.value = null
  }, { flush: 'sync' })
  watch(creation, (draft) => {
    if (!draft)
      creationGroupId.value = null
  }, { flush: 'sync' })
  onScopeDispose(() => {
    disposed = true
    digestCache.clear()
  })
  return { cards, activeCard, occurrences, groups, selectedId, selected, error, notice, creation, comparison, pending, working, collection, registration, review, run, select, collect, changeBounds, split, prepareRegistration, register, compare, adopt }
}
