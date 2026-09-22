import type { AssetDiscoveryState } from '~/types/asset-discovery'
import type { FolderProjectCard, ImageAsset } from '~/types/editor'
import { groupAssetState } from './group-asset'

/** 実行前に保存データだけから示せる予定。画像照合・OCRの成功件数ではない。 */
export function describeCardApplyPlan(card: FolderProjectCard, discovery?: AssetDiscoveryState, assets: readonly ImageAsset[] = []) {
  const additions = (card.ocrCandidates ?? []).filter(candidate => candidate.selected).length
  const detect = !card.regions.length && !card.ocrCandidates?.length
  const operations = [
    ...detect ? ['領域を新規検出・追加'] : [],
    ...card.regions.length ? [`既存領域${card.regions.length}件を使用`] : [],
    ...additions ? [`選択済み候補${additions}件を追加`] : [],
  ]
  const items = discovery?.occurrences.filter(item => item.cardId === card.id && item.decision !== 'excluded') ?? []
  const assigned = items.filter((item) => {
    const group = discovery!.groups.find(group => group.memberIds.includes(item.id))
    const assignment = group && groupAssetState(discovery!, group)
    return assignment?.assetId && !assignment.needsSync && assets.some(asset => asset.id === assignment.assetId)
  })
  const names = [...new Set(assigned.map(item => assets.find(asset => asset.id === item.assetId)!.name))]
  return { operations, detect, additions, existing: card.regions.length, assigned: assigned.length, unassigned: items.length - assigned.length, names }
}
