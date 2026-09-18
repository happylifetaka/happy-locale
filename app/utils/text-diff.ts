export interface TextDiffPart {
  kind: 'equal' | 'delete' | 'insert'
  text: string
}

/** 共通部分を一度だけ表示するための文字差分。補正本文は変更しない。 */
export function textDiff(original: string, corrected: string): TextDiffPart[] {
  const before = Array.from(original)
  const after = Array.from(corrected)
  let start = 0
  while (start < before.length && start < after.length && before[start] === after[start])
    start++
  let end = 0
  while (end < before.length - start && end < after.length - start && before[before.length - end - 1] === after[after.length - end - 1])
    end++
  const a = before.slice(start, before.length - end)
  const b = after.slice(start, after.length - end)
  const parts: TextDiffPart[] = []
  const append = (kind: TextDiffPart['kind'], text: string) => {
    if (!text)
      return
    const last = parts.at(-1)
    if (last?.kind === kind)
      last.text += text
    else parts.push({ kind, text })
  }
  append('equal', before.slice(0, start).join(''))
  // 異常に長い入力ではメモリと処理時間を制限し、共通の前後だけを省く。
  if ((a.length + 1) * (b.length + 1) > 1_000_000) {
    append('delete', a.join(''))
    append('insert', b.join(''))
  }
  else {
    const columns = b.length + 1
    const lengths = new Uint32Array((a.length + 1) * columns)
    for (let i = a.length - 1; i >= 0; i--) {
      for (let j = b.length - 1; j >= 0; j--) {
        lengths[i * columns + j] = a[i] === b[j]
          ? lengths[(i + 1) * columns + j + 1]! + 1
          : Math.max(lengths[(i + 1) * columns + j]!, lengths[i * columns + j + 1]!)
      }
    }
    let i = 0
    let j = 0
    while (i < a.length || j < b.length) {
      if (i < a.length && j < b.length && a[i] === b[j]) {
        append('equal', a[i++]!)
        j++
      }
      else if (i < a.length && (j === b.length || lengths[(i + 1) * columns + j]! >= lengths[i * columns + j + 1]!)) {
        append('delete', a[i++]!)
      }
      else {
        append('insert', b[j++]!)
      }
    }
  }
  append('equal', end ? before.slice(-end).join('') : '')
  return parts
}

/** 変更された空白だけを可視化し、通常の本文中の空白はそのまま表示する。 */
export function visibleWhitespace(text: string): string {
  return text.replace(/ /gu, '␠').replace(/\t/gu, '⇥').replace(/\n/gu, '↵')
}
