// @vitest-environment happy-dom
import { flushPromises } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { useProjectStore } from '~/stores/project'
import { editorRuntime, mountSavedEditor, ocrIO } from './helpers/card-editor'

const icon = { id: 'icon-1', assetId: 'asset-1', x: 2, y: 2, width: 8, height: 8 }

async function setup() {
  const context = await mountSavedEditor()
  useProjectStore().setAssets([{
    id: 'asset-1',
    name: 'coin',
    sourceImageId: 'one',
    imagePath: 'assets/coin.png',
    sourceRect: { x: 0, y: 0, width: 8, height: 8 },
    scale: 1,
    baselineOffset: 0,
    inlinePadding: 0,
  }])
  context.canvas.vm.$emit('select-region', 'region-0')
  await nextTick()
  context.inspector.vm.$emit('source-icons')
  await nextTick()
  return { ...context, dialog: context.wrapper.getComponent({ name: 'SourceIconsDialog' }) }
}

it('applies source icons through history and opens OCR after acceptance', async () => {
  const { wrapper, canvas, toolbar, dialog } = await setup()
  dialog.vm.$emit('apply', [icon])
  await nextTick()
  expect(canvas.props('project').regions[0].sourceIcons).toEqual([icon])
  expect(wrapper.findComponent({ name: 'SourceIconsDialog' }).exists()).toBe(false)
  expect(wrapper.get('#inspector-tab-ocr').attributes('aria-selected')).toBe('true')
  toolbar.vm.$emit('undo')
  await nextTick()
  expect(canvas.props('project').regions[0].sourceIcons ?? []).toEqual([])
})

it.each(['region', 'card', 'cancel'] as const)('does not apply source icons after %s changes', async (change) => {
  const { wrapper, canvas, inspector, dialog } = await setup()
  if (change === 'region')
    inspector.vm.$emit('update', 'region-0', { translatedText: 'Changed' })
  else if (change === 'card')
    wrapper.getComponent({ name: 'CardList' }).vm.$emit('select', 'two')
  else dialog.vm.$emit('close')
  await flushPromises()
  const before = JSON.stringify(canvas.props('project'))
  if (change !== 'cancel')
    dialog.vm.$emit('apply', [icon])
  await nextTick()
  expect(JSON.stringify(canvas.props('project'))).toBe(before)
  expect(wrapper.findComponent({ name: 'SourceIconsDialog' }).exists()).toBe(false)
})

it.each(['asset', 'bounds'] as const)('keeps the source icon draft open when %s is invalid', async (invalid) => {
  const { wrapper, canvas, dialog } = await setup()
  const before = JSON.stringify(canvas.props('project'))
  dialog.vm.$emit('apply', [{ ...icon, ...(invalid === 'asset' ? { assetId: 'missing' } : { width: 500 }) }])
  await nextTick()
  expect(JSON.stringify(canvas.props('project'))).toBe(before)
  expect(wrapper.findComponent({ name: 'SourceIconsDialog' }).exists()).toBe(true)
})

it('re-OCRs confirmed ranges and waits for text acceptance', async () => {
  const { canvas, inspector, dialog } = await setup()
  ocrIO.recognize.mockResolvedValue({
    text: 'Gain 2 .',
    confidence: 90,
    blocks: [],
    words: [
      { text: 'Gain', x: 12, y: 18, width: 45, height: 24, confidence: 90 },
      { text: '2', x: 60, y: 18, width: 9, height: 24, confidence: 90 },
      { text: '.', x: 99, y: 18, width: 3, height: 24, confidence: 90 },
    ],
  })
  const range = { ...icon, x: 20 }
  const original = canvas.props('project').regions[0].originalText
  dialog.vm.$emit('recognize', [range])
  await flushPromises()
  expect(ocrIO.prepareRegionForOCR).toHaveBeenCalledWith(expect.anything(), expect.anything(), { scale: 3, exclusions: [range] })
  expect(inspector.props('ocrCandidate')).toBe('Gain 2 [icon:coin] .')
  expect(canvas.props('project').regions[0].originalText).toBe(original)
  inspector.vm.$emit('apply-ocr-candidate')
  await nextTick()
  expect(canvas.props('project').regions[0].originalText).toBe('Gain 2 [icon:coin] .')
})

it.each(['cancel', 'card', 'region'])('discards a pending inline registration after %s changes', async (change) => {
  const { dialog, wrapper, inspector } = await setup()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  let finish!: BlobCallback
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => {
    finish = callback
  })
  const pending = dialog.props('createAsset')({
    editingAssetId: null,
    name: 'sun',
    sourceRect: { x: 2, y: 2, width: 8, height: 8 },
    removeBackground: true,
    backgroundColor: null,
    backgroundThreshold: 48,
    edgeFeather: 12,
    manualMaskStrokes: [],
  }, () => true)
  if (change === 'cancel')
    dialog.vm.$emit('close')
  else if (change === 'card')
    wrapper.getComponent({ name: 'CardList' }).vm.$emit('select', 'two')
  else
    inspector.vm.$emit('update', 'region-0', { originalText: 'Changed' })
  await flushPromises()
  finish(new Blob(['png']))
  expect(await pending).toBeNull()
  expect(useProjectStore().assets.map(asset => asset.name)).toEqual(['coin'])
})

it('stores a new inline asset and retains its PNG when the icon application is undone', async () => {
  const { dialog, toolbar } = await setup()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  const png = new Blob(['png'])
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback => callback(png))
  const asset = await dialog.props('createAsset')({
    editingAssetId: null,
    name: 'sun',
    sourceRect: { x: 2, y: 2, width: 8, height: 8 },
    removeBackground: true,
    backgroundColor: null,
    backgroundThreshold: 48,
    edgeFeather: 12,
    manualMaskStrokes: [],
  }, () => true)
  expect(asset).toMatchObject({ name: 'sun', sourceImageId: 'one' })
  dialog.vm.$emit('apply', [{ ...icon, assetId: asset!.id }])
  await nextTick()
  toolbar.vm.$emit('undo')
  await nextTick()
  expect(useProjectStore().assets).toContainEqual(asset)
  expect(editorRuntime().pendingAssetWrites.value.get(asset!.id)).toBe(png)
})
