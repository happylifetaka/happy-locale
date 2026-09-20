import type { CardProject, FolderProjectCard, FolderProjectDocument, FontReference, GlossaryEntry, ImageAsset, OCRDictionaryEntry } from '~/types/editor'
import { FILE_LIMITS } from '~/utils/file-limits'
import { normalizeAsset, normalizeCard, normalizeFont, normalizeGlossaryEntry, normalizeLayoutTemplates, normalizeOCRDictionaryEntry, normalizePrintSettings } from './entities'
import { assertProjectComplexity, assertProjectIntegrity } from './integrity'
import { CURRENT_PROJECT_VERSION, migrateProjectDocument } from './migrations'
import { isRecord, string } from './values'

/** 容量・複雑さ・整合性を検証したうえで正規化し、外部JSONをアプリ内の型へ取り込む。 */
export function parseFolderProject(text: string): FolderProjectDocument {
  if (new Blob([text]).size > FILE_LIMITS.textBytes)
    throw new Error('project.jsonは20 MiB以下にしてください。')
  let value: unknown
  try {
    value = JSON.parse(text)
  }
  catch {
    throw new Error('project.jsonが正しいJSONではありません。')
  }
  value = migrateProjectDocument(value)
  assertProjectComplexity(value)
  if (
    !isRecord(value)
    || value.version !== CURRENT_PROJECT_VERSION
    || !Array.isArray(value.cards)
  ) {
    throw new Error('対応していないプロジェクト形式です。')
  }
  assertProjectIntegrity(value)
  const cards = value.cards
    .map(normalizeCard)
    .filter((card): card is FolderProjectCard => card !== null)
  if (cards.length === 0) {
    throw new Error('プロジェクトに読み込めるカードがありません。')
  }
  const requestedActiveId = string(value.activeCardId)
  const activeCardId = cards.some(card => card.id === requestedActiveId)
    ? requestedActiveId
    : cards[0]!.id
  return {
    version: CURRENT_PROJECT_VERSION,
    name: string(value.name, 'HappyLocale Project'),
    ...(value.demoPreset === 'sample-v1' ? { demoPreset: 'sample-v1' as const } : {}),
    ...(value.layoutTemplates !== undefined ? { layoutTemplates: normalizeLayoutTemplates(value.layoutTemplates) } : {}),
    activeCardId,
    cards,
    assets: Array.isArray(value.assets)
      ? value.assets
          .map(normalizeAsset)
          .filter((asset): asset is ImageAsset => asset !== null)
      : [],
    fonts: Array.isArray(value.fonts)
      ? value.fonts
          .map(normalizeFont)
          .filter((font): font is FontReference => font !== null)
      : [],
    ocrDictionary: Array.isArray(value.ocrDictionary)
      ? value.ocrDictionary
          .map(normalizeOCRDictionaryEntry)
          .filter((entry): entry is OCRDictionaryEntry => entry !== null)
      : [],
    glossary: Array.isArray(value.glossary)
      ? value.glossary
          .map(normalizeGlossaryEntry)
          .filter((entry): entry is GlossaryEntry => entry !== null)
      : [],
    printSettings: normalizePrintSettings(value.printSettings),
  }
}

/** フォルダプロジェクトを保存用JSONへ変換する。 */
export function serializeFolderProject(project: FolderProjectDocument): string {
  if (project.version !== CURRENT_PROJECT_VERSION)
    throw new Error('対応していないプロジェクト形式です。')
  assertProjectComplexity(project)
  assertProjectIntegrity(project)
  if (project.layoutTemplates !== undefined)
    normalizeLayoutTemplates(project.layoutTemplates)
  return `${JSON.stringify(project, null, 2)}\n`
}

/** 保存カードから編集履歴に必要な情報だけを取り出す。 */
export function toCardProject(card: FolderProjectCard): CardProject {
  return {
    imageName: card.imageName,
    imageWidth: card.imageWidth,
    imageHeight: card.imageHeight,
    regions: card.regions,
  }
}
