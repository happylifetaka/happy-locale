import type { AssetDiscoveryState, IconCandidateGroup } from '~/types/asset-discovery'

/** 誤検出を除く表示・登録用グループ。元の所属と代表は取消時の復帰に備えて保持する。 */
export function activeReviewGroups(state: AssetDiscoveryState): IconCandidateGroup[] {
  const activeIds = new Set(state.occurrences.filter(item => item.decision !== 'excluded').map(item => item.id))
  return state.groups.flatMap((group) => {
    const memberIds = group.memberIds.filter(id => activeIds.has(id))
    if (!memberIds.length)
      return []
    return [{ ...group, memberIds, representativeId: memberIds.includes(group.representativeId) ? group.representativeId : memberIds[0]! }]
  })
}
