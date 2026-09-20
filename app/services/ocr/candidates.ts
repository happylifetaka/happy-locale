import type { RegionCandidateOptions } from './candidates/options'
import type { OCRTextBlock, RegionCandidate } from '~/types/ocr'
import { candidateFromLines, createCandidateBounds } from './candidates/geometry'
import { groupCandidateLines } from './candidates/grouping'
import { normalizeCandidateBlocks } from './candidates/normalize'

export type { RegionCandidateOptions } from './candidates/options'

/** 認識済みの行を使って候補を分割し、再OCRせずに原文と範囲を作り直す。 */
export function splitRegionCandidate(
  candidate: RegionCandidate,
  padding = 6,
): [RegionCandidate, RegionCandidate] | null {
  if (candidate.lines.length < 2)
    return null
  const splitIndex = Math.ceil(candidate.lines.length / 2)
  const upperLines = candidate.lines.slice(0, splitIndex)
  const lowerLines = candidate.lines.slice(splitIndex)
  return [
    candidateFromLines(
      upperLines,
      `${candidate.id}_a`,
      candidate.selected,
      candidate,
      padding,
    ),
    candidateFromLines(
      lowerLines,
      `${candidate.id}_b`,
      candidate.selected,
      candidate,
      padding,
    ),
  ]
}

/** OCRの行補正・選別→行結合→候補枠生成を既存の順序で接続する公開窓口。 */
export function createRegionCandidates(
  blocks: readonly OCRTextBlock[],
  options: RegionCandidateOptions,
): RegionCandidate[] {
  const { lines, trimmedLines } = normalizeCandidateBlocks(blocks, options)
  const groups = groupCandidateLines(lines)
  return createCandidateBounds(groups, trimmedLines, options)
}

/** 候補の履歴を独立して保存できるよう深く複製する。 */
export function cloneRegionCandidates(
  candidates: readonly RegionCandidate[],
): RegionCandidate[] {
  return candidates.map(candidate => ({
    ...candidate,
    lines: candidate.lines.map(line => ({ ...line })),
  }))
}
