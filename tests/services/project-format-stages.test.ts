import { expect, it } from 'vitest'
import { DEFAULT_PRINT_SETTINGS } from '~/services/print-layout'
import * as format from '~/services/project/format'
import { assertProjectComplexity, assertProjectIntegrity } from '~/services/project/format/integrity'
import { migrateProjectDocument } from '~/services/project/format/migrations'
import { normalizeRegion } from '~/services/project/format/regions'
import { FILE_LIMITS } from '~/utils/file-limits'
import { baselineProject } from '../fixtures/refactoring-baseline'

it('retains only the existing format facade exports', () => {
  expect(Object.keys(format).sort()).toEqual([
    'CURRENT_PROJECT_VERSION',
    'isSafeAssetImagePath',
    'isSafeCardImagePath',
    'isSafeProjectPath',
    'parseFolderProject',
    'serializeFolderProject',
    'toCardProject',
  ])
  expect(format.CURRENT_PROJECT_VERSION).toBe(3)
})

it.each([undefined, 0, 1])('migrates legacy version %s without mutating its input or validating field values early', (version) => {
  const legacy = { ...baselineProject(), version, activeCardId: undefined, glossary: undefined }
  const before = structuredClone(legacy)
  const migrated = migrateProjectDocument(legacy)
  expect(migrated).toEqual({
    ...legacy,
    version: 3,
    activeCardId: 'synthetic-1',
    glossary: [],
    cards: legacy.cards.map(card => ({ ...card, printArea: null, sourceDpi: null })),
    printSettings: DEFAULT_PRINT_SETTINGS,
  })
  expect(legacy).toEqual(before)
  const malformed = { ...legacy, cards: [null] }
  expect(migrateProjectDocument(malformed)).toMatchObject({ version: 3, cards: [null] })
  expect(() => format.parseFolderProject(JSON.stringify(malformed))).toThrow('cards[0].id')
})

it('preserves version 2 settings and leaves current/unknown versions to the codec gate', () => {
  const current = baselineProject()
  const version2 = { ...current, version: 2 }
  expect(migrateProjectDocument(version2)).toEqual(current)
  expect(version2.version).toBe(2)
  expect(migrateProjectDocument(current)).toBe(current)
  const future = { ...current, version: 4 }
  expect(migrateProjectDocument(future)).toBe(future)
  expect(() => format.parseFolderProject(JSON.stringify(future))).toThrow('対応していない')
  expect(migrateProjectDocument(null)).toBeNull()
})

it('keeps complexity rejection before detailed item validation on both codec paths', () => {
  const project = baselineProject()
  project.cards[0]!.id = ''
  project.cards[0]!.regions = Array.from({ length: FILE_LIMITS.projectRegionsPerCard + 1 }, () => ({ id: '' })) as never
  expect(() => assertProjectComplexity(project)).toThrow('文字領域は')
  expect(() => assertProjectIntegrity(project)).toThrow('カードIDを入力')
  expect(() => format.parseFolderProject(JSON.stringify(project))).toThrow('文字領域は')
  expect(() => format.serializeFolderProject(project)).toThrow('文字領域は')
})

it('normalizes region defaults without changing inputs and keeps candidates outside editing history', () => {
  const raw = { id: 'region-1', width: -2, fontSize: 0, translatedText: '訳文', textStyles: [{ start: 3, end: 1 }] }
  const before = structuredClone(raw)
  const region = normalizeRegion(raw, 0)!
  expect(region).toMatchObject({ regionId: 'region_1', width: 0, fontSize: 1, translationStatus: 'draft', textStyles: [] })
  expect(raw).toEqual(before)
  const card = { ...baselineProject().cards[0]!, regions: [region], ocrCandidates: [] }
  const editing = format.toCardProject(card)
  expect(Object.keys(editing)).toEqual(['imageName', 'imageWidth', 'imageHeight', 'regions'])
  // Ownership is unchanged: this adapter selects fields; history creates its own snapshots.
  expect(editing.regions).toBe(card.regions)
})

it('validates writes without silently serializing the normalized replacement', () => {
  const project = baselineProject()
  project.glossary = [{ id: 'entry', source: ' Ally ', translation: ' 味方 ', note: ' note ' }]
  const before = structuredClone(project)
  const written = format.serializeFolderProject(project)
  expect(written).toBe(`${JSON.stringify(project, null, 2)}\n`)
  expect(format.parseFolderProject(written).glossary[0]).toEqual({ id: 'entry', source: 'Ally', translation: '味方', note: 'note' })
  expect(project).toEqual(before)
})
