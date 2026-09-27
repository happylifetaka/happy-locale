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
  expect(wrapper.get('legend').text()).toContain('2枚中 1枚を選択')
  expect(wrapper.text()).toContain('「アイコン検出」で選んだアイコンも、原文の中に入れます。')
  expect(wrapper.text()).toContain('訳文・元画像は変更しません')
  expect(wrapper.emitted('requestThumbnail')).toEqual([['old'], ['new']])
  await button('1枚の原文を準備').trigger('click')
  expect(wrapper.emitted('apply')).toEqual([[['new']]])
  await button('このカードのみ').trigger('click')
  await button('選んだ1枚の変更内容を見る').trigger('click')
  expect(wrapper.emitted('preview')).toEqual([['old']])
  await button('すべて選択').trigger('click')
  expect(button('2枚の原文を準備').exists()).toBe(true)
  expect(button('選んだ1枚の変更内容を見る').attributes('disabled')).toBeDefined()
  await button('領域がないカード').trigger('click')
  expect(wrapper.findAll('input').map(input => (input.element as HTMLInputElement).checked)).toEqual([false, true])
  await wrapper.setProps({ cards: [cards[0]!] })
  expect(button('0枚の原文を準備').attributes('disabled')).toBeDefined()
  await button('すべて選択').trigger('click')
  await button('選択を解除').trigger('click')
  expect(button('0枚の原文を準備').attributes('disabled')).toBeDefined()
  wrapper.unmount()
})
