import type { CandidateGroup } from './options'
import type { OCRTextBlock } from '~/types/ocr'
import { isInitiallySelected } from './filter'
import { groupBounds, horizontalOverlap } from './geometry'

/** 大文字主体のラベルと通常の文章の境界。固有の見出し語には依存しない。 */
function isUppercaseLabel(text: string): boolean {
  const letters = text.match(/[a-z]/giu) ?? []
  return letters.length >= 3
    && letters.filter(letter => letter === letter.toUpperCase()).length / letters.length >= 0.8
}

/** 同じ行の断片だけを横結合する。離れた段組みはまとめない。 */
function canJoinOnSameRow(a: OCRTextBlock, b: OCRTextBlock): boolean {
  const gap = Math.max(a.x, b.x) - Math.min(a.x + a.width, b.x + b.width)
  const proseFragments = !isUppercaseLabel(a.text) && !isUppercaseLabel(b.text)
    && (a.text.match(/[a-z]+/giu)?.length ?? 0) >= 1
    && (b.text.match(/[a-z]+/giu)?.length ?? 0) >= 1
    && Math.max(a.text.match(/[a-z]+/giu)?.length ?? 0, b.text.match(/[a-z]+/giu)?.length ?? 0) >= 3
    && Math.max(a.confidence ?? 0, b.confidence ?? 0) >= 70
    && Math.min(a.confidence ?? 0, b.confidence ?? 0) >= 25
  const rightFragment = a.x > b.x ? a : b
  const iconFragment = proseFragments && /^[^a-z]+/iu.test(rightFragment.text)
  if (isInitiallySelected(a) !== isInitiallySelected(b) && !(proseFragments && (gap <= 0 || iconFragment)))
    return false
  const height = Math.min(a.height, b.height)
  const overlap = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  return height / Math.max(a.height, b.height) >= 0.4
    && overlap >= height * 0.7
    && gap >= -(iconFragment ? Math.min(height * 1.5, Math.min(a.width, b.width) * 0.4) : height * (proseFragments ? 0.5 : 0.2))
    && gap <= height * 1.5
}

/** 行内の断片を先に復元し、その行が別候補の外接矩形に取り残されるのを防ぐ。 */
function joinRowFragments(blocks: OCRTextBlock[]): OCRTextBlock[] {
  const rows: OCRTextBlock[] = []
  for (const block of blocks) {
    const index = rows.findLastIndex(row => canJoinOnSameRow(row, block))
    if (index < 0) {
      rows.push(block)
      continue
    }
    const parts = [rows[index]!, block].sort((a, b) => a.x - b.x)
    rows[index] = { ...groupBounds(parts), text: parts.map(part => part.text).join(' ') }
  }
  return rows.sort((a, b) => a.y - b.y || a.x - b.x)
}

/** 位置と行間から隣接するOCR行を同じ領域へまとめられるか判定する。 */
function canJoin(previous: OCRTextBlock, next: OCRTextBlock): boolean {
  if (isInitiallySelected(previous) !== isInitiallySelected(next))
    return false
  const verticalGap = next.y - (previous.y + previous.height)
  // 大きな装飾・アイコンを巻き込んだ一行が、段落間の許容間隔を広げない。
  const lineHeight = Math.min(previous.height, next.height)
  const largerHeight = Math.max(previous.height, next.height)
  const previousLabel = isUppercaseLabel(previous.text)
  // 左揃え本文はアイコンや小文字だけの行で行高が変わる。従来の上限内で余裕を残す。
  const alignedBody = !previousLabel && Math.abs(previous.x - next.x) <= lineHeight * 0.5
    && lineHeight / largerHeight >= 0.4
    && (previous.confidence === null || previous.confidence >= 70)
    && (next.confidence === null || next.confidence >= 70)
  const maximumGap = alignedBody
    ? Math.min(lineHeight * 1.5, largerHeight * 1.1)
    : lineHeight * 0.8
  return (
    verticalGap >= -lineHeight * 0.35
    && verticalGap <= maximumGap
    && horizontalOverlap(previous, next) >= 0.2
    && previousLabel === isUppercaseLabel(next.text)
    && (!previousLabel || lineHeight / largerHeight >= 0.72)
  )
}

/** 行内断片を復元してから、他の見出しをまたがずに隣接行を結合する。 */
export function groupCandidateLines(blocks: OCRTextBlock[]): CandidateGroup[] {
  const groups: CandidateGroup[] = []
  for (const block of joinRowFragments(blocks)) {
    const group = groups.findLast((candidate) => {
      const previous = candidate.lines.at(-1)!
      if (!canJoin(previous, block))
        return false
      // 他の見出し等を飛び越えて過去の本文グループに接続しない。
      return !groups.some(other => other !== candidate && other.lines.some(line =>
        line.y > previous.y && line.y < block.y
        && horizontalOverlap(line, previous) >= 0.2
        && horizontalOverlap(line, block) >= 0.2,
      ))
    })
    if (group)
      group.lines.push(block)
    else groups.push({ lines: [block] })
  }

  return groups
}
