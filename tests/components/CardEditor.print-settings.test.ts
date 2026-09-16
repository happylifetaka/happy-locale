// @vitest-environment happy-dom
import { flushPromises } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { useProjectStore } from '~/stores/project'
import { mountSavedEditor, saveFolderProject } from './helpers/card-editor'

const area = { x: 10, y: 14, width: 40, height: 56 }
const dpi = { x: 300, y: 200 }

it('updates and clears only the active card print area while preserving DPI and edit history', async () => {
  const { wrapper, canvas, inspector, toolbar } = await mountSavedEditor()
  const print = wrapper.findComponent({ name: 'PrintAreaInspector' })
  canvas.vm.$emit('select-region', 'region-0')
  await nextTick()
  inspector.vm.$emit('update', 'region-0', { translatedText: 'Changed' })
  print.vm.$emit('update-area', area)
  print.vm.$emit('update-dpi', dpi)
  await nextTick()
  const store = useProjectStore()
  expect(store.document!.cards[0]).toMatchObject({ printArea: area, sourceDpi: dpi })
  expect(store.document!.cards[1]).toMatchObject({ printArea: null, sourceDpi: null })
  expect(toolbar.props('saveStatus')).toBe('unsaved')
  print.vm.$emit('clear-area')
  await nextTick()
  expect(store.document!.cards[0]).toMatchObject({ printArea: null, sourceDpi: dpi })
  canvas.vm.$emit('update-print-area', area)
  toolbar.vm.$emit('undo')
  await nextTick()
  expect(store.document!.cards[0]).toMatchObject({ printArea: area, sourceDpi: dpi })
  expect(inspector.props('region').translatedText).toBe('Before 0')
  wrapper.findComponent({ name: 'CardList' }).vm.$emit('select', 'two')
  await flushPromises()
  print.vm.$emit('update-dpi', { x: 150, y: 150 })
  await nextTick()
  expect(store.document!.cards[0]!.sourceDpi).toEqual(dpi)
  expect(store.document!.cards[1]!.sourceDpi).toEqual({ x: 150, y: 150 })
})

it.each(['empty', 'area', 'dpi', 'both'] as const)('fills missing settings with scaled bounds while preserving %s settings', async (existing) => {
  const { wrapper } = await mountSavedEditor()
  const store = useProjectStore()
  const document = JSON.parse(JSON.stringify(store.document!)) as NonNullable<typeof store.document>
  const presetArea = { x: 3, y: 4, width: 50, height: 30 }
  const presetDpi = { x: 72, y: 96 }
  document.cards[0]!.printArea = area
  document.cards[0]!.sourceDpi = dpi
  document.cards[1] = {
    ...document.cards[1]!,
    imageWidth: 200,
    imageHeight: 70,
    printArea: existing === 'area' || existing === 'both' ? presetArea : null,
    sourceDpi: existing === 'dpi' || existing === 'both' ? presetDpi : null,
  }
  store.replaceProject(document)
  await nextTick()
  wrapper.findComponent({ name: 'PrintAreaInspector' }).vm.$emit('apply-to-others')
  await nextTick()
  expect(store.document!.cards[0]).toEqual(document.cards[0])
  expect(store.document!.cards[1]).toMatchObject({
    printArea: existing === 'area' || existing === 'both' ? presetArea : { x: 20, y: 7, width: 80, height: 28 },
    sourceDpi: existing === 'dpi' || existing === 'both' ? presetDpi : dpi,
  })
  expect(store.document!.cards[2]).toMatchObject({ printArea: area, sourceDpi: dpi })
})

it('does not apply settings to other cards without a source print area', async () => {
  const { wrapper } = await mountSavedEditor()
  const before = JSON.stringify(useProjectStore().document)
  wrapper.findComponent({ name: 'PrintAreaInspector' }).vm.$emit('apply-to-others')
  await nextTick()
  expect(JSON.stringify(useProjectStore().document)).toBe(before)
})

it('saves page settings and the DPI for the card selected in the print workspace', async () => {
  const { wrapper, toolbar } = await mountSavedEditor()
  wrapper.findComponent({ name: 'PrintAreaInspector' }).vm.$emit('update-area', area)
  wrapper.findComponent({ name: 'CardList' }).vm.$emit('open-print-layout')
  await nextTick()
  const workspace = wrapper.findComponent({ name: 'PrintLayoutWorkspace' })
  const settings = { columns: 2, marginMm: 12, gapMm: 3, cutMarks: false }
  workspace.vm.$emit('update-settings', settings)
  workspace.vm.$emit('update-dpi', 'two', dpi)
  await nextTick()
  const store = useProjectStore()
  expect(store.document!.cards[0]!.sourceDpi).toBeNull()
  expect(store.document!.cards[1]!.sourceDpi).toEqual(dpi)
  vi.mocked(saveFolderProject).mockResolvedValueOnce(JSON.parse(JSON.stringify(store.document)))
  workspace.vm.$emit('close')
  toolbar.vm.$emit('save-project')
  await flushPromises()
  const saved = vi.mocked(saveFolderProject).mock.calls[0]![1]
  expect(saved.printSettings).toEqual(settings)
  expect(saved.cards[0]!.printArea).toEqual(area)
  expect(saved.cards[1]!.sourceDpi).toEqual(dpi)
  expect(toolbar.props('saveStatus')).toBe('saved')
})
