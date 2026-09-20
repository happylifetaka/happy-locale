import type { DiscoveryCard } from './collect'
import type { AssetDiscoveryState, IconCandidateGroup, IconOccurrence } from '~/types/asset-discovery'
import type { RegionDraft } from '~/types/editor'
import { parseAssetDiscovery } from './format'
import { groupAssetState } from './group-asset'
import { approveOccurrence, containsBounds, reviseOccurrence } from './review'
import { splitIconBounds } from './split'

export interface DiscoveryReviewContext {
  cards: readonly DiscoveryCard[]
  assetIds: ReadonlySet<string>
  /** 現在の実ファイルから確認できた値だけを渡す。未読込は含めない。 */
  imageDigests: ReadonlyMap<string, string>
  assetDigests: ReadonlyMap<string, string>
}

export type OccurrenceReviewChange
  = { kind: 'bounds', bounds: RegionDraft }
    | { kind: 'asset', assetId: string | null }
    | { kind: 'owner', owner: IconOccurrence['owner'] }
    | { kind: 'decision', decision: 'pending' | 'excluded' }
    | { kind: 'approve' }

function currentImage(context: DiscoveryReviewContext, cardId: string) {
  const card = context.cards.find(card => card.id === cardId)
  const digest = context.imageDigests.get(cardId)
  if (!card || !digest)
    throw new Error('現在の元画像を読み込んでから候補を確認してください。')
  return { card, digest }
}

function matchingImage(context: DiscoveryReviewContext, occurrence: IconOccurrence) {
  const current = currentImage(context, occurrence.cardId)
  if (current.digest !== occurrence.imageDigest || current.card.imageWidth !== occurrence.imageSize.width || current.card.imageHeight !== occurrence.imageSize.height)
    throw new Error('元画像が変わっています。新しい画像の候補を再抽出・確認してください。')
  return current
}

/** 手動追加も自動抽出と同じ座標・件数・参照の検証を通す。追加だけでは承認しない。 */
export function addManualOccurrence(state: AssetDiscoveryState, cardId: string, bounds: RegionDraft, context: DiscoveryReviewContext): AssetDiscoveryState {
  const next = parseAssetDiscovery(state, context)
  const { card, digest } = currentImage(context, cardId)
  const owners = [
    ...card.regions.map(region => ({ ...region, kind: 'region' as const })),
    ...(card.ocrCandidates ?? []).map(candidate => ({ ...candidate, kind: 'candidate' as const })),
  ].filter(owner => containsBounds(owner, bounds))
  next.occurrences.push({
    id: crypto.randomUUID(),
    cardId,
    imageDigest: digest,
    imageSize: { width: card.imageWidth, height: card.imageHeight },
    bounds: { ...bounds },
    detectedBounds: null,
    origin: 'manual',
    detectorRevision: 'manual-v1',
    decision: 'pending',
    assetId: null,
    approval: null,
    owner: owners.length === 1 ? { kind: owners[0]!.kind, id: owners[0]!.id } : null,
  })
  return parseAssetDiscovery(next, context)
}

/** 一回のレビュー操作を独立コピーへ適用する。元の状態と確定領域は変更しない。 */
export function reviewOccurrence(state: AssetDiscoveryState, id: string, change: OccurrenceReviewChange, context: DiscoveryReviewContext): AssetDiscoveryState {
  const next = parseAssetDiscovery(state, context)
  const index = next.occurrences.findIndex(item => item.id === id)
  const item = next.occurrences[index]
  if (!item)
    throw new Error('確認対象のアイコン候補が見つかりません。')
  let revised: IconOccurrence
  switch (change.kind) {
    case 'bounds': {
      const { card } = matchingImage(context, item)
      revised = reviseOccurrence(item, change.bounds, item.assetId)
      const owner = item.owner?.kind === 'candidate'
        ? card.ocrCandidates?.find(owner => owner.id === item.owner!.id)
        : card.regions.find(owner => owner.id === item.owner?.id)
      if (!owner || !containsBounds(owner, revised.bounds))
        revised = { ...revised, owner: null }
      break
    }
    case 'asset':
      revised = reviseOccurrence(item, item.bounds, change.assetId)
      break
    case 'owner':
      if (change.owner)
        matchingImage(context, item)
      revised = { ...item, owner: change.owner ? { ...change.owner } : null }
      break
    case 'decision':
      revised = { ...item, decision: change.decision, approval: null }
      break
    case 'approve': {
      const { digest } = matchingImage(context, item)
      const assetDigest = context.assetDigests.get(item.assetId ?? '')
      if (!assetDigest)
        throw new Error('登録先アセットの画像を読み込んでから承認してください。')
      revised = approveOccurrence(item, digest, assetDigest)
      break
    }
  }
  next.occurrences[index] = revised
  return parseAssetDiscovery(next, context)
}

export type ReviewGroupDestination
  = { kind: 'existing', id: string }
    | { kind: 'new', id: string, name: string }
    | { kind: 'ungrouped' }

/** 元候補を二つの未確認・未割当候補に置換する。失敗時も元データを変更しない。 */
export function splitReviewOccurrence(state: AssetDiscoveryState, id: string, axis: 'horizontal' | 'vertical', ratio: number, context: DiscoveryReviewContext): AssetDiscoveryState {
  const item = state.occurrences.find(item => item.id === id)
  if (!item)
    throw new Error('分割するアイコン候補を選び直してください。')
  matchingImage(context, item)
  const parts = splitIconBounds(item.bounds, axis, ratio)
  let next = moveReviewOccurrences(state, [id], { kind: 'ungrouped' }, context)
  next.occurrences = next.occurrences.filter(item => item.id !== id)
  for (const bounds of parts)
    next = addManualOccurrence(next, item.cardId, bounds, context)
  return next
}

/** 移動・統合・分割は所属一覧だけを変える。グループの登録先を個別候補に伝播させない。 */
export function moveReviewOccurrences(
  state: AssetDiscoveryState,
  ids: readonly string[],
  destination: ReviewGroupDestination,
  context: DiscoveryReviewContext,
): AssetDiscoveryState {
  const next = parseAssetDiscovery(state, context)
  const selected = new Set(ids)
  if (!ids.length || selected.size !== ids.length || ids.some(id => !next.occurrences.some(item => item.id === id)))
    throw new Error('移動するアイコン候補を選び直してください。')
  const target = destination.kind === 'existing' ? next.groups.find(group => group.id === destination.id) : undefined
  if (destination.kind === 'existing' && !target)
    throw new Error('移動先グループが見つかりません。')
  if (destination.kind === 'new' && next.groups.some(group => group.id === destination.id))
    throw new Error('新しいグループのIDが重複しています。')
  next.groups = next.groups.flatMap((group) => {
    if (group.id === target?.id)
      return [group]
    const memberIds = group.memberIds.filter(id => !selected.has(id))
    return memberIds.length
      ? [{ ...group, memberIds, representativeId: memberIds.includes(group.representativeId) ? group.representativeId : memberIds[0]! }]
      : []
  })
  if (target) {
    target.memberIds.push(...ids.filter(id => !target.memberIds.includes(id)))
  }
  else if (destination.kind === 'new') {
    next.groups.push({ id: destination.id, memberIds: [...ids], representativeId: ids[0]!, name: destination.name, proposedAssetId: null })
  }
  return parseAssetDiscovery(next, context)
}

/** 代表・名前・登録先の提案はグループだけの情報。個別の承認／登録先には影響させない。 */
export function editReviewGroup(
  state: AssetDiscoveryState,
  id: string,
  patch: Partial<Pick<IconCandidateGroup, 'name' | 'representativeId' | 'proposedAssetId'>>,
  context: DiscoveryReviewContext,
): AssetDiscoveryState {
  const next = parseAssetDiscovery(state, context)
  const group = next.groups.find(group => group.id === id)
  if (!group)
    throw new Error('確認対象のグループが見つかりません。')
  if (patch.name !== undefined)
    group.name = patch.name
  if (patch.representativeId !== undefined)
    group.representativeId = patch.representativeId
  if (patch.proposedAssetId !== undefined)
    group.proposedAssetId = patch.proposedAssetId
  return parseAssetDiscovery(next, context)
}

/** 明示選択した出現箇所だけを一括関連付けする。除外判断と未選択候補は保持し、承認はしない。 */
export function linkReviewAsset(state: AssetDiscoveryState, ids: readonly string[], assetId: string | null, groupId: string | undefined, context: DiscoveryReviewContext): AssetDiscoveryState {
  const next = parseAssetDiscovery(state, context)
  const selected = new Set(ids)
  const existing = new Set(next.occurrences.map(item => item.id))
  if (!ids.length || selected.size !== ids.length || ids.some(id => !existing.has(id)))
    throw new Error('関連付けるアイコン候補を一つずつ選んでください。')
  if (groupId !== undefined) {
    const group = next.groups.find(group => group.id === groupId)
    if (!group || ids.some(id => !group.memberIds.includes(id)))
      throw new Error('関連付ける候補のグループを確認してください。')
    group.proposedAssetId = assetId
  }
  next.occurrences = next.occurrences.map((item) => {
    if (!selected.has(item.id))
      return item
    const revised = reviseOccurrence(item, item.bounds, assetId)
    return item.decision === 'excluded' ? { ...revised, decision: 'excluded' } : revised
  })
  return parseAssetDiscovery(next, context)
}

export interface OccurrenceAssetChoice { occurrenceId: string, assetId: string }

/** UIで指定した一つのアセットを全メンバーへ関連付ける。承認は別操作。 */
export function linkReviewGroupAsset(state: AssetDiscoveryState, groupId: string, assetId: string | null, context: DiscoveryReviewContext): AssetDiscoveryState {
  const group = state.groups.find(group => group.id === groupId)
  if (!group)
    throw new Error('関連付けるグループが見つかりません。')
  return linkReviewAsset(state, group.memberIds, assetId, groupId, context)
}

/** グループ移動では移動先のアセットを引き継ぎ、未分類／新規グループでは解除する。 */
export function moveReviewOccurrencesWithAsset(state: AssetDiscoveryState, ids: readonly string[], destination: ReviewGroupDestination, context: DiscoveryReviewContext): AssetDiscoveryState {
  const target = destination.kind === 'existing' ? state.groups.find(group => group.id === destination.id) : undefined
  const assignment = target ? groupAssetState(state, target) : { assetId: null, needsSync: false }
  if (assignment.needsSync)
    throw new Error('移動先グループのアセット割当が揃っていません。先にグループ全体へ関連付けてください。')
  const next = moveReviewOccurrences(state, ids, destination, context)
  return linkReviewAsset(next, ids, assignment.assetId, undefined, context)
}

/** 出現箇所ごとに異なる登録先を一括採用する。全件を検証し、一件でも不正なら反映しない。 */
export function linkReviewAssetChoices(state: AssetDiscoveryState, choices: readonly OccurrenceAssetChoice[], context: DiscoveryReviewContext): AssetDiscoveryState {
  const next = parseAssetDiscovery(state, context)
  const assignments = new Map(choices.map(choice => [choice.occurrenceId, choice.assetId]))
  const existing = new Map(next.occurrences.map(item => [item.id, item]))
  if (!choices.length || assignments.size !== choices.length
    || choices.some(choice => !existing.has(choice.occurrenceId) || existing.get(choice.occurrenceId)!.decision === 'excluded' || !context.assetIds.has(choice.assetId))) {
    throw new Error('関連付ける候補とアセットを一つずつ選び直してください。')
  }
  next.occurrences = next.occurrences.map((item) => {
    const assetId = assignments.get(item.id)
    return assetId === undefined ? item : reviseOccurrence(item, item.bounds, assetId)
  })
  return parseAssetDiscovery(next, context)
}
