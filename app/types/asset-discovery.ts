import type { RegionDraft } from './editor'

/** アイコン候補は原画像上に独立して存在し、領域への所属は補助情報とする。 */
export interface IconOccurrence {
  id: string
  cardId: string
  imageDigest: string
  /** ハッシュで識別する検出元画像の寸法。差替え後も旧座標を解釈できるよう保持する。 */
  imageSize: { width: number, height: number }
  bounds: RegionDraft
  detectedBounds: RegionDraft | null
  origin: 'detected' | 'manual'
  detectorRevision: string
  /** 自動抽出の根拠。導入前の候補・手動追加では省略可能。 */
  detectionReason?: 'colored-component' | 'contrast-component'
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

/** project.json version 4で保存するレビュー状態。画像資源・実測OCRは含めない。 */
export interface AssetDiscoveryState {
  occurrences: IconOccurrence[]
  groups: IconCandidateGroup[]
}
