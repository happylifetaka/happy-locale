import type { IconDiscoveryBatchOptions } from './batch'
import type { CardIconProposal } from './collect'
import type { IconGroupProposal } from './group'
import type { DiscoveryReviewContext } from './review-operations'
import type { AssetDiscoveryState, IconOccurrence } from '~/types/asset-discovery'
import { collectIconDiscoveryBatch } from './batch'
import { ASSET_DISCOVERY_LIMITS, parseAssetDiscovery } from './format'
import { compareIconProposal } from './proposal-review'

type CollectionContext = Pick<DiscoveryReviewContext, 'cards' | 'assetIds'>

export interface InitialIconCollection {
  readonly cardId: string
  readonly addedIds: readonly string[]
}
// 初回収集分だけを識別する一時的な控え。保存JSON・Undoへ入れない。
const receipts = new WeakMap<InitialIconCollection, { occurrences: readonly IconOccurrence[], card: string }>()

function cardSignature(context: CollectionContext, cardId: string): string {
  const card = context.cards.find(card => card.id === cardId)
  if (!card)
    return 'missing'
  const bounds = (item: { id: string, x: number, y: number, width: number, height: number }) => [item.id, item.x, item.y, item.width, item.height]
  return JSON.stringify([card.id, card.imageWidth, card.imageHeight, card.regions.map(bounds), (card.ocrCandidates ?? []).map(bounds)])
}

/** 初回だけ全候補を未確認で保存可能にする。再収集では手動編集・除外・グループを置換しない。 */
export function stageInitialCardIcons(state: AssetDiscoveryState | undefined, proposal: CardIconProposal, context: DiscoveryReviewContext) {
  const current = parseAssetDiscovery(state ?? { occurrences: [], groups: [] }, context)
  // 新しい提案に承認済みデータ・別画像・壊れた所属が混ざっていないことを確認する。
  const checked = compareIconProposal({ occurrences: [], groups: [] }, proposal, context)
  if (current.occurrences.some(item => item.cardId === proposal.cardId))
    return { kind: 'review' as const, state: current, receipt: null }
  const next = parseAssetDiscovery({ occurrences: [...current.occurrences, ...checked.occurrences], groups: current.groups }, context)
  const receipt: InitialIconCollection = Object.freeze({ cardId: proposal.cardId, addedIds: Object.freeze(checked.occurrences.map(item => item.id)) })
  receipts.set(receipt, { occurrences: structuredClone(checked.occurrences), card: cardSignature(context, proposal.cardId) })
  return { kind: 'initial' as const, state: next, receipt }
}

/** 今回追加したままの未確認・未分類候補だけをまとめる。既存グループや途中の手動判断は維持する。 */
export function groupInitialCollectedIcons(state: AssetDiscoveryState, groups: IconGroupProposal, collected: readonly InitialIconCollection[], context: CollectionContext): AssetDiscoveryState {
  if (groups.groups.length > ASSET_DISCOVERY_LIMITS.project || groups.groups.reduce((sum, group) => sum + group.memberIds.length, 0) > ASSET_DISCOVERY_LIMITS.project)
    throw new Error('類似グループ提案が件数上限を超えています。')
  const next = parseAssetDiscovery(state, context)
  const eligible = new Set<string>()
  const alreadyGrouped = new Set(next.groups.flatMap(group => group.memberIds))
  for (const receipt of collected) {
    const snapshot = receipts.get(receipt)
    if (!snapshot)
      throw new Error('この収集で追加した候補を指定してください。')
    if (snapshot.card !== cardSignature(context, receipt.cardId))
      continue
    for (const original of snapshot.occurrences) {
      const current = next.occurrences.find(item => item.id === original.id)
      if (current && !alreadyGrouped.has(current.id) && JSON.stringify(current) === JSON.stringify(original))
        eligible.add(current.id)
    }
  }
  const seen = new Set<string>()
  for (const proposal of groups.groups) {
    if (!proposal.memberIds.length || !proposal.memberIds.includes(proposal.representativeId) || proposal.memberIds.some(id => seen.has(id)) || new Set(proposal.memberIds).size !== proposal.memberIds.length)
      throw new Error('類似グループ提案の所属・代表が不正です。')
    proposal.memberIds.forEach(id => seen.add(id))
    const ids = proposal.memberIds.filter(id => eligible.has(id))
    if (ids.length) {
      next.groups.push({ id: crypto.randomUUID(), name: '', memberIds: ids, representativeId: ids.includes(proposal.representativeId) ? proposal.representativeId : ids[0]!, proposedAssetId: null })
    }
  }
  return parseAssetDiscovery(next, context)
}

interface StoredIconCollectionOptions {
  batch: Omit<IconDiscoveryBatchOptions, 'onCard' | 'onError'>
  store: { readonly assetDiscovery: AssetDiscoveryState | undefined, setAssetDiscovery: (state: AssetDiscoveryState, cardId?: string) => void }
  context: () => CollectionContext
  draftCardId?: string
}

export interface StagedCardIcons {
  cardId: string
  status: 'stored' | 'empty' | 'review'
  addedIds: readonly string[]
}

/** オプトイン収集の保存接続。完了カードを保存対象のStoreへ反映し、既存候補は比較案に留める。 */
export async function collectStoredIconDiscoveryBatch({ batch, store, context, draftCardId }: StoredIconCollectionOptions) {
  const snapshots = structuredClone(batch.cards)
  const collected: InitialIconCollection[] = []
  const staged: StagedCardIcons[] = []
  const result = await collectIconDiscoveryBatch({
    ...batch,
    cards: snapshots,
    onCard: (proposal) => {
      const ctx: DiscoveryReviewContext = { ...context(), imageDigests: new Map([[proposal.cardId, proposal.imageDigest]]), assetDigests: new Map() }
      const prepared = stageInitialCardIcons(store.assetDiscovery, proposal, ctx)
      if (prepared.kind === 'review') {
        staged.push({ cardId: proposal.cardId, status: 'review', addedIds: [] })
        return
      }
      if (prepared.receipt.addedIds.length)
        store.setAssetDiscovery(prepared.state, draftCardId)
      collected.push(prepared.receipt)
      staged.push({ cardId: proposal.cardId, status: prepared.receipt.addedIds.length ? 'stored' : 'empty', addedIds: prepared.receipt.addedIds })
    },
    onError: () => {}, // 詳細はキューのfailuresに保持し、完了済みカードを巻き戻さない。
  })
  let groupingError: string | null = null
  if (batch.isCurrent() && collected.some(item => item.addedIds.length) && store.assetDiscovery) {
    try {
      // 中止時も完了分は残す。変更済みカードの出現は自動グループ化から除く。
      const validReceipts = collected.filter((item) => {
        const snapshot = snapshots.find(card => card.id === item.cardId)
        return snapshot && batch.cardIsCurrent(snapshot)
      })
      const before = store.assetDiscovery
      const next = groupInitialCollectedIcons(before, result.groups, validReceipts, context())
      if (JSON.stringify(next) !== JSON.stringify(before))
        store.setAssetDiscovery(next, draftCardId)
    }
    catch (error) {
      groupingError = `候補は保持していますが、類似グループを反映できませんでした。${error instanceof Error ? error.message : String(error)}`
    }
  }
  return { ...result, staged, groupingError }
}
