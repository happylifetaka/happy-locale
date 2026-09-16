// @vitest-environment happy-dom
import { flushPromises } from '@vue/test-utils'
import { expect, it } from 'vitest'
import { nextTick } from 'vue'
import { mountSavedEditor } from './helpers/card-editor'

const texts = [{ originalText: 'First', translatedText: '前半' }, { originalText: 'Second', translatedText: '後半' }]

it('splits a region into two and restores the entire operation with one undo', async () => {
  const { wrapper, canvas, toolbar } = await mountSavedEditor()
  const original = JSON.parse(JSON.stringify(canvas.props('project').regions[0]))
  wrapper.findComponent({ name: 'RegionList' }).vm.$emit('split', 'region-0')
  await nextTick()
  wrapper.findComponent({ name: 'RegionSplitDialog' }).vm.$emit('apply', 'horizontal', 10, texts)
  await nextTick()
  expect(canvas.props('project').regions).toEqual([
    expect.objectContaining({ id: 'region-0', height: 10, originalText: 'First', translatedText: '前半' }),
    expect.objectContaining({ y: original.y + 10, height: original.height - 10, originalText: 'Second', translatedText: '後半' }),
  ])
  expect(wrapper.findComponent({ name: 'RegionSplitDialog' }).exists()).toBe(false)
  expect(wrapper.get('#inspector-tab-list').attributes('aria-selected')).toBe('true')
  toolbar.vm.$emit('undo')
  await nextTick()
  expect(canvas.props('project').regions).toEqual([original])
  toolbar.vm.$emit('redo')
  await nextTick()
  expect(canvas.props('project').regions).toHaveLength(2)
})

it.each(['region', 'card', 'cancel'] as const)('does not apply a split after %s changes', async (change) => {
  const { wrapper, canvas, inspector } = await mountSavedEditor()
  wrapper.findComponent({ name: 'RegionList' }).vm.$emit('split', 'region-0')
  await nextTick()
  const dialog = wrapper.findComponent({ name: 'RegionSplitDialog' })
  if (change === 'region')
    inspector.vm.$emit('update', 'region-0', { translatedText: 'Changed' })
  else if (change === 'card')
    wrapper.findComponent({ name: 'CardList' }).vm.$emit('select', 'two')
  else
    dialog.vm.$emit('close')
  await flushPromises()
  const before = JSON.stringify(canvas.props('project'))
  if (change !== 'cancel')
    dialog.vm.$emit('apply', 'horizontal', 10, texts)
  await nextTick()
  expect(JSON.stringify(canvas.props('project'))).toBe(before)
  expect(wrapper.findComponent({ name: 'RegionSplitDialog' }).exists()).toBe(false)
})

it('moves internal coordinates with the region and preserves image positions on resize, with undo', async () => {
  const { canvas, inspector, toolbar } = await mountSavedEditor()
  const original = canvas.props('project').regions[0]
  inspector.vm.$emit('update', 'region-0', {
    x: 10,
    y: 10,
    width: 50,
    height: 30,
    exclusionAreas: [{ id: 'protected', x: 15, y: 12, width: 10, height: 8 }],
    manualMaskStrokes: [{ brushSize: 4, mode: 'paint', points: [{ x: 15, y: 12 }] }],
    sourceIcons: [{ id: 'icon', assetId: 'asset', x: 15, y: 12, width: 10, height: 8 }],
  })
  await nextTick()
  canvas.vm.$emit('update-region-bounds', original.id, { x: 20, y: 20, width: 50, height: 30 })
  await nextTick()
  const moved = JSON.parse(JSON.stringify(canvas.props('project').regions[0]))
  expect(moved.exclusionAreas[0]).toMatchObject({ x: 15, y: 12 })
  expect(moved.manualMaskStrokes[0].points).toEqual([{ x: 15, y: 12 }])
  canvas.vm.$emit('update-region-bounds', original.id, { x: 25, y: 24, width: 45, height: 26 })
  await nextTick()
  const resized = canvas.props('project').regions[0]
  expect(resized.exclusionAreas[0]).toMatchObject({ x: 10, y: 8 })
  expect(resized.manualMaskStrokes[0].points).toEqual([{ x: 10, y: 8 }])
  expect(resized.sourceIcons[0]).toMatchObject({ x: 10, y: 8 })
  toolbar.vm.$emit('undo')
  await nextTick()
  expect(canvas.props('project').regions[0]).toEqual(moved)
})

it('records each mask stroke independently and copies mutable stroke points', async () => {
  const { canvas, toolbar } = await mountSavedEditor()
  const stroke = { brushSize: 10, mode: 'paint', points: [{ x: 5, y: 5 }] }
  canvas.vm.$emit('add-mask-stroke', 'region-0', stroke)
  stroke.points[0]!.x = 99
  await nextTick()
  canvas.vm.$emit('add-mask-stroke', 'region-0', { brushSize: 4, mode: 'erase', points: [{ x: 5, y: 5 }] })
  await nextTick()
  expect(canvas.props('project').regions[0].manualMaskStrokes).toHaveLength(2)
  toolbar.vm.$emit('undo')
  await nextTick()
  expect(canvas.props('project').regions[0].manualMaskStrokes).toEqual([{ brushSize: 10, mode: 'paint', points: [{ x: 5, y: 5 }] }])
  toolbar.vm.$emit('undo')
  await nextTick()
  expect(canvas.props('project').regions[0].manualMaskStrokes).toEqual([])
})

it('updates and removes only the selected exclusion and restores it with undo', async () => {
  const { canvas, inspector, toolbar } = await mountSavedEditor()
  canvas.vm.$emit('add-exclusion', 'region-0', { x: 2, y: 2, width: 5, height: 5 })
  canvas.vm.$emit('add-exclusion', 'region-0', { x: 12, y: 12, width: 5, height: 5 })
  await nextTick()
  const id = canvas.props('project').regions[0].exclusionAreas[0].id
  canvas.vm.$emit('update-exclusion', 'region-0', id, { x: 4, y: 4, width: 6, height: 6 })
  await nextTick()
  expect(canvas.props('project').regions[0].exclusionAreas).toEqual([
    expect.objectContaining({ id, x: 4, y: 4, width: 6, height: 6 }),
    expect.objectContaining({ x: 12, y: 12, width: 5, height: 5 }),
  ])
  inspector.vm.$emit('remove-exclusion', 'region-0', id)
  await nextTick()
  expect(canvas.props('project').regions[0].exclusionAreas).toHaveLength(1)
  toolbar.vm.$emit('undo')
  await nextTick()
  expect(canvas.props('project').regions[0].exclusionAreas).toHaveLength(2)
})
