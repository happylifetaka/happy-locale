import type { CardProject, FolderProjectDocument } from '~/types/editor'
import type { RegionCandidate } from '~/types/ocr'
import { finalizeProjectCardDeletions } from './cards'

interface ProjectSaveData {
  document: FolderProjectDocument | null
  card: CardProject
  cardId: string
  assets: FolderProjectDocument['assets']
  fonts: FolderProjectDocument['fonts']
  ocrDictionary: FolderProjectDocument['ocrDictionary']
  glossary: FolderProjectDocument['glossary']
  draftOCRCandidates: RegionCandidate[]
  draftAssetDiscovery?: FolderProjectDocument['assetDiscovery']
}

/** I/O開始前の保存データを確定する。画像Blobは複製せず、成功後の同一性照合用に控える。 */
export function captureProjectSave(
  data: ProjectSaveData,
  pendingAssetWrites: ReadonlyMap<string, Blob>,
  pendingCardDeletionIds: ReadonlySet<string>,
) {
  // Storeが所有するplain dataだけを複製し、呼出元の後続編集から切り離す。
  // stringifyでNaN等をnullへ変換せず、後段の保存検証が不正値を拒否できるよう保持する。
  // Blob・ハンドル・URL等の所有と解放は呼出元のruntimeに残す。
  const saved = structuredClone(data)
  const assetWrites = new Map(pendingAssetWrites)
  const deletionIds = new Set(pendingCardDeletionIds)
  const finalized = saved.document ? finalizeProjectCardDeletions(saved.document, deletionIds) : null
  return {
    ...saved,
    document: finalized?.document ?? null,
    deletedCards: finalized?.deletedCards ?? [],
    assetWrites,
    deletionIds,
  }
}
