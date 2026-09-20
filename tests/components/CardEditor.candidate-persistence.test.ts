// @vitest-environment happy-dom
import type { OCRResult, RegionCandidate } from '~/services/ocr/types'
import type { AssetDiscoveryState } from '~/types/asset-discovery'
import type { FolderProjectDocument } from '~/types/editor'
import { flushPromises } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { parseFolderProject, serializeFolderProject } from '~/services/project/format'
import { useProjectStore } from '~/stores/project'
import { createFolderProject, deferred, editorRuntime, folderProjectExists, mountSavedEditor, ocrIO, openFolderProject, saveFolderProject, unmountEditor } from './helpers/card-editor'

const result: OCRResult = {
  text: 'First line.\nSecond line.',
  confidence: 90,
  blocks: [
    { text: 'First line.', x: 20, y: 40, width: 100, height: 24, confidence: 90 },
    { text: 'Second line.', x: 20, y: 74, width: 100, height: 24, confidence: 80 },
  ],
}

it('saves adjusted single-card candidates and restores all fields and review badges without rerunning OCR', async () => {
  const { wrapper, toolbar, canvas } = await mountSavedEditor(false)
  const panel = wrapper.findComponent({ name: 'RegionCandidatePanel' })
  ocrIO.recognize.mockResolvedValue(result)
  panel.vm.$emit('detect')
  await flushPromises()
  expect(toolbar.props('saveStatus')).toBe('unsaved')
  panel.vm.$emit('split', 'candidate_1')
  await nextTick()
  panel.vm.$emit('toggle', 'candidate_1_b')
  canvas.vm.$emit('update-region-candidate-bounds', 'candidate_1_a', { x: 12, y: 15, width: 65, height: 22 })
  await nextTick()
  const candidates = JSON.parse(JSON.stringify(canvas.props('regionCandidates'))) as RegionCandidate[]
  expect(candidates).toHaveLength(2)
  expect(candidates[1]!.selected).toBe(false)
  expect(useProjectStore().document!.cards[0]!.ocrCandidates).toEqual(candidates)
  let saved!: FolderProjectDocument
  vi.mocked(saveFolderProject).mockImplementationOnce(async (_directory, document) => {
    saved = JSON.parse(serializeFolderProject(document)) as FolderProjectDocument
    return saved
  })
  toolbar.vm.$emit('save-project')
  await flushPromises()
  expect(toolbar.props('saveStatus')).toBe('saved')
  expect(saved.cards[0]!.regions).toEqual([])
  unmountEditor()
  const reopened = await mountSavedEditor(false)
  const restored = parseFolderProject(JSON.stringify(saved))
  vi.mocked(openFolderProject).mockResolvedValueOnce({
    directory: editorRuntime().directory.value!,
    document: restored,
    card: restored.cards[0]!,
    imageFile: new File(['image'], 'one.png', { type: 'image/png' }),
    assetFiles: new Map(),
  })
  const calls = ocrIO.recognize.mock.calls.length
  reopened.toolbar.vm.$emit('open-project')
  await flushPromises()
  expect(ocrIO.recognize).toHaveBeenCalledTimes(calls)
  expect(reopened.canvas.props('regionCandidates')).toEqual(candidates)
  expect(reopened.toolbar.props('saveStatus')).toBe('saved')
  expect(reopened.wrapper.findComponent({ name: 'CardList' }).props('batchOcrStates').get('one')).toEqual({ status: 'review', candidates: 2 })
  expect(reopened.wrapper.findComponent({ name: 'RegionCandidatePanel' }).props('canUndoChange')).toBe(false)
  reopened.wrapper.findComponent({ name: 'CardList' }).vm.$emit('select', 'two')
  await flushPromises()
  expect(reopened.canvas.props('regionCandidates')).toEqual([])
  reopened.wrapper.findComponent({ name: 'CardList' }).vm.$emit('select', 'one')
  await flushPromises()
  expect(reopened.canvas.props('regionCandidates')).toEqual(candidates)
})

it('keeps batch candidates when saving fails and removes confirmed or discarded candidates from persistence', async () => {
  const { wrapper, toolbar } = await mountSavedEditor(false)
  vi.stubGlobal('createImageBitmap', vi.fn().mockImplementation(async () => ({ width: 100, height: 140, close: vi.fn() })))
  ocrIO.recognize.mockResolvedValue(result)
  wrapper.findComponent({ name: 'CardList' }).vm.$emit('start-batch-ocr')
  await flushPromises()
  expect(useProjectStore().document!.cards.every(card => card.ocrCandidates?.length === 1)).toBe(true)
  const before = useProjectStore().snapshot()!
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.mocked(saveFolderProject).mockRejectedValueOnce(new Error('disk full'))
  toolbar.vm.$emit('save-project')
  await flushPromises()
  expect(useProjectStore().snapshot()).toEqual(before)
  expect(toolbar.props('saveStatus')).toBe('unsaved')
  wrapper.findComponent({ name: 'RegionCandidatePanel' }).vm.$emit('confirm')
  await flushPromises()
  expect(useProjectStore().document!.cards[0]!.ocrCandidates).toBeUndefined()
  expect(useProjectStore().document!.cards[0]!.regions).toHaveLength(1)
  wrapper.findComponent({ name: 'RegionCandidatePanel' }).vm.$emit('cancel')
  await flushPromises()
  expect(useProjectStore().document!.cards[1]!.ocrCandidates).toBeUndefined()
  expect(useProjectStore().document!.cards[1]!.regions).toEqual([])
  expect(useProjectStore().document!.cards[2]!.ocrCandidates).toHaveLength(1)
})

it('includes draft candidates in the first project save', async () => {
  const { wrapper, toolbar, canvas, project } = await mountSavedEditor(false)
  vi.mocked(folderProjectExists).mockResolvedValueOnce(false)
  toolbar.vm.$emit('open-project')
  await flushPromises()
  canvas.vm.$emit('image', new File(['image'], 'draft.png', { type: 'image/png' }))
  await flushPromises()
  ocrIO.recognize.mockResolvedValue(result)
  wrapper.findComponent({ name: 'RegionCandidatePanel' }).vm.$emit('detect')
  await flushPromises()
  expect(useProjectStore().draftOCRCandidates).toHaveLength(1)
  const draftId = wrapper.findComponent({ name: 'CardList' }).props('activeCardId') as string
  const discovery: AssetDiscoveryState = {
    occurrences: [{
      id: 'draft-icon',
      cardId: draftId,
      imageDigest: 'a'.repeat(64),
      imageSize: { width: useProjectStore().activeCard.imageWidth, height: useProjectStore().activeCard.imageHeight },
      bounds: { x: 40, y: 50, width: 10, height: 10 },
      detectedBounds: null,
      origin: 'manual',
      detectorRevision: 'manual',
      decision: 'pending',
      assetId: null,
      approval: null,
      owner: null,
    }],
    groups: [],
  }
  useProjectStore().setAssetDiscovery(discovery, draftId)
  vi.mocked(createFolderProject).mockImplementationOnce(async (_directory, card, _file, id, _assets, _fonts, _dictionary, _writes, _glossary, candidates, assetDiscovery) => ({
    ...project,
    activeCardId: id,
    cards: [{ ...project.cards[0]!, ...card, id, ocrCandidates: candidates }],
    assetDiscovery,
  }))
  toolbar.vm.$emit('save-project')
  await flushPromises()
  expect(createFolderProject).toHaveBeenCalledOnce()
  expect(useProjectStore().document!.cards[0]!.ocrCandidates).toEqual(canvas.props('regionCandidates'))
  expect(useProjectStore().draftOCRCandidates).toEqual([])
  expect(vi.mocked(createFolderProject).mock.calls[0]![10]).toEqual(discovery)
  expect(useProjectStore().document!.assetDiscovery).toEqual(discovery)
  expect(useProjectStore().draftAssetDiscovery).toBeUndefined()
  expect(toolbar.props('saveStatus')).toBe('saved')
})

it('does not persist a single-card result after the source image changes during OCR', async () => {
  const { wrapper } = await mountSavedEditor(false)
  const pending = deferred<OCRResult>()
  ocrIO.recognize.mockReturnValueOnce(pending.promise)
  wrapper.findComponent({ name: 'RegionCandidatePanel' }).vm.$emit('detect')
  await flushPromises()
  editorRuntime().cardImage.value = document.createElement('img')
  pending.resolve(result)
  await flushPromises()
  expect(useProjectStore().document!.cards.every(card => !card.ocrCandidates)).toBe(true)
})

it.each([false, true])('persists unchecked noise and word-refined headings for batch=%s', async (batch) => {
  const { wrapper } = await mountSavedEditor(false)
  vi.stubGlobal('createImageBitmap', vi.fn().mockImplementation(async () => ({ width: 100, height: 140, close: vi.fn() })))
  ocrIO.recognize.mockResolvedValue({
    text: '$ FOREST 4\nnoise text',
    confidence: 50,
    blocks: [
      { text: '$ FOREST 4', x: 10, y: 20, width: 170, height: 30, confidence: 55 },
      { text: 'noise text', x: 10, y: 180, width: 100, height: 20, confidence: 34 },
    ],
    words: [
      { text: '$', x: 10, y: 20, width: 30, height: 30, confidence: 14 },
      { text: 'FOREST', x: 50, y: 20, width: 90, height: 30, confidence: 93 },
      { text: '4', x: 150, y: 20, width: 30, height: 30, confidence: 58 },
    ],
  })
  if (batch)
    wrapper.findComponent({ name: 'CardList' }).vm.$emit('start-batch-ocr')
  else wrapper.findComponent({ name: 'RegionCandidatePanel' }).vm.$emit('detect')
  await flushPromises()
  const saved = parseFolderProject(serializeFolderProject(useProjectStore().snapshot()!))
  for (const card of batch ? saved.cards : saved.cards.slice(0, 1)) {
    expect(card.ocrCandidates).toHaveLength(2)
    expect(card.ocrCandidates![0]).toMatchObject({ text: 'FOREST', selected: true, x: 23, width: 49 })
    expect(card.ocrCandidates![1]).toMatchObject({ text: 'noise text', confidence: 34, selected: false })
  }
})
