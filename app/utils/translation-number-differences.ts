interface NumberOccurrence {
  value: string
  context: string
}

/** 全角数字を正規化し、アイコン名に含まれる数字を除外して前後の文脈付きで抽出する。 */
function occurrences(text: string): NumberOccurrence[] {
  const normalized = text.normalize('NFKC')
  // Spaces preserve offsets and prevent adjacent numbers merging across an asset.
  const searchable = normalized.replace(/\[icon:[^[\]\r\n]+\]/gu, token => ' '.repeat(token.length))
  return [...searchable.matchAll(/[+−-]?\d+(?:\.\d+)?/gu)].map((match) => {
    const start = match.index
    const end = start + match[0].length
    const left = Math.max(0, start - 24)
    const right = Math.min(normalized.length, end + 24)
    const context = `${left ? '…' : ''}${normalized.slice(left, start)}【${match[0]}】${normalized.slice(end, right)}${right < normalized.length ? '…' : ''}`.replace(/\s+/gu, ' ')
    return { value: match[0].replace('−', '-'), context }
  })
}

/** 数値の出現箇所を件数制限付きの文脈説明へまとめる。 */
function contexts(items: NumberOccurrence[]) {
  return items.slice(0, 3).map(item => `「${item.context}」`).join('、')
    + (items.length > 3 ? `（ほか${items.length - 3}か所）` : '')
}

/** Compare counts without claiming which sentences or numeric occurrences correspond. */
export function translationNumberDifferences(source: string, translation: string): string[] {
  const original = occurrences(source)
  const translated = occurrences(translation)
  const values = new Set([...original, ...translated].map(item => item.value))
  const differences: string[] = []
  for (const value of values) {
    const first = original.filter(item => item.value === value)
    const second = translated.filter(item => item.value === value)
    if (first.length === second.length)
      continue
    if (!first.length) {
      differences.push(`訳文にだけ「${value}」が${second.length}か所あります。該当箇所：${contexts(second)}`)
    }
    else if (!second.length) {
      differences.push(`原文にだけ「${value}」が${first.length}か所あります。該当箇所：${contexts(first)}`)
    }
    else {
      differences.push(`「${value}」の出現回数が異なります（原文${first.length}か所／訳文${second.length}か所）。原文：${contexts(first)}。訳文：${contexts(second)}`)
    }
  }
  return differences
}
