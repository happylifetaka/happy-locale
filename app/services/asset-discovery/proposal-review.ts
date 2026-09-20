import type { CardIconProposal, DiscoveryCard } from './collect'
import type { DiscoveryReviewContext } from './review-operations'
import type { AssetDiscoveryState, IconOccurrence } from '~/types/asset-discovery'
import type { RegionDraft } from '~/types/editor'
import { parseAssetDiscovery } from './format'
import { intersectionArea } from './geometry'
import { containsBounds, sameBounds } from './review'

export interface IconProposalDifference {
  status: 'new' | 'changed' | 'unchanged' | 'missing' | 'ambiguous' | 'source-changed'
  detectedId: string | null
  occurrenceIds: readonly string[]
  /** 同じ抽出結果の中で対応が曖昧な候補。黙って新規追加しない。 */
  peerIds: readonly string[]
  hasUserReview: boolean
}

export interface IconProposalReview {
  readonly cardId: string
  readonly imageDigest: string
  readonly occurrences: readonly IconOccurrence[]
  readonly differences: readonly IconProposalDifference[]
  readonly limitsHit: readonly CardIconProposal['limitsHit'][number][]
}

export type IconProposalChoice
  = { detectedId: string, action: 'add' }
    | { detectedId: string, action: 'replace', occurrenceId: string }

// 未適用の差分はセッション内だけ。保存JSONや呼出元が編集する選択配列へ基準値を混ぜない。
const snapshots = new WeakMap<IconProposalReview, { state: string, card: string }>()

function cardSnapshot(card: DiscoveryCard): string {
  const rect = (item: RegionDraft & { id: string }) => [item.id, item.x, item.y, item.width, item.height]
  return JSON.stringify([card.id, card.imageWidth, card.imageHeight, card.regions.map(rect), (card.ocrCandidates ?? []).map(rect)])
}

function checkedCard(cardId: string, digest: string, context: DiscoveryReviewContext): DiscoveryCard {
  const card = context.cards.find(card => card.id === cardId)
  if (!card || !/^[a-f0-9]{64}$/u.test(digest) || context.imageDigests.get(cardId) !== digest)
    throw new Error('再抽出した元画像を確認できません。現在の画像を読み込んで再比較してください。')
  return card
}

function freezeTree<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freezeTree)
    Object.freeze(value)
  }
  return value
}

function overlaps(a: RegionDraft, b: RegionDraft): boolean {
  const overlap = intersectionArea(a, b)
  return overlap / Math.min(a.width * a.height, b.width * b.height) >= 0.5
    || overlap / (a.width * a.height + b.width * b.height - overlap) >= 0.2
}

function hasUserReview(item: IconOccurrence): boolean {
  return item.origin === 'manual' || item.decision !== 'pending' || item.assetId !== null
    || !item.detectedBounds || !sameBounds(item.bounds, item.detectedBounds)
}

function sameSource(a: IconOccurrence, b: IconOccurrence): boolean {
  return a.imageDigest === b.imageDigest && a.imageSize.width === b.imageSize.width && a.imageSize.height === b.imageSize.height
}

/** 調整前の検出枠も対応の手掛かりにするが、現在の枠・除外・承認を自動変更しない。 */
export function compareIconProposal(state: AssetDiscoveryState, proposal: CardIconProposal, context: DiscoveryReviewContext): IconProposalReview {
  const current = parseAssetDiscovery(state, context)
  const card = checkedCard(proposal.cardId, proposal.imageDigest, context)
  if (proposal.imageSize.width !== card.imageWidth || proposal.imageSize.height !== card.imageHeight)
    throw new Error('再抽出後に元画像の寸法が変わりました。再比較してください。')
  const incoming = parseAssetDiscovery({ occurrences: proposal.occurrences, groups: [] }, context).occurrences
  if (incoming.some(item => item.cardId !== card.id || item.imageDigest !== proposal.imageDigest
    || item.imageSize.width !== card.imageWidth || item.imageSize.height !== card.imageHeight
    || item.origin !== 'detected' || item.decision !== 'pending' || item.assetId !== null || item.approval !== null
    || !item.detectedBounds || !sameBounds(item.bounds, item.detectedBounds))) {
    throw new Error('再抽出候補に別画像や確認済みの状態が混在しています。')
  }
  const previous = current.occurrences.filter(item => item.cardId === card.id)
  if (previous.some(item => item.imageDigest !== proposal.imageDigest && (item.approval || item.owner)))
    throw new Error('元画像の変更に伴う承認・所属の再確認を済ませてから比較してください。')
  const matches = incoming.map(next => previous.filter(old => sameSource(old, next)
    && (overlaps(old.bounds, next.bounds) || (old.detectedBounds && overlaps(old.detectedBounds, next.bounds)))))
  const counts = new Map<string, number>()
  matches.flat().forEach(item => counts.set(item.id, (counts.get(item.id) ?? 0) + 1))
  const differences: IconProposalDifference[] = incoming.map((next, index) => {
    const targets = matches[index]!
    const peers = incoming.filter(other => other.id !== next.id && overlaps(other.bounds, next.bounds)).map(other => other.id)
    const ambiguous = peers.length > 0 || targets.length > 1 || targets.some(item => counts.get(item.id)! > 1)
    return {
      detectedId: next.id,
      occurrenceIds: targets.map(item => item.id),
      peerIds: peers,
      hasUserReview: targets.some(hasUserReview),
      status: ambiguous ? 'ambiguous' : !targets.length ? 'new' : sameBounds(targets[0]!.bounds, next.bounds) ? 'unchanged' : 'changed',
    }
  })
  for (const item of previous) {
    if (!counts.has(item.id)) {
      differences.push({
        status: item.imageDigest !== proposal.imageDigest || item.imageSize.width !== card.imageWidth || item.imageSize.height !== card.imageHeight ? 'source-changed' : 'missing',
        detectedId: null,
        occurrenceIds: [item.id],
        peerIds: [],
        hasUserReview: hasUserReview(item),
      })
    }
  }
  const review = freezeTree({ cardId: card.id, imageDigest: proposal.imageDigest, occurrences: incoming, differences, limitsHit: [...proposal.limitsHit] })
  snapshots.set(review, { state: JSON.stringify(current), card: cardSnapshot(card) })
  return review
}

/** 選んだ追加／置換だけを適用する。未検出・未選択・グループは残し、曖昧な対応先は明示させる。 */
export function adoptIconProposal(
  state: AssetDiscoveryState,
  review: IconProposalReview,
  choices: readonly IconProposalChoice[],
  context: DiscoveryReviewContext,
): { state: AssetDiscoveryState, adoptedIds: ReadonlyMap<string, string> } {
  const snapshot = snapshots.get(review)
  const next = parseAssetDiscovery(state, context)
  const card = checkedCard(review.cardId, review.imageDigest, context)
  if (!snapshot || snapshot.state !== JSON.stringify(next) || snapshot.card !== cardSnapshot(card))
    throw new Error('比較後に候補・所属領域が変わりました。再比較してください。')
  if (choices.length > review.occurrences.length || new Set(choices.map(choice => choice.detectedId)).size !== choices.length)
    throw new Error('採用する再抽出候補の指定が重複・過大です。')
  const incoming = new Map(review.occurrences.map(item => [item.id, item]))
  const existingIds = new Set(next.occurrences.map(item => item.id))
  const chosenIds = new Set(choices.map(choice => choice.detectedId))
  const usedTargets = new Set<string>()
  const adoptedIds = new Map<string, string>()
  for (const choice of choices) {
    const detected = incoming.get(choice.detectedId)
    const difference = review.differences.find(item => item.detectedId === choice.detectedId)
    if (!detected || !difference)
      throw new Error('採用する再抽出候補が見つかりません。')
    if (choice.action === 'add') {
      if (difference.occurrenceIds.length || difference.peerIds.some(id => chosenIds.has(id)) || next.occurrences.some(item => item.id === detected.id))
        throw new Error('既存候補または別の検出候補と対応が重なっています。新規追加ではなく対応先を確認してください。')
      next.occurrences.push(structuredClone(detected))
      adoptedIds.set(detected.id, detected.id)
      continue
    }
    const index = next.occurrences.findIndex(item => item.id === choice.occurrenceId)
    const previous = next.occurrences[index]
    if (choice.action !== 'replace' || !previous || !existingIds.has(previous.id) || previous.cardId !== review.cardId || usedTargets.has(previous.id))
      throw new Error('置換先は同じカードの既存候補を一つずつ選んでください。')
    usedTargets.add(previous.id)
    adoptedIds.set(detected.id, previous.id)
    if (sameSource(previous, detected) && sameBounds(previous.bounds, detected.bounds))
      continue
    const owner = previous.owner?.kind === 'candidate'
      ? card.ocrCandidates?.find(owner => owner.id === previous.owner!.id)
      : card.regions.find(owner => owner.id === previous.owner?.id)
    next.occurrences[index] = {
      ...structuredClone(detected),
      id: previous.id,
      assetId: previous.assetId,
      decision: previous.decision === 'excluded' ? 'excluded' : 'pending',
      approval: null,
      owner: sameSource(previous, detected) && owner && containsBounds(owner, detected.bounds) ? previous.owner : null,
    }
  }
  return { state: parseAssetDiscovery(next, context), adoptedIds }
}
