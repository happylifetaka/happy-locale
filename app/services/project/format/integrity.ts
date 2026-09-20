import { FILE_LIMITS } from '~/utils/file-limits'
import { normalizeAsset, normalizeCard, normalizeFont, normalizeGlossaryEntry, normalizeOCRDictionaryEntry } from './entities'
import { normalizeExclusion, normalizeRegion } from './regions'
import { isRecord, string } from './values'

/** 不正な項目の場所と理由を含む読み込みエラーを送出する。 */
function invalidItem(path: string, reason: string): never {
  throw new Error(`project.jsonの${path}が不正です（${reason}）。`)
}

/** 識別子等の重複を検出して読み込みエラーにする。 */
function assertUnique(
  values: readonly unknown[],
  path: string,
  key: string,
  label: string,
): void {
  const seen = new Set<string>()
  values.forEach((value, index) => {
    if (!isRecord(value) || typeof value[key] !== 'string' || !value[key].trim())
      invalidItem(`${path}[${index}].${key}`, `${label}を入力してください`)
    const identifier = value[key]
    if (seen.has(identifier))
      throw new Error(`project.jsonの${label}「${identifier}」が重複しています。`)
    seen.add(identifier)
  })
}

/** 読み込み時にID・名前の重複と各項目の形式を検証する。 */
export function assertProjectIntegrity(value: unknown): void {
  if (!isRecord(value))
    return
  const cards = value.cards
  if (!Array.isArray(cards))
    return

  assertUnique(cards, 'cards', 'id', 'カードID')
  cards.forEach((card, cardIndex) => {
    if (!normalizeCard(card))
      invalidItem(`cards[${cardIndex}]`, 'カードIDまたは画像パスを確認してください')
    const regions = isRecord(card) && Array.isArray(card.regions)
      ? card.regions
      : []
    assertUnique(regions, `cards[${cardIndex}].regions`, 'id', '領域ID')
    assertUnique(
      regions.map((region, regionIndex) => isRecord(region)
        ? { regionId: string(region.regionId, `region_${regionIndex + 1}`) }
        : region),
      `cards[${cardIndex}].regions`,
      'regionId',
      'region_id',
    )
    regions.forEach((region, regionIndex) => {
      if (!normalizeRegion(region, regionIndex)) {
        invalidItem(
          `cards[${cardIndex}].regions[${regionIndex}]`,
          '領域IDを確認してください',
        )
      }
      const exclusions = isRecord(region) && Array.isArray(region.exclusionAreas)
        ? region.exclusionAreas
        : []
      assertUnique(
        exclusions,
        `cards[${cardIndex}].regions[${regionIndex}].exclusionAreas`,
        'id',
        '保護領域ID',
      )
      exclusions.forEach((exclusion, exclusionIndex) => {
        if (!normalizeExclusion(exclusion)) {
          invalidItem(
            `cards[${cardIndex}].regions[${regionIndex}].exclusionAreas[${exclusionIndex}]`,
            '保護領域IDを確認してください',
          )
        }
      })
    })
  })

  const collections = [
    ['assets', value.assets, normalizeAsset, 'アセットID'],
    ['fonts', value.fonts, normalizeFont, 'フォントID'],
    ['ocrDictionary', value.ocrDictionary, normalizeOCRDictionaryEntry, 'OCR辞書ID'],
    ['glossary', value.glossary, normalizeGlossaryEntry, '用語集ID'],
  ] as const
  for (const [path, collection, normalize, label] of collections) {
    if (!Array.isArray(collection))
      continue
    assertUnique(collection, path, 'id', label)
    collection.forEach((item, index) => {
      if (!normalize(item))
        invalidItem(`${path}[${index}]`, `${label}と必須項目を確認してください`)
    })
  }

  if (Array.isArray(value.assets))
    assertUnique(value.assets, 'assets', 'name', 'アセット名')
}

/** 大量の領域やマスク点による負荷を、詳細な正規化や描画に進む前に制限する。 */
export function assertProjectComplexity(value: unknown): void {
  if (!isRecord(value))
    return
  if (Array.isArray(value.cards) && value.cards.length > FILE_LIMITS.projectCards)
    throw new Error(`カードは${FILE_LIMITS.projectCards}件以下にしてください。`)
  if (Array.isArray(value.assets) && value.assets.length > FILE_LIMITS.projectAssets)
    throw new Error(`アセットは${FILE_LIMITS.projectAssets}件以下にしてください。`)
  if (Array.isArray(value.cards)) {
    for (const card of value.cards) {
      if (
        isRecord(card)
        && Array.isArray(card.regions)
        && card.regions.length > FILE_LIMITS.projectRegionsPerCard
      ) {
        throw new Error(
          `カードごとの文字領域は${FILE_LIMITS.projectRegionsPerCard}件以下にしてください。`,
        )
      }
    }
  }

  const pending: unknown[] = [value]
  while (pending.length > 0) {
    const current = pending.pop()
    if (typeof current === 'string') {
      if (current.length > FILE_LIMITS.projectStringLength) {
        throw new Error(
          `project.json内の文字列は${FILE_LIMITS.projectStringLength}文字以下にしてください。`,
        )
      }
    }
    else if (Array.isArray(current)) {
      if (current.length > FILE_LIMITS.csvRows)
        throw new Error('project.json内の配列要素数が上限を超えています。')
      pending.push(...current)
    }
    else if (isRecord(current)) {
      pending.push(...Object.values(current))
    }
  }
}
