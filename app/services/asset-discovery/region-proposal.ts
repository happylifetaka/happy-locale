import type { ComparedRegion, RegionDetectionDifference } from './region-comparison'
import type { RegionDraft, TextRegion } from '~/types/editor'
import type { RegionCandidate } from '~/types/ocr'
import { parseRegionCandidates } from '~/services/ocr/candidate-format'
import { assertImageDimensions, FILE_LIMITS } from '~/utils/file-limits'
import { intersectionArea } from './geometry'
import { compareRegionDetections, rebaseRegionBounds } from './region-comparison'
import { containsBounds, sameBounds } from './review'

export interface RegionReviewCard {
  id: string
  imageWidth: number
  imageHeight: number
  regions: TextRegion[]
  ocrCandidates?: RegionCandidate[]
}

export interface RegionProposalScope {
  /** レビューを開くたびに生成するセッション識別子。保存文書には入れない。 */
  session: symbol
  /** 現在の元ファイルから確認したSHA-256。名前や寸法から推測しない。 */
  imageDigest: string
  /** 呼出元が管理する単調増加の世代。画像変更・編集・Undo・再開で進める。 */
  revision: number
}

export interface RegionDetectionProposal {
  cardId: string
  imageDigest: string
  imageWidth: number
  imageHeight: number
  candidates: readonly RegionCandidate[]
}

export interface RegionProposalDifference extends RegionDetectionDifference {
  /** 同じ検出結果内の重複候補。双方を新規追加しない。 */
  peerIds: readonly string[]
}

export interface RegionProposalReview {
  readonly cardId: string
  readonly imageDigest: string
  readonly existing: readonly (ComparedRegion & { text: string })[]
  readonly candidates: readonly RegionCandidate[]
  readonly differences: readonly RegionProposalDifference[]
}

export type RegionProposalChoice
  = { action: 'add-candidate', detectedId: string }
    | { action: 'bounds', detectedId: string, target: { kind: 'candidate' | 'region', id: string } }

const snapshots = new WeakMap<RegionProposalReview, { card: string, revision: number, session: symbol }>()

function freezeTree<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freezeTree)
    Object.freeze(value)
  }
  return value
}

function snapshot(card: RegionReviewCard): string {
  return JSON.stringify([card.id, card.imageWidth, card.imageHeight, card.regions, card.ocrCandidates ?? []])
}

function bounds(item: RegionDraft): RegionDraft {
  return { x: item.x, y: item.y, width: item.width, height: item.height }
}

function checkedCard(card: RegionReviewCard, scope: RegionProposalScope): RegionCandidate[] {
  assertImageDimensions(card.imageWidth, card.imageHeight)
  if (!card.id.trim() || typeof scope.session !== 'symbol' || !/^[a-f0-9]{64}$/u.test(scope.imageDigest) || !Number.isSafeInteger(scope.revision) || scope.revision < 0
    || card.regions.length > FILE_LIMITS.projectRegionsPerCard || new Set(card.regions.map(item => item.id)).size !== card.regions.length
    || card.regions.some(item => !item.id.trim() || !containsBounds({ x: 0, y: 0, width: card.imageWidth, height: card.imageHeight }, item))) {
    throw new Error('比較するカード・元画像・領域が不正です。')
  }
  return parseRegionCandidates(card.ocrCandidates ?? [], card.imageWidth, card.imageHeight)
}

function overlaps(a: RegionDraft, b: RegionDraft): boolean {
  const overlap = intersectionArea(a, b)
  return overlap / Math.min(a.width * a.height, b.width * b.height) >= 0.5
    || overlap / (a.width * a.height + b.width * b.height - overlap) >= 0.2
}

/** 既存の確定領域と未確定候補を一緒に比較する。未検出は削除に変換しない。 */
export function compareRegionProposal(card: RegionReviewCard, proposal: RegionDetectionProposal, scope: RegionProposalScope): RegionProposalReview {
  const previous = checkedCard(card, scope)
  if (proposal.cardId !== card.id || proposal.imageDigest !== scope.imageDigest || proposal.imageWidth !== card.imageWidth || proposal.imageHeight !== card.imageHeight)
    throw new Error('再検出した元画像が現在のカードと異なります。再比較してください。')
  const candidates = parseRegionCandidates(proposal.candidates, card.imageWidth, card.imageHeight)
  if ((card.regions.length + previous.length + candidates.length) * candidates.length > 1_000_000)
    throw new Error('領域比較の上限を超えています。対象を分けてください。')
  const existing = [
    ...card.regions.map(item => ({ ...bounds(item), id: item.id, kind: 'region' as const, text: item.originalText })),
    ...previous.map(item => ({ ...bounds(item), id: item.id, kind: 'candidate' as const, text: item.text })),
  ]
  const differences = compareRegionDetections(existing, candidates).map((difference): RegionProposalDifference => {
    const incoming = candidates.find(item => item.id === difference.detectedId)
    const peerIds = incoming ? candidates.filter(item => item.id !== incoming.id && overlaps(item, incoming)).map(item => item.id) : []
    return { ...difference, status: peerIds.length ? 'ambiguous' : difference.status, peerIds }
  })
  const review = freezeTree({ cardId: card.id, imageDigest: scope.imageDigest, existing, candidates, differences })
  snapshots.set(review, { card: snapshot(card), revision: scope.revision, session: scope.session })
  return review
}

/** 枠の手動調整と同様に表示用の行座標を拡縮する。実測OCRとして再利用しない。 */
function resizeCandidate(candidate: RegionCandidate, next: RegionDraft): RegionCandidate {
  const scaleX = next.width / candidate.width
  const scaleY = next.height / candidate.height
  return { ...candidate, ...next, lines: candidate.lines.map(line => ({
    ...line,
    x: next.x + (line.x - candidate.x) * scaleX,
    y: next.y + (line.y - candidate.y) * scaleY,
    width: line.width * scaleX,
    height: line.height * scaleY,
  })) }
}

/** 全選択を独立コピーに適用する。Store・履歴へは呼出元が一つの操作として反映する。 */
export function adoptRegionProposal<T extends RegionReviewCard>(card: T, review: RegionProposalReview, choices: readonly RegionProposalChoice[], scope: RegionProposalScope): T {
  checkedCard(card, scope)
  const baseline = snapshots.get(review)
  if (!baseline || review.cardId !== card.id || review.imageDigest !== scope.imageDigest || baseline.session !== scope.session || baseline.revision !== scope.revision || baseline.card !== snapshot(card))
    throw new Error('比較後に画像・領域・候補が変わりました。再比較してください。')
  if (choices.length > review.candidates.length || new Set(choices.map(choice => choice.detectedId)).size !== choices.length)
    throw new Error('採用する検出結果の指定が重複・過大です。')
  const next = structuredClone(card)
  const selectedIds = new Set(choices.map(choice => choice.detectedId))
  const usedTargets = new Set<string>()
  for (const choice of choices) {
    const detected = review.candidates.find(item => item.id === choice.detectedId)
    const difference = review.differences.find(item => item.detectedId === choice.detectedId)
    if (!detected || !difference)
      throw new Error('採用する検出結果が見つかりません。')
    if (choice.action === 'add-candidate') {
      if (difference.targets.length || difference.peerIds.some(id => selectedIds.has(id))
        || next.regions.some(item => item.id === detected.id) || next.ocrCandidates?.some(item => item.id === detected.id)) {
        throw new Error('既存領域・候補との対応が重なっています。新規追加ではなく対応先を確認してください。')
      }
      next.ocrCandidates = [...next.ocrCandidates ?? [], structuredClone(detected)]
      continue
    }
    const key = `${choice.target?.kind}:${choice.target?.id}`
    if (choice.action !== 'bounds' || usedTargets.has(key) || !difference.targets.some(target => target.id === choice.target.id && target.kind === choice.target.kind))
      throw new Error('枠の修正先を一つずつ確認してください。統合・分割は自動で行いません。')
    usedTargets.add(key)
    const rect = bounds(detected)
    if (choice.target.kind === 'region') {
      const index = next.regions.findIndex(item => item.id === choice.target.id)
      const previous = next.regions[index]!
      if (!sameBounds(previous, rect))
        next.regions[index] = { ...previous, ...rebaseRegionBounds(previous, rect, card.imageWidth, card.imageHeight) }
    }
    else {
      const index = next.ocrCandidates!.findIndex(item => item.id === choice.target.id)
      const previous = next.ocrCandidates![index]!
      if (!sameBounds(previous, rect))
        next.ocrCandidates![index] = resizeCandidate(previous, rect)
    }
  }
  checkedCard(next, scope)
  return next
}
