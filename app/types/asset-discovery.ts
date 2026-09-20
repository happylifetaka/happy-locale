import type { RegionDraft } from './editor'

/** アイコン候補は原画像上に独立して存在し、領域への所属は補助情報とする。 */
export interface IconOccurrence {
  id: string
  cardId: string
  imageDigest: string
  bounds: RegionDraft
  detectedBounds: RegionDraft | null
  origin: 'detected' | 'manual'
  detectorRevision: string
  decision: 'pending' | 'accepted' | 'excluded'
  assetId: string | null
  approval: IconOccurrenceApproval | null
  owner: { kind: 'candidate' | 'region', id: string } | null
}

export interface IconOccurrenceApproval {
  imageDigest: string
  bounds: RegionDraft
  assetId: string
  assetDigest: string
}

export interface IconCandidateGroup {
  id: string
  memberIds: string[]
  representativeId: string
  name: string
  proposedAssetId: string | null
}

/** 保存接続前のJSON契約。現行project.jsonにこの型を追加するだけでは移行済みとしない。 */
export interface AssetDiscoveryState {
  occurrences: IconOccurrence[]
  groups: IconCandidateGroup[]
}
