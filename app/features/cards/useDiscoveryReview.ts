import type { CardIconProposal } from '~/services/asset-discovery/collect'
import type { IconProposalChoice, IconProposalReview } from '~/services/asset-discovery/proposal-review'
import type { DiscoveryReviewContext, OccurrenceAssetChoice, OccurrenceReviewChange, ReviewGroupDestination } from '~/services/asset-discovery/review-operations'
import type { useProjectStore } from '~/stores/project'
import type { AssetDiscoveryState, IconCandidateGroup } from '~/types/asset-discovery'
import type { RegionDraft } from '~/types/editor'
import { computed, onScopeDispose, readonly, ref, shallowRef, watch } from 'vue'
import { parseAssetDiscovery } from '~/services/asset-discovery/format'
import { adoptIconProposal, compareIconProposal } from '~/services/asset-discovery/proposal-review'
import { occurrenceIsApproved } from '~/services/asset-discovery/review'
import { addManualOccurrence, editReviewGroup, linkReviewAsset, linkReviewAssetChoices, moveReviewOccurrences, reviewOccurrence } from '~/services/asset-discovery/review-operations'

interface DiscoveryReviewOptions {
  store: Pick<ReturnType<typeof useProjectStore>, 'assetDiscovery' | 'setAssetDiscovery'>
  context: () => DiscoveryReviewContext
  /** 安定した値の配列。プロジェクト世代、元File、アセットPNGの版などを含める。 */
  scope: () => readonly unknown[]
  draftCardId?: () => string
  busy?: () => boolean
  maximumHistorySteps?: number
  /** JSON文字列のUTF-16コード単位数。実ヒープ使用量の保証ではない。 */
  maximumHistoryCharacters?: number
}

interface ReviewStamp { scope: readonly unknown[], context: string, state: string }
interface ReviewEdit { before: string, after: string }

/** レビューだけの履歴。通常領域のUndo・共有アセット登録とは独立させ、外部変更後は復元しない。 */
export function useDiscoveryReview(options: DiscoveryReviewOptions) {
  const { store, context, scope, draftCardId, busy = () => false, maximumHistorySteps = 30, maximumHistoryCharacters = 2_000_000 } = options
  if (!Number.isSafeInteger(maximumHistorySteps) || maximumHistorySteps < 1 || maximumHistorySteps > 30
    || !Number.isSafeInteger(maximumHistoryCharacters) || maximumHistoryCharacters < 1 || maximumHistoryCharacters > 2_000_000) {
    throw new Error('候補レビューの履歴上限が不正です。')
  }
  const past = shallowRef<ReviewEdit[]>([])
  const future = shallowRef<ReviewEdit[]>([])
  const baseline = shallowRef<ReviewStamp>()
  const disposed = ref(false)
  const historyTruncated = ref(false)
  let writing = false
  let revision = 0
  const comparisons = new WeakMap<IconProposalReview, number>()

  function stamp(): ReviewStamp {
    const current = context()
    const bounds = (item: RegionDraft & { id: string }) => [item.id, item.x, item.y, item.width, item.height]
    return {
      scope: [...scope()],
      state: JSON.stringify(store.assetDiscovery ?? null),
      // 翻訳や表示設定だけの編集・保存では履歴を捨てない。参照・座標の変更では捨てる。
      context: JSON.stringify({
        cards: current.cards.map(card => [card.id, card.imageWidth, card.imageHeight, card.regions.map(bounds), (card.ocrCandidates ?? []).map(bounds)]),
        assets: [...current.assetIds].sort(),
      }),
    }
  }

  function sameStamp(a: ReviewStamp, b: ReviewStamp | undefined): boolean {
    return !!b && a.state === b.state && a.context === b.context && a.scope.length === b.scope.length && a.scope.every((value, index) => value === b.scope[index])
  }

  function clearHistory() {
    revision++
    past.value = []
    future.value = []
    historyTruncated.value = false
    baseline.value = disposed.value ? undefined : stamp()
  }

  function synchronize() {
    if (!sameStamp(stamp(), baseline.value))
      clearHistory()
  }

  watch(stamp, () => {
    if (!writing)
      synchronize()
  }, { immediate: true, flush: 'sync' })

  function assertAvailable() {
    if (disposed.value || busy())
      throw new Error('候補レビューを操作できません。処理が終わってから開き直してください。')
    synchronize()
  }

  function write(next: AssetDiscoveryState | null) {
    writing = true
    try {
      store.setAssetDiscovery(next, draftCardId?.())
      revision++
      baseline.value = stamp()
    }
    finally {
      writing = false
    }
  }

  function apply(operation: (state: AssetDiscoveryState, context: DiscoveryReviewContext) => AssetDiscoveryState): AssetDiscoveryState {
    assertAvailable()
    const current = context()
    const next = operation(store.assetDiscovery ?? { occurrences: [], groups: [] }, current)
    const before = JSON.stringify(store.assetDiscovery ?? null)
    const after = JSON.stringify(next)
    if (before === after)
      return next
    write(next)
    future.value = []
    const history = [...past.value, { before, after }]
    let characters = history.reduce((sum, item) => sum + item.before.length + item.after.length, 0)
    while (history.length > maximumHistorySteps || characters > maximumHistoryCharacters) {
      const removed = history.shift()!
      characters -= removed.before.length + removed.after.length
      historyTruncated.value = true
    }
    past.value = history
    return next
  }

  function restore(serialized: string) {
    const current = context()
    const parsed: unknown = JSON.parse(serialized)
    const next = parsed === null ? null : parseAssetDiscovery(parsed, current)
    for (const occurrence of next?.occurrences ?? []) {
      if (occurrence.decision !== 'accepted')
        continue
      const existing = store.assetDiscovery?.occurrences.find(item => item.id === occurrence.id)
      const imageDigest = current.imageDigests.get(occurrence.cardId)
      const assetDigest = current.assetDigests.get(occurrence.assetId ?? '')
      // グループ整理のUndoでは既にある同一の承認を維持できる。失った承認の復元は再照合が必要。
      const alreadyApproved = existing?.decision === 'accepted' && JSON.stringify(existing.approval) === JSON.stringify(occurrence.approval)
      if ((imageDigest !== undefined && imageDigest !== occurrence.imageDigest)
        || (assetDigest !== undefined && assetDigest !== occurrence.approval!.assetDigest)
        || (!alreadyApproved && !occurrenceIsApproved(occurrence, imageDigest ?? '', assetDigest))) {
        throw new Error('履歴の承認対象画像を確認できません。現在の画像を読み込んでからやり直してください。')
      }
    }
    write(next)
  }

  function undo(): boolean {
    assertAvailable()
    const entry = past.value.at(-1)
    if (!entry)
      return false
    restore(entry.before)
    past.value = past.value.slice(0, -1)
    future.value = [...future.value, entry]
    return true
  }

  function redo(): boolean {
    assertAvailable()
    const entry = future.value.at(-1)
    if (!entry)
      return false
    restore(entry.after)
    future.value = future.value.slice(0, -1)
    past.value = [...past.value, entry]
    return true
  }

  const available = computed(() => !disposed.value && !busy() && sameStamp(stamp(), baseline.value))
  onScopeDispose(() => {
    disposed.value = true
    past.value = []
    future.value = []
    baseline.value = undefined
  })

  return {
    canUndo: computed(() => available.value && past.value.length > 0),
    canRedo: computed(() => available.value && future.value.length > 0),
    historyTruncated: readonly(historyTruncated),
    clearHistory,
    undo,
    redo,
    compare(proposal: CardIconProposal): IconProposalReview {
      assertAvailable()
      const comparison = compareIconProposal(store.assetDiscovery ?? { occurrences: [], groups: [] }, proposal, context())
      comparisons.set(comparison, revision)
      return comparison
    },
    adopt(comparison: IconProposalReview, choices: readonly IconProposalChoice[]): ReadonlyMap<string, string> {
      assertAvailable()
      if (comparisons.get(comparison) !== revision)
        throw new Error('比較後にレビューや画像が変わりました。再比較してください。')
      if (!choices.length)
        return adoptIconProposal(store.assetDiscovery ?? { occurrences: [], groups: [] }, comparison, choices, context()).adoptedIds
      let adoptedIds: ReadonlyMap<string, string> = new Map()
      apply((state, ctx) => {
        const result = adoptIconProposal(state, comparison, choices, ctx)
        adoptedIds = result.adoptedIds
        return result.state
      })
      return adoptedIds
    },
    add(cardId: string, bounds: RegionDraft) {
      return apply((state, ctx) => addManualOccurrence(state, cardId, bounds, ctx)).occurrences.at(-1)!.id
    },
    change(id: string, change: OccurrenceReviewChange) {
      apply((state, ctx) => reviewOccurrence(state, id, change, ctx))
    },
    /** 明示選択した出現箇所と任意のグループ提案だけを関連付ける。登録自体・承認は履歴に混ぜない。 */
    linkAsset(ids: readonly string[], assetId: string | null, groupId?: string) {
      apply((state, ctx) => linkReviewAsset(state, ids, assetId, groupId, ctx))
    },
    linkAssetChoices(choices: readonly OccurrenceAssetChoice[]) {
      apply((state, ctx) => linkReviewAssetChoices(state, choices, ctx))
    },
    move(ids: readonly string[], destination: ReviewGroupDestination) {
      apply((state, ctx) => moveReviewOccurrences(state, ids, destination, ctx))
    },
    editGroup(id: string, patch: Partial<Pick<IconCandidateGroup, 'name' | 'representativeId' | 'proposedAssetId'>>) {
      apply((state, ctx) => editReviewGroup(state, id, patch, ctx))
    },
  }
}
