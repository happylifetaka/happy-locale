import type { RegionDraft } from '~/types/editor'
import type { RegionCandidate } from '~/types/ocr'
import { intersectionArea } from '~/services/asset-discovery/geometry'

/** 手動調整・選択済み候補を優先し、既存枠と重ならない新しい候補だけを追加する。 */
export function mergeDetectedCandidates(existing: readonly RegionCandidate[], detected: readonly RegionCandidate[], regions: readonly RegionDraft[]): RegionCandidate[] {
  const merged = structuredClone([...existing])
  for (const candidate of detected) {
    if ([...regions, ...merged].some(bounds => intersectionArea(bounds, candidate) > 0))
      continue
    merged.push({ ...structuredClone(candidate), id: crypto.randomUUID(), selected: false })
  }
  return merged
}
