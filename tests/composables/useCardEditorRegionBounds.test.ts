import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, expect, it, vi } from 'vitest'
import { useCardEditor } from '~/composables/useCardEditor'
import { adoptRegionProposal, compareRegionProposal } from '~/services/asset-discovery/region-proposal'
import { parseFolderProject, serializeFolderProject } from '~/services/project/format'
import { useProjectStore } from '~/stores/project'
import { savedProjectSignature } from '~/utils/project-save'
import { discoveryProject } from '../fixtures/asset-discovery'

beforeEach(() => setActivePinia(createPinia()))

function setup() {
  const store = useProjectStore()
  const project = discoveryProject()
  store.replaceProject(project)
  const publish = vi.fn((id: string | null, card: Parameters<typeof store.updateCard>[1]) => store.updateCard(id, card))
  const editor = useCardEditor(publish)
  editor.loadSavedProject(project.cards[0]!, project.activeCardId)
  for (const y of [10, 110]) {
    editor.addRegion({ x: 10, y, width: 170, height: 70 }, '#123456')
    editor.updateRegion(editor.selectedRegionId.value!, {
      originalText: 'Original [icon:synthetic-icon]',
      translatedText: '既存の訳',
      translationStatus: 'reviewed',
      sourceIcons: [{ id: `source-${y}`, assetId: 'asset-1', x: 20, y: 20, width: 12, height: 12 }],
      exclusionAreas: [{ id: `protected-${y}`, x: 35, y: 20, width: 10, height: 10 }],
      manualMaskStrokes: [{ brushSize: 8, mode: 'paint', points: [{ x: 50, y: 40 }, { x: 70, y: 40 }] }],
    })
  }
  editor.loadSavedProject(editor.project.value, project.activeCardId)
  editor.selectedRegionId.value = editor.project.value.regions[0]!.id
  publish.mockClear()
  const changes = editor.project.value.regions.map(region => ({ id: region.id, bounds: { x: region.x - 2, y: region.y - 2, width: region.width + 4, height: region.height + 4 } }))
  return { store, editor, publish, changes, cardId: project.activeCardId }
}

it('publishes multiple bounds changes once, preserving text and original-image positions in one Undo/Redo', () => {
  const s = setup()
  const before = s.store.snapshot()!
  const original = structuredClone(s.editor.project.value)
  const signature = savedProjectSignature(before)
  const selected = s.editor.selectedRegionId.value
  s.editor.applyRegionBounds(s.changes)
  expect(s.publish).toHaveBeenCalledOnce()
  expect(s.editor.selectedRegionId.value).toBe(selected)
  expect(s.store.document!.cards[0]!.ocrCandidates).toEqual(before.cards[0]!.ocrCandidates)
  expect(s.store.assetDiscovery).toEqual(before.assetDiscovery)
  expect(savedProjectSignature(s.store.snapshot()!)).not.toBe(signature)
  const restored = parseFolderProject(serializeFolderProject(s.store.snapshot()!)).cards[0]!.regions
  // 保存形式は既定のpaintを省略する。描画上の意味を正規化して比較する。
  expect(restored.map(region => ({ ...region, manualMaskStrokes: region.manualMaskStrokes.map(stroke => ({ ...stroke, mode: stroke.mode ?? 'paint' })) }))).toEqual(s.editor.project.value.regions)
  for (const [i, region] of s.editor.project.value.regions.entries()) {
    const old = original.regions[i]!
    expect(region).toMatchObject({ id: old.id, regionId: old.regionId, originalText: old.originalText, translatedText: old.translatedText, translationStatus: 'reviewed' })
    expect(region.sourceIcons![0]).toMatchObject({ x: 22, y: 22, width: 12, height: 12 })
    expect(region.x + region.sourceIcons![0]!.x).toBe(old.x + old.sourceIcons![0]!.x)
    expect(region.y + region.exclusionAreas[0]!.y).toBe(old.y + old.exclusionAreas[0]!.y)
    expect(region.manualMaskStrokes[0]!.points[0]).toEqual({ x: 52, y: 42 })
  }
  const edited = structuredClone(s.editor.project.value)
  s.changes[0]!.bounds.x = 100
  expect(s.editor.project.value).toEqual(edited)
  s.editor.undo()
  expect(s.editor.project.value).toEqual(original)
  expect(savedProjectSignature(s.store.snapshot()!)).toBe(signature)
  expect(s.editor.canUndo.value).toBe(false)
  s.editor.redo()
  expect(s.editor.project.value).toEqual(edited)
  expect(s.store.activeCard.regions).toEqual(edited.regions)
})

it('accepts explicitly chosen confirmed-region differences from the comparison service in one editor operation', () => {
  const s = setup()
  const card = s.store.document!.cards[0]!
  const scope = { imageDigest: 'a'.repeat(64), revision: 1, session: Symbol('review') }
  const candidates = s.changes.map((change, i) => ({ ...change.bounds, id: `detected-${i}`, text: 'New OCR must not overwrite the source', confidence: 90, selected: true, lines: [] }))
  const review = compareRegionProposal(card, { cardId: card.id, imageDigest: scope.imageDigest, imageWidth: card.imageWidth, imageHeight: card.imageHeight, candidates }, scope)
  const adopted = adoptRegionProposal(card, review, s.changes.map((change, i) => ({ action: 'bounds', detectedId: `detected-${i}`, target: { kind: 'region', id: change.id } })), scope)
  s.editor.applyRegionBounds(adopted.regions.map(region => ({ id: region.id, bounds: region })))
  expect(s.editor.project.value.regions).toEqual(adopted.regions)
  expect(s.publish).toHaveBeenCalledOnce()
  s.editor.undo()
  expect(s.editor.project.value.regions).toEqual(card.regions)
})

it.each(['unknown', 'duplicate', 'outside', 'nan', 'icon', 'protection', 'mask', 'mask-expansion'] as const)('rejects the whole operation for %s without state, history or publication changes', (kind) => {
  const s = setup()
  if (kind === 'mask-expansion') {
    s.editor.updateRegion(s.changes[1]!.id, { manualMaskStrokes: [{ brushSize: 20, points: [{ x: 1, y: 20 }] }] })
    s.editor.loadSavedProject(s.editor.project.value, s.cardId)
    s.publish.mockClear()
  }
  const before = s.store.snapshot()
  const current = structuredClone(s.editor.project.value)
  if (kind === 'unknown')
    s.changes[1]!.id = 'missing'
  if (kind === 'duplicate')
    s.changes[1]!.id = s.changes[0]!.id
  if (kind === 'outside')
    s.changes[1]!.bounds.width = 300
  if (kind === 'nan')
    s.changes[1]!.bounds.x = Number.NaN
  if (kind === 'icon')
    s.changes[1]!.bounds = { x: 35, y: 110, width: 145, height: 70 }
  if (kind === 'protection')
    s.changes[1]!.bounds = { x: 10, y: 110, width: 40, height: 70 }
  if (kind === 'mask')
    s.changes[1]!.bounds = { x: 10, y: 110, width: 170, height: 42 }
  expect(() => s.editor.applyRegionBounds(s.changes)).toThrow()
  expect(s.editor.project.value).toEqual(current)
  expect(s.store.snapshot()).toEqual(before)
  expect(s.publish).not.toHaveBeenCalled()
  expect(s.editor.canUndo.value).toBe(false)
  expect(s.editor.canRedo.value).toBe(false)
})

it('keeps the redo branch on empty or identical changes and preserves unselected regions', () => {
  const s = setup()
  const untouched = structuredClone(s.editor.project.value.regions[1]!)
  s.editor.applyRegionBounds(s.changes.slice(0, 1))
  expect(s.editor.project.value.regions[1]).toEqual(untouched)
  s.editor.undo()
  s.publish.mockClear()
  s.editor.applyRegionBounds([])
  s.editor.applyRegionBounds(s.editor.project.value.regions.map(region => ({ id: region.id, bounds: region })))
  expect(s.publish).not.toHaveBeenCalled()
  expect(s.editor.canUndo.value).toBe(false)
  expect(s.editor.canRedo.value).toBe(true)
  s.editor.redo()
  expect(s.editor.project.value.regions[0]!.x).toBe(8)
})

it('retains the atomic bounds edit in card-specific history after switching away and back', () => {
  const s = setup()
  const original = structuredClone(s.editor.project.value)
  s.editor.applyRegionBounds(s.changes)
  const edited = structuredClone(s.editor.project.value)
  s.editor.switchSavedProject('other', { ...original, imageName: 'other.png', regions: [] })
  s.editor.switchSavedProject(s.cardId, edited)
  s.publish.mockClear()
  s.editor.undo()
  expect(s.publish).toHaveBeenCalledExactlyOnceWith(s.cardId, original)
  expect(s.editor.project.value).toEqual(original)
  s.editor.redo()
  expect(s.editor.project.value).toEqual(edited)
})
