import { DEFAULT_PRINT_SETTINGS } from '~/services/print-layout'
import { isRecord, string } from './values'

/** 現在書き出すカードプロジェクトの形式バージョン。 */
export const CURRENT_PROJECT_VERSION = 4

/** 旧形式を正規化処理で扱える形へ移す。個々の値の検証は後段で行う。 */
export function migrateProjectDocument(value: unknown): unknown {
  if (!isRecord(value))
    return value
  if (value.version === CURRENT_PROJECT_VERSION)
    return value
  if (value.version === 2 || value.version === 3)
    return { ...value, version: CURRENT_PROJECT_VERSION }
  const legacyVersion = value.version === 0 || value.version === undefined
  if (!legacyVersion && value.version !== 1)
    return value
  if (!Array.isArray(value.cards))
    return value
  const firstCard = value.cards.find(isRecord)
  return {
    ...value,
    version: CURRENT_PROJECT_VERSION,
    activeCardId: string(value.activeCardId, string(firstCard?.id)),
    assets: Array.isArray(value.assets) ? value.assets : [],
    fonts: Array.isArray(value.fonts) ? value.fonts : [],
    ocrDictionary: Array.isArray(value.ocrDictionary)
      ? value.ocrDictionary
      : [],
    glossary: Array.isArray(value.glossary) ? value.glossary : [],
    cards: value.cards.map(card => isRecord(card)
      ? { ...card, printArea: null, sourceDpi: null }
      : card),
    printSettings: DEFAULT_PRINT_SETTINGS,
  }
}
