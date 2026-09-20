import type { AssetDiscoveryState, IconCandidateGroup } from '~/types/asset-discovery'

/** 旧版の個別割当は読込時に書き換えず、グループ画面で明示的に統一する。 */
export function groupAssetState(state: AssetDiscoveryState, group: IconCandidateGroup) {
  const members = state.occurrences.filter(item => group.memberIds.includes(item.id))
  const assignments = new Set(members.map(item => item.assetId))
  const assetId = group.proposedAssetId ?? (assignments.size === 1 ? members[0]?.assetId ?? null : null)
  return { assetId, needsSync: group.proposedAssetId !== assetId || members.some(item => item.assetId !== assetId) }
}
