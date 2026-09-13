import type {
  OCRCorrectionChange,
  OCRCorrectionResult,
  OCRCorrector,
} from './correction-types'
import type { OCRDictionaryEntry } from '~/types/editor'

/** OCRの綴り補正候補を照合する基本語彙。 */
const COMMON_WORDS = new Set(
  `
  a action actions after all an and any are armor as at attack attacks
  be before board bonus bonuses by can card cards choose chosen coin coins
  cost costs damage deck destroy destroyed discard discarded draw each effect
  enemy enemies equal first for from gain gains game give hand has have heal
  health immediately in into is it item items less lose may more move must next
  night no of on one opponent opponents or other phase phases place placed
  player players point points return round rule rules same shield shields spend
  spoils take than that the then this three to token tokens turn two up village
  wound wounds you your
  `
    .trim()
    .split(/\s+/u),
)

/** 英語OCRで取り違えやすい文字と置換候補の対応表。 */
const CONFUSABLES: Readonly<Record<string, readonly string[]>> = {
  '0': ['o'],
  '1': ['i', 'l'],
  '5': ['s'],
  '8': ['b'],
  '|': ['i', 'l'],
  'b': ['b', 'd'],
  'd': ['d', 'b'],
}

/** 補正後の語を元の大文字・小文字の使い方へ合わせる。 */
function preserveCase(source: string, corrected: string): string {
  if (source === source.toUpperCase())
    return corrected.toUpperCase()
  if (/^[A-Z]/u.test(source))
    return corrected.charAt(0).toUpperCase() + corrected.slice(1)
  return corrected
}

/** 連続文字の誤認識を減らした綴り候補を作る。 */
function candidatesWithoutRepeatedCharacters(candidate: string): string[] {
  const candidates = [candidate]
  for (let index = 1; index < candidate.length; index += 1) {
    if (candidate[index] !== candidate[index - 1])
      continue
    candidates.push(candidate.slice(0, index) + candidate.slice(index + 1))
  }
  return candidates
}

/** 文字の取り違えを考慮した単語の補正候補を作る。 */
function candidatesForToken(token: string): string[] {
  let candidates = ['']
  for (const character of token.toLowerCase()) {
    const replacements = CONFUSABLES[character] ?? [character]
    candidates = candidates.flatMap(prefix =>
      replacements.map(replacement => prefix + replacement),
    )
    if (candidates.length > 32)
      return []
  }
  const rnCandidates = candidates.flatMap(candidate =>
    candidate.includes('rn')
      ? [candidate, candidate.replaceAll('rn', 'm')]
      : [candidate],
  )
  return [
    ...new Set(
      rnCandidates.flatMap(candidate =>
        candidatesWithoutRepeatedCharacters(candidate),
      ),
    ),
  ]
}

/** 単語の候補を辞書と照合して補正先を求める。 */
function correctToken(token: string): string | null {
  const normalized = token.toLowerCase()
  if (COMMON_WORDS.has(normalized)) {
    const normalizedCase = preserveCase(token, normalized)
    return normalizedCase === token ? null : normalizedCase
  }
  const matches = candidatesForToken(token).filter(candidate =>
    COMMON_WORDS.has(candidate),
  )
  if (matches.length !== 1)
    return null
  return preserveCase(token, matches[0]!)
}

/** 一行の原文へ辞書置換と単語補正を適用する。 */
function correctLine(
  line: string,
  lineNumber: number,
  dictionary: ReadonlyMap<string, string>,
) {
  const changes: OCRCorrectionChange[] = []
  let corrected = line.replace(/\[icon:[^\]\r\n]+\]|[A-Za-z0-9|]+/gu, (token) => {
    if (token.startsWith('[icon:'))
      return token
    const dictionaryReplacement = dictionary.get(token.toLowerCase())
    if (dictionaryReplacement && dictionaryReplacement !== token) {
      changes.push({
        original: token,
        corrected: dictionaryReplacement,
        line: lineNumber,
        reason: 'user-dictionary',
      })
      return dictionaryReplacement
    }
    const replacement = correctToken(token)
    if (!replacement || replacement === token)
      return token
    changes.push({
      original: token,
      corrected: replacement,
      line: lineNumber,
      reason: 'confusable-characters',
    })
    return replacement
  })

  const spacingCorrected = corrected.split(/(\[icon:[^\]\r\n]+\])/gu)
    .map((part, index) => index % 2
      ? part
      : part
          .replace(/\s+([,.;:!?])/gu, '$1')
          .replace(/([,;:!?])(?=[A-Za-z])/gu, '$1 '))
    .join('')
  if (spacingCorrected !== corrected) {
    changes.push({
      original: corrected,
      corrected: spacingCorrected,
      line: lineNumber,
      reason: 'spacing',
    })
    corrected = spacingCorrected
  }
  return { corrected, changes }
}

// 辞書と文字の取り違え候補でOCRを補正する。結果は提案として返し、原文を直接変更しない。
export class LocalOCRCorrector implements OCRCorrector {
  /** OCR本文を行ごとに補正し、変更箇所と補正候補を返す。 */
  async correct(
    text: string,
    dictionaryEntries: readonly OCRDictionaryEntry[] = [],
  ): Promise<OCRCorrectionResult> {
    const changes: OCRCorrectionChange[] = []
    const dictionary = new Map(
      dictionaryEntries
        .filter(entry => entry.source.trim() && entry.replacement.trim())
        .map(entry => [
          entry.source.trim().toLowerCase(),
          entry.replacement.trim(),
        ]),
    )
    const correctedText = text
      .split('\n')
      .map((line, index) => {
        const result = correctLine(line, index + 1, dictionary)
        changes.push(...result.changes)
        return result.corrected
      })
      .join('\n')
    return { correctedText, changes }
  }
}
