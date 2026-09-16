// @vitest-environment happy-dom
import { flushPromises } from '@vue/test-utils'
import { expect, it } from 'vitest'
import { nextTick } from 'vue'
import { useProjectStore } from '~/stores/project'
import { mountSavedEditor } from './helpers/card-editor'

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
