import type { TextRegion } from '~/types/editor'
import { assertCsvTextLimits, FILE_LIMITS } from '~/utils/file-limits'

export interface TranslationRow {
  cardId: string
  cardName: string
  regionId: string
  displayName: string
  original: string
  translation: string
}

export interface TranslationCard {
  id: string
  imageName: string
  regions: readonly TextRegion[]
}

export interface TranslationMatchResult {
  translationsByCard: Map<string, Map<string, string>>
  applied: number
  unmatched: number
  duplicateRows: number
  originalMismatches: number
  issues: TranslationMatchIssue[]
}

export interface TranslationMatchIssue {
  kind: 'unmatched' | 'duplicate' | 'original-mismatch'
  rowNumber: number
  cardId: string
  regionId: string
  importedOriginal?: string
  expectedOriginal?: string
}

type TranslationMatchCard = Pick<TranslationCard, 'id'> & {
  regions: readonly Pick<TextRegion, 'regionId' | 'originalText'>[]
}

/** 引用符内の改行と二重引用符を扱うため、単純な行分割をせずセル境界を読み取る。 */
function parseRecords(csv: string): string[][] {
  assertCsvTextLimits(csv)
  const records: string[][] = []
  let record: string[] = []
  let value = ''
  let quoted = false

  const finishRecord = () => {
    record.push(restoreFormulaValue(value))
    if (record.some(cell => cell.length > 0))
      records.push(record)
    if (records.length > FILE_LIMITS.csvRows)
      throw new Error(`CSVは${FILE_LIMITS.csvRows}行以下にしてください。`)
    record = []
    value = ''
  }

  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index]!
    if (character === '"') {
      if (quoted && csv[index + 1] === '"') {
        value += '"'
        index += 1
      }
      else {
        quoted = !quoted
      }
    }
    else if (character === ',' && !quoted) {
      record.push(restoreFormulaValue(value))
      value = ''
    }
    else if (character === '\n' || character === '\r') {
      if (character === '\r' && csv[index + 1] === '\n')
        index += 1
      if (quoted)
        value += '\n'
      else
        finishRecord()
    }
    else {
      value += character
    }
  }

  if (quoted)
    throw new Error('CSVの引用符が閉じられていません。')
  if (record.length > 0 || value.length > 0)
    finishRecord()
  return records
}

/** CSV書き出し時に付けた数式対策の接頭辞を読み戻す。 */
function restoreFormulaValue(value: string): string {
  return /^\t[\t\r\n ]*[=+\-@]/u.test(value) ? value.slice(1) : value
}

/** ヘッダーと行を検証してカード翻訳のCSV項目へ変換する。 */
export function parseTranslationCsv(csv: string): TranslationRow[] {
  const records = parseRecords(csv.replace(/^\uFEFF/u, ''))
  if (records.length === 0)
    return []
  const headers = records[0]!.map(header =>
    header.trim().replace(/\s*\(readonly\)$/iu, ''),
  )
  const cardIdIndex = headers.indexOf('card_id')
  const cardNameIndex = headers.indexOf('card_name')
  const regionIndex = headers.indexOf('region_id')
  const displayNameIndex = headers.indexOf('display_name')
  const originalIndex = headers.indexOf('original')
  const translationIndex = headers.indexOf('translation')
  if (regionIndex < 0 || translationIndex < 0) {
    throw new Error('CSVには region_id と translation 列が必要です。')
  }
  return records.slice(1).map(values => ({
    cardId: cardIdIndex < 0 ? '' : (values[cardIdIndex]?.trim() ?? ''),
    cardName: cardNameIndex < 0 ? '' : (values[cardNameIndex] ?? ''),
    regionId: values[regionIndex]?.trim() ?? '',
    displayName:
      displayNameIndex < 0 ? '' : (values[displayNameIndex] ?? ''),
    original: originalIndex < 0 ? '' : (values[originalIndex] ?? ''),
    translation: values[translationIndex] ?? '',
  }))
}

/** 表計算ソフトで原文が数式として実行されないよう、危険な先頭文字に接頭辞を付ける。 */
function neutralizeFormula(value: string): string {
  return /^[\t\r\n ]*[=+\-@]/u.test(value) ? `\t${value}` : value
}

/** 引用符と区切り文字をCSVセルとして安全に書き出せる形へ変換する。 */
function escapeCell(value: string) {
  const safeValue = neutralizeFormula(value)
  return /[",\r\n\t]/u.test(safeValue)
    ? `"${safeValue.replaceAll('"', '""')}"`
    : safeValue
}

/** 単一カードの原文・訳文を領域ID付きCSVへ変換する。 */
export function serializeTranslationCsv(
  regions: readonly TextRegion[],
): string {
  const rows = regions.map(region =>
    [region.regionId, region.originalText, region.translatedText]
      .map(escapeCell)
      .join(','),
  )
  return ['region_id,original,translation', ...rows].join('\r\n')
}

/** カードIDを含めたプロジェクト全体の翻訳CSVを作る。 */
export function serializeProjectTranslationCsv(
  cards: readonly TranslationCard[],
): string {
  const rows = cards.flatMap(card =>
    card.regions.map(region =>
      [
        card.id,
        card.imageName,
        region.regionId,
        region.displayName,
        region.originalText,
        region.translatedText,
      ]
        .map(escapeCell)
        .join(','),
    ),
  )
  return [
    '\uFEFFcard_id,card_name,region_id,display_name (readonly),original,translation',
    ...rows,
  ].join('\r\n')
}

/** カードIDと領域IDで対応付ける。原文差異は警告として残し、重複時は後の行を採用する。 */
export function matchProjectTranslationRows(
  cards: readonly TranslationMatchCard[],
  activeCardId: string,
  rows: readonly TranslationRow[],
  excludedCardIds: ReadonlySet<string> = new Set(),
): TranslationMatchResult {
  const translationsByCard = new Map<string, Map<string, string>>()
  const seenKeys = new Set<string>()
  let unmatched = 0
  let duplicateRows = 0
  let originalMismatches = 0
  const issues: TranslationMatchIssue[] = []

  for (const [index, row] of rows.entries()) {
    const rowNumber = index + 2
    const cardId = row.cardId || activeCardId
    const card = cards.find(
      item => item.id === cardId && !excludedCardIds.has(item.id),
    )
    const region = card?.regions.find(item => item.regionId === row.regionId)
    if (!card || !region || !row.regionId) {
      unmatched += 1
      issues.push({
        kind: 'unmatched',
        rowNumber,
        cardId,
        regionId: row.regionId,
      })
      continue
    }
    if (row.original && row.original !== region.originalText) {
      originalMismatches += 1
      issues.push({
        kind: 'original-mismatch',
        rowNumber,
        cardId,
        regionId: row.regionId,
        importedOriginal: row.original,
        expectedOriginal: region.originalText,
      })
    }
    const key = `${cardId}\u0000${row.regionId}`
    if (seenKeys.has(key)) {
      duplicateRows += 1
      issues.push({
        kind: 'duplicate',
        rowNumber,
        cardId,
        regionId: row.regionId,
      })
    }
    seenKeys.add(key)
    const translations = translationsByCard.get(cardId) ?? new Map()
    translations.set(row.regionId, row.translation)
    translationsByCard.set(cardId, translations)
  }

  return {
    translationsByCard,
    applied: [...translationsByCard.values()].reduce(
      (total, translations) => total + translations.size,
      0,
    ),
    unmatched,
    duplicateRows,
    originalMismatches,
    issues,
  }
}
