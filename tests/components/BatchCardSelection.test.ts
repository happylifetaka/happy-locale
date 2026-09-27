// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { expect, it } from 'vitest'
import BatchCardSelection from '~/features/cards/BatchCardSelection.vue'
import { discoveryProject } from '../fixtures/asset-discovery'

function setup(existing = false, selectedIds = existing ? ['new'] : ['old', 'new'], eligibleIds = ['old', 'new']) {
  const card = discoveryProject().cards[0]!
  const cards = [{ ...card, id: 'old', regions: existing ? [{ id: 'region' }] as typeof card.regions : [] }, { ...card, id: 'new', regions: [] }]
  return mount(BatchCardSelection, { props: { cards, selectedIds, eligibleIds, disabled: false, detection: true } })
}

it('shows the initial selection and updates targets with the select presets', async () => {
  const wrapper = setup()
  const select = wrapper.get('select')
  expect(select.element.value).toBe('all')
  expect(wrapper.findAll('button')).toHaveLength(0)
  await select.setValue('none')
  expect(wrapper.emitted('select')!.at(-1)).toEqual([[]])
  await wrapper.setProps({ selectedIds: [] })
  expect(select.element.value).toBe('none')
  await select.setValue('all')
  expect(wrapper.emitted('select')!.at(-1)).toEqual([['old', 'new']])
  await wrapper.setProps({ selectedIds: ['old', 'new'] })
  await wrapper.setProps({ selectedIds: ['new'] })
  expect(select.element.value).toBe('')
  expect(wrapper.get('strong').text()).toBe('対象 1枚')
  wrapper.unmount()
})

it('shows uncreated for existing projects, including when every card already has regions', async () => {
  const wrapper = setup(true)
  const select = wrapper.get('select')
  expect(select.element.value).toBe('uncreated')
  await select.setValue('all')
  await wrapper.setProps({ selectedIds: ['old', 'new'] })
  await select.setValue('uncreated')
  expect(wrapper.emitted('select')!.at(-1)).toEqual([['new']])
  wrapper.unmount()
  const allExisting = setup(true, [], ['old'])
  expect(allExisting.get('select').element.value).toBe('uncreated')
  await allExisting.get('select').setValue('none')
  expect(allExisting.get('select').element.value).toBe('none')
  allExisting.unmount()
})

it('limits presets to eligible cards and blocks changes while processing', async () => {
  const wrapper = setup(true, ['old'])
  await wrapper.setProps({ detection: false, eligibleIds: ['old'] })
  expect(wrapper.get('select').element.value).toBe('all')
  expect(wrapper.find('option[value="uncreated"]').exists()).toBe(false)
  await wrapper.get('select').setValue('all')
  expect(wrapper.emitted('select')!.at(-1)).toEqual([['old']])
  await wrapper.setProps({ disabled: true })
  const count = wrapper.emitted('select')!.length
  expect(wrapper.get('select').attributes('disabled')).toBeDefined()
  await wrapper.get('select').setValue('none')
  expect(wrapper.emitted('select')).toHaveLength(count)
  wrapper.unmount()
})
