import type { GlossaryEntry } from '~/types/editor'

/** 前後空白と大文字小文字を揃えて用語比較用のキーを作る。 */
export function glossaryKey(source: string): string {
  return source.trim().toLocaleLowerCase()
}

/** 本文に含まれる用語を出現順で返す。同じ位置なら長い用語を先に提示する。 */
export function findGlossaryMatches(
  text: string,
  entries: readonly GlossaryEntry[],
): GlossaryEntry[] {
  const normalizedText = text.toLocaleLowerCase()
  return entries
    .filter(entry => normalizedText.includes(entry.source.toLocaleLowerCase()))
    .sort((left, right) => {
      const leftIndex = normalizedText.indexOf(left.source.toLocaleLowerCase())
      const rightIndex = normalizedText.indexOf(right.source.toLocaleLowerCase())
      return leftIndex - rightIndex || right.source.length - left.source.length
    })
}
