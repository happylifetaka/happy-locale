import type { AssetDiscoveryState, IconOccurrence } from '~/types/asset-discovery'
import type { RegionDraft, SourceIcon, TextRegion } from '~/types/editor'
import { intersectionArea, validBounds } from './geometry'

export function sameBounds(a: RegionDraft, b: RegionDraft): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}

export function containsBounds(outer: RegionDraft, inner: RegionDraft): boolean {
  return validBounds(outer) && validBounds(inner) && inner.x >= outer.x && inner.y >= outer.y
    && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height
}

/** 明示的な修正後は、過去の承認を新しい範囲／アセットへ持ち越さない。 */
export function reviseOccurrence(occurrence: IconOccurrence, bounds: RegionDraft, assetId: string | null): IconOccurrence {
  if (!validBounds(bounds) || bounds.x < 0 || bounds.y < 0 || assetId === '')
    throw new Error('アイコン候補の範囲・アイコン指定が不正です。')
  if (sameBounds(bounds, occurrence.bounds) && assetId === occurrence.assetId)
    return occurrence
  return { ...occurrence, bounds: { ...bounds }, assetId, decision: 'pending', approval: null }
}

export function approveOccurrence(occurrence: IconOccurrence, imageDigest: string, assetDigest: string): IconOccurrence {
  if (!imageDigest || occurrence.imageDigest !== imageDigest || !occurrence.assetId || !assetDigest
    || !validBounds(occurrence.bounds) || occurrence.bounds.x < 0 || occurrence.bounds.y < 0) {
    throw new Error('元画像・範囲・登録先を確認してから承認してください。')
  }
  return {
    ...occurrence,
    decision: 'accepted',
    approval: { imageDigest, assetId: occurrence.assetId, assetDigest, bounds: { ...occurrence.bounds } },
  }
}

export function occurrenceIsApproved(occurrence: IconOccurrence, imageDigest: string, assetDigest: string | undefined): boolean {
  const approval = occurrence.approval
  return occurrence.decision === 'accepted' && approval !== null
    && occurrence.imageDigest === imageDigest && approval.imageDigest === imageDigest
    && approval.assetId === occurrence.assetId && Boolean(assetDigest) && approval.assetDigest === assetDigest
    && sameBounds(approval.bounds, occurrence.bounds)
}

/** 記録済みの判断を現在の画像・アセットと照合する。グループの変更は入力に含めない。 */
export function reconcileApprovals(
  occurrences: readonly IconOccurrence[],
  imageDigests: ReadonlyMap<string, string | null>,
  assetDigests: ReadonlyMap<string, string | null>,
): IconOccurrence[] {
  return occurrences.map((occurrence) => {
    // 欠損したエントリは「未読込」、nullは「削除・不在を確認済み」。遅延読込で承認を失わせない。
    const imageDigest = imageDigests.get(occurrence.cardId)
    const assetDigest = assetDigests.get(occurrence.assetId ?? '')
    const approval = occurrence.approval
    const changed = !approval || approval.assetId !== occurrence.assetId || !sameBounds(approval.bounds, occurrence.bounds)
      || (imageDigest !== undefined && (imageDigest !== occurrence.imageDigest || imageDigest !== approval.imageDigest))
      || (assetDigest !== undefined && assetDigest !== approval.assetDigest)
    if (assetDigest === null || (occurrence.decision === 'accepted' && changed))
      return { ...occurrence, decision: 'pending', approval: null, assetId: assetDigest === null ? null : occurrence.assetId }
    return occurrence
  })
}

/** 画像差替えを確認した際は旧座標を保存したまま適用対象から外す。除外判断は維持する。 */
export function invalidateDiscoveryImage(state: AssetDiscoveryState, cardId: string): AssetDiscoveryState {
  return {
    ...state,
    occurrences: state.occurrences.map(occurrence => occurrence.cardId === cardId
      ? { ...occurrence, owner: null, approval: null, decision: occurrence.decision === 'accepted' ? 'pending' : occurrence.decision }
      : occurrence),
  }
}

/** 読めた実バイトだけで承認を検証する。未読込は不在と見なさず、旧画像の所属も再確認へ戻す。 */
export function reconcileDiscoveryContent(
  state: AssetDiscoveryState,
  imageDigests: ReadonlyMap<string, string | null>,
  assetDigests: ReadonlyMap<string, string | null>,
): AssetDiscoveryState {
  const occurrences = reconcileApprovals(state.occurrences, imageDigests, assetDigests).map((occurrence) => {
    const digest = imageDigests.get(occurrence.cardId)
    if (digest !== undefined && digest !== occurrence.imageDigest && occurrence.owner)
      return { ...occurrence, owner: null }
    return occurrence
  })
  return occurrences.every((occurrence, index) => occurrence === state.occurrences[index])
    ? state
    : { ...state, occurrences }
}

interface RegionOwner extends RegionDraft { id: string, kind: 'candidate' | 'region' }

/** 新しい領域へ勝手に再所属させず、消えた／はみ出した参照だけ解除する。 */
export function reconcileOccurrenceOwners(
  occurrences: readonly IconOccurrence[],
  cardId: string,
  owners: readonly RegionOwner[],
  promotedIds: ReadonlyMap<string, string> = new Map(),
): IconOccurrence[] {
  return occurrences.map((occurrence) => {
    if (occurrence.cardId !== cardId || !occurrence.owner)
      return occurrence
    const promoted = occurrence.owner.kind === 'candidate' ? promotedIds.get(occurrence.owner.id) : undefined
    const ref = promoted ? { kind: 'region' as const, id: promoted } : occurrence.owner
    const owner = owners.find(owner => owner.kind === ref.kind && owner.id === ref.id)
    if (!owner || !containsBounds(owner, occurrence.bounds))
      return { ...occurrence, owner: null }
    return promoted ? { ...occurrence, owner: ref } : occurrence
  })
}

/** カード削除の確定時にだけ呼ぶ。候補・グループ内参照の両方を一緒に除く。 */
export function removeDiscoveryCards(state: AssetDiscoveryState, cardIds: ReadonlySet<string>): AssetDiscoveryState {
  const occurrences = state.occurrences.filter(item => !cardIds.has(item.cardId))
  const remaining = new Set(occurrences.map(item => item.id))
  return {
    occurrences,
    groups: state.groups.flatMap((group) => {
      const memberIds = group.memberIds.filter(id => remaining.has(id))
      return memberIds.length
        ? [{ ...group, memberIds, representativeId: memberIds.includes(group.representativeId) ? group.representativeId : memberIds[0]! }]
        : []
    }),
  }
}

/** アセットを削除しても切り抜き候補は残す。グループの登録先提案も解除する。 */
export function removeDiscoveryAssets(state: AssetDiscoveryState, assetIds: ReadonlySet<string>): AssetDiscoveryState {
  return {
    occurrences: state.occurrences.map(item => item.assetId && assetIds.has(item.assetId)
      ? { ...item, assetId: null, approval: null, decision: 'pending' }
      : item),
    groups: state.groups.map(group => group.proposedAssetId && assetIds.has(group.proposedAssetId)
      ? { ...group, proposedAssetId: null }
      : group),
  }
}

/** 仮の領域コピー／明示適用のための差分。既存手動指定を消さず、重複と衝突を区別する。 */
export function proposedSourceIcons(
  region: TextRegion,
  occurrences: readonly IconOccurrence[],
  cardId: string,
  imageDigest: string,
  assetDigests: ReadonlyMap<string, string>,
): SourceIcon[] {
  const icons = (region.sourceIcons ?? []).map(icon => ({ ...icon }))
  for (const occurrence of occurrences) {
    if (occurrence.cardId !== cardId || occurrence.owner?.kind !== 'region' || occurrence.owner.id !== region.id
      || !containsBounds(region, occurrence.bounds)
      || !occurrenceIsApproved(occurrence, imageDigest, assetDigests.get(occurrence.assetId ?? ''))) {
      throw new Error('アイコン候補の承認・所属先を再確認してください。')
    }
    const icon: SourceIcon = {
      id: `discovery-${occurrence.id}`,
      assetId: occurrence.assetId!,
      x: occurrence.bounds.x - region.x,
      y: occurrence.bounds.y - region.y,
      width: occurrence.bounds.width,
      height: occurrence.bounds.height,
    }
    if (icons.some(existing => existing.assetId === icon.assetId && sameBounds(existing, icon)))
      continue
    if (icons.some(existing => existing.id === icon.id || intersectionArea(existing, icon) > 0))
      throw new Error('既存のアイコン指定と重なっています。置き換える範囲を確認してください。')
    icons.push(icon)
  }
  return icons
}
