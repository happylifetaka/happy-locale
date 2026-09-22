// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { expect, it } from 'vitest'
import RegionApplyDialog from '~/features/cards/RegionApplyDialog.vue'
import { discoveryProject } from '../fixtures/asset-discovery'

it('selects only intended cards and offers unprocessed, current, all and clear presets', async () => {
  const card = discoveryProject().cards[0]!
  const cards = [{ ...card, id: 'old', imageName: 'old.png', regions: [{ id: 'r' }] as typeof card.regions }, { ...card, id: 'new', imageName: 'new.png', regions: [] }]
  const wrapper = mount(RegionApplyDialog, { props: { cards, initialIds: ['new', 'deleted'], activeCardId: 'old' } })
  const button = (name: string) => wrapper.findAll('button').find(button => button.text() === name)!
  expect(wrapper.get('legend').text()).toContain('1/2枚')
  await button('選択した1枚に反映').trigger('click')
  expect(wrapper.emitted('apply')).toEqual([[['new']]])
  await button('このカードのみ').trigger('click')
  await button('選択した1枚を個別プレビュー').trigger('click')
  expect(wrapper.emitted('preview')).toEqual([['old']])
  await button('すべて').trigger('click')
  expect(button('選択した2枚に反映').exists()).toBe(true)
  expect(button('選択した1枚を個別プレビュー').attributes('disabled')).toBeDefined()
  await button('領域未作成のみ').trigger('click')
  expect(wrapper.findAll('input').map(input => (input.element as HTMLInputElement).checked)).toEqual([false, true])
  await wrapper.setProps({ cards: [cards[0]!] })
  expect(button('選択した0枚に反映').attributes('disabled')).toBeDefined()
  await button('すべて').trigger('click')
  await button('解除').trigger('click')
  expect(button('選択した0枚に反映').attributes('disabled')).toBeDefined()
  wrapper.unmount()
})
