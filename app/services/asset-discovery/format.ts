import type { AssetDiscoveryState, IconCandidateGroup, IconOccurrence, IconOccurrenceApproval } from '~/types/asset-discovery'
import type { FolderProjectCard, RegionDraft } from '~/types/editor'
import { containsBounds, sameBounds } from './review'

export const ASSET_DISCOVERY_LIMITS = Object.freeze({ perCard: 100, project: 2000, identifierLength: 128 })

interface DiscoveryFormatContext {
  cards: readonly Pick<FolderProjectCard, 'id' | 'imageWidth' | 'imageHeight' | 'regions' | 'ocrCandidates'>[]
  assetIds: ReadonlySet<string>
}

const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const id = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= ASSET_DISCOVERY_LIMITS.identifierLength
const digest = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/u.test(v)
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** version 4の接続で用いる厳密な値・参照検証。単独では既存文書のversionを変更しない。 */
export function parseAssetDiscovery(value: unknown, context: DiscoveryFormatContext): AssetDiscoveryState {
  const fail = (reason: string): never => {
    throw new Error(`アイコン候補の保存データが不正です（${reason}）。`)
  }
  if (!record(value) || !Array.isArray(value.occurrences) || !Array.isArray(value.groups)
    || value.occurrences.length > ASSET_DISCOVERY_LIMITS.project || value.groups.length > ASSET_DISCOVERY_LIMITS.project) {
    return fail('候補・グループ数')
  }
  const cards = new Map(context.cards.map(card => [card.id, card]))
  const occurrenceIds = new Set<string>()
  const counts = new Map<string, number>()
  const bounds = (v: unknown, width: number, height: number): RegionDraft => {
    if (!record(v) || !finite(v.x) || !finite(v.y) || !finite(v.width) || !finite(v.height))
      return fail('座標')
    const b = { x: v.x, y: v.y, width: v.width, height: v.height }
    if (!containsBounds({ x: 0, y: 0, width, height }, b))
      return fail('画像外の矩形')
    return b
  }
  const occurrences = value.occurrences.map((item): IconOccurrence => {
    if (!record(item) || !id(item.id) || occurrenceIds.has(item.id) || !id(item.cardId)
      || !digest(item.imageDigest) || (item.origin !== 'detected' && item.origin !== 'manual') || !id(item.detectorRevision)
      || (item.decision !== 'pending' && item.decision !== 'accepted' && item.decision !== 'excluded')
      || !(item.assetId === null || (id(item.assetId) && context.assetIds.has(item.assetId)))) {
      return fail('候補ID・画像・判定・アセット参照')
    }
    occurrenceIds.add(item.id)
    const card = cards.get(item.cardId)
    if (!card)
      return fail('カード参照')
    const count = (counts.get(item.cardId) ?? 0) + 1
    if (count > ASSET_DISCOVERY_LIMITS.perCard)
      return fail('カード内の候補数')
    counts.set(item.cardId, count)
    const currentBounds = bounds(item.bounds, card.imageWidth, card.imageHeight)
    const detectedBounds = item.detectedBounds === null ? null : bounds(item.detectedBounds, card.imageWidth, card.imageHeight)
    let approval: IconOccurrenceApproval | null = null
    if (item.approval !== null) {
      const raw = item.approval
      if (!record(raw) || !digest(raw.imageDigest) || !digest(raw.assetDigest) || !id(raw.assetId)
        || raw.assetId !== item.assetId || raw.imageDigest !== item.imageDigest || item.decision !== 'accepted') {
        return fail('承認対象')
      }
      const approvedBounds = bounds(raw.bounds, card.imageWidth, card.imageHeight)
      if (!sameBounds(approvedBounds, currentBounds))
        return fail('承認後に変更された矩形')
      approval = { imageDigest: raw.imageDigest, assetId: raw.assetId, assetDigest: raw.assetDigest, bounds: approvedBounds }
    }
    if (item.decision === 'accepted' && approval === null)
      return fail('承認の欠落')
    let owner: IconOccurrence['owner'] = null
    if (item.owner !== null) {
      if (!record(item.owner) || !id(item.owner.id) || (item.owner.kind !== 'candidate' && item.owner.kind !== 'region'))
        return fail('所属先')
      const collection = item.owner.kind === 'region' ? card.regions : (card.ocrCandidates ?? [])
      const ownerId = item.owner.id
      const region = collection.find(region => region.id === ownerId)
      if (!region || !containsBounds(region, currentBounds))
        return fail('所属先の参照・範囲')
      owner = { kind: item.owner.kind, id: ownerId }
    }
    return {
      id: item.id,
      cardId: item.cardId,
      imageDigest: item.imageDigest,
      bounds: currentBounds,
      detectedBounds,
      origin: item.origin,
      detectorRevision: item.detectorRevision,
      decision: item.decision,
      assetId: item.assetId,
      approval,
      owner,
    }
  })
  const groupIds = new Set<string>()
  const grouped = new Set<string>()
  const groups = value.groups.map((item): IconCandidateGroup => {
    if (!record(item) || !id(item.id) || groupIds.has(item.id) || !Array.isArray(item.memberIds)
      || !item.memberIds.length || item.memberIds.length > ASSET_DISCOVERY_LIMITS.project
      || !id(item.representativeId) || !item.memberIds.includes(item.representativeId)
      || typeof item.name !== 'string' || item.name.length > 1000
      || !(item.proposedAssetId === null || (id(item.proposedAssetId) && context.assetIds.has(item.proposedAssetId)))) {
      return fail('グループのID・代表・名前・登録先')
    }
    groupIds.add(item.id)
    const memberIds = item.memberIds.map((member): string => {
      if (!id(member) || !occurrenceIds.has(member) || grouped.has(member))
        return fail('グループの候補参照・重複所属')
      grouped.add(member)
      return member
    })
    return { id: item.id, name: item.name, proposedAssetId: item.proposedAssetId, representativeId: item.representativeId, memberIds }
  })
  return { occurrences, groups }
}
