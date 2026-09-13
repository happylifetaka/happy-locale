import type { TextStyleRange } from '~/types/editor'

type StylePatch = Pick<TextStyleRange, 'textColor' | 'fontId'>

/** 文字位置に重なる部分書式を合成する。 */
function styleAt(ranges: readonly TextStyleRange[], index: number): StylePatch {
  return ranges.reduce<StylePatch>(
    (style, range) => index >= range.start && index < range.end
      ? {
          ...style,
          ...(range.textColor !== undefined
            ? { textColor: range.textColor }
            : {}),
          ...(range.fontId !== undefined ? { fontId: range.fontId } : {}),
        }
      : style,
    {},
  )
}

/** 二つの部分書式の色とフォント指定が同じか比較する。 */
function sameStyle(a: StylePatch, b: StylePatch) {
  return a.textColor === b.textColor && a.fontId === b.fontId
}

/** 選択範囲へ書式を適用してから、連続する同じ書式をまとめて保存範囲を作り直す。 */
export function applyTextStyle(
  ranges: readonly TextStyleRange[],
  textLength: number,
  start: number,
  end: number,
  patch: StylePatch | null,
): TextStyleRange[] {
  const first = Math.max(0, Math.min(textLength, start))
  const last = Math.max(first, Math.min(textLength, end))
  const styles = Array.from(
    { length: textLength },
    (_, index) => index >= first && index < last
      ? (patch === null ? {} : { ...styleAt(ranges, index), ...patch })
      : styleAt(ranges, index),
  )
  const result: TextStyleRange[] = []
  for (let index = 0; index < styles.length;) {
    const style = styles[index]!
    let next = index + 1
    while (next < styles.length && sameStyle(style, styles[next]!))
      next += 1
    if (style.textColor !== undefined || style.fontId !== undefined)
      result.push({ start: index, end: next, ...style })
    index = next
  }
  return result
}

/** 変更されていない前後の文字だけ書式を保持し、編集された部分の古い書式は取り除く。 */
export function reconcileTextStyles(
  previous: string,
  next: string,
  ranges: readonly TextStyleRange[] = [],
): TextStyleRange[] {
  let prefix = 0
  while (prefix < previous.length && previous[prefix] === next[prefix])
    prefix += 1
  let suffix = 0
  while (
    suffix < previous.length - prefix
    && suffix < next.length - prefix
    && previous[previous.length - 1 - suffix] === next[next.length - 1 - suffix]
  ) {
    suffix += 1
  }
  const previousEnd = previous.length - suffix
  const delta = next.length - previous.length
  return ranges.flatMap((range): TextStyleRange[] => {
    if (range.end <= prefix)
      return [{ ...range }]
    if (range.start >= previousEnd)
      return [{ ...range, start: range.start + delta, end: range.end + delta }]
    const parts: TextStyleRange[] = []
    if (range.start < prefix)
      parts.push({ ...range, end: prefix })
    if (range.end > previousEnd) {
      parts.push({
        ...range,
        start: previousEnd + delta,
        end: range.end + delta,
      })
    }
    return parts.filter(part => part.end > part.start)
  })
}
