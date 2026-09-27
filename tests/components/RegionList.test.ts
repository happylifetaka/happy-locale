// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import RegionList from '~/components/RegionList.vue'
import { useCardEditor } from '~/composables/useCardEditor'

function setup() {
  const editor = useCardEditor()
  editor.loadImageProject('test.png', 100, 200)
  for (let i = 0; i < 3; i++)
    editor.addRegion({ x: 0, y: i * 30, width: 20, height: 20 }, '#fff')
  const regions = editor.project.value.regions
  regions.forEach((region, index) => {
    region.originalText = index === 1 ? 'hidden' : 'match'
  })
  return { regions, wrapper: mount(RegionList, { props: { regions, selectedId: regions[0]!.id } }) }
}

it('moves relative to visible targets without emitting selection and ignores external or cancelled drags', async () => {
  const { wrapper, regions } = setup()
  const dataTransfer = { effectAllowed: '', dropEffect: '', setData: vi.fn() }
  await wrapper.get('input[type="search"]').setValue('match')
  const rows = wrapper.findAll('.region-list-item')
  expect(rows).toHaveLength(2)
  await rows[1]!.trigger('drop', { dataTransfer, clientY: 10 })
  expect(wrapper.emitted('move')).toBeUndefined()
  await rows[0]!.get('.region-list-drag-handle').trigger('dragstart', { dataTransfer })
  await rows[1]!.trigger('dragover', { dataTransfer, clientY: 10 })
  expect(rows[1]!.classes()).toContain('region-list-drop-after')
  await rows[1]!.trigger('drop', { dataTransfer, clientY: 10 })
  expect(wrapper.emitted('move')).toEqual([[regions[0]!.id, regions[2]!.id, 'after']])
  expect(wrapper.emitted('select')).toBeUndefined()
  await rows[0]!.get('.region-list-drag-handle').trigger('dragstart', { dataTransfer })
  await rows[0]!.get('.region-list-drag-handle').trigger('dragend')
  await rows[1]!.trigger('drop', { dataTransfer, clientY: 10 })
  expect(wrapper.emitted('move')).toHaveLength(1)
  await rows[0]!.get('.region-list-drag-handle').trigger('dragstart', { dataTransfer })
  await wrapper.setProps({ regions: [...regions] })
  await rows[1]!.trigger('drop', { dataTransfer, clientY: 10 })
  expect(wrapper.emitted('move')).toHaveLength(1)
  wrapper.unmount()
})
