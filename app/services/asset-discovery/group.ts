import type { AssetFingerprint } from '~/utils/asset-matching'
import { createDiscoveryComparator } from './similarity'

export interface IconGroupSample {
  id: string
  fingerprint: AssetFingerprint | null
}

export interface ProposedIconGroup {
  memberIds: string[]
  representativeId: string
  minimumSimilarity: number | null
}

export interface IconGroupProposal {
  groups: ProposedIconGroup[]
  comparisons: number
  truncated: boolean
}

/** 色の違いを既存の形状主体スコアだけで吸収しない。値は正解確率ではない。 */
export function discoverySimilarity(a: AssetFingerprint, b: AssetFingerprint): number {
  return createDiscoveryComparator()(a, b)
}

/** 全メンバーとの一致を要求する保守的な提案。承認／既存グループを変更しない。 */
export function proposeIconGroups(samples: readonly IconGroupSample[], threshold = 0.9, maximumComparisons = 10000): IconGroupProposal {
  if (!Number.isFinite(threshold) || threshold < 0.5 || threshold > 1 || samples.length > 2000
    || !Number.isInteger(maximumComparisons) || maximumComparisons < 1 || maximumComparisons > 100000
    || new Set(samples.map(sample => sample.id)).size !== samples.length || samples.some(sample => !sample.id)) {
    throw new Error('類似グループの入力・上限が不正です。')
  }
  const groups: { members: IconGroupSample[], minimum: number | null }[] = []
  let comparisons = 0
  let truncated = false
  const similarity = createDiscoveryComparator()
  // 入力順を安定させ、同じ候補集合の並べ替えで提案が変わらないようにする。
  for (const sample of [...samples].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
    let best: typeof groups[number] | undefined
    let bestScore = -1
    if (sample.fingerprint && !truncated) {
      for (const group of groups) {
        let minimum = 1
        for (const member of group.members) {
          if (comparisons >= maximumComparisons) {
            truncated = true
            break
          }
          comparisons++
          minimum = Math.min(minimum, member.fingerprint ? similarity(sample.fingerprint, member.fingerprint) : 0)
          if (minimum < threshold)
            break
        }
        if (truncated) {
          best = undefined
          break
        }
        if (minimum >= threshold && minimum > bestScore) {
          best = group
          bestScore = minimum
        }
      }
    }
    if (best) {
      best.members.push(sample)
      best.minimum = Math.min(best.minimum ?? 1, bestScore)
    }
    else {
      groups.push({ members: [sample], minimum: null })
    }
  }
  return {
    groups: groups.map(group => ({ memberIds: group.members.map(member => member.id), representativeId: group.members[0]!.id, minimumSimilarity: group.minimum })),
    comparisons,
    truncated,
  }
}
