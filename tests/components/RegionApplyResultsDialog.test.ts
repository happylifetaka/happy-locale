// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { expect, it } from 'vitest'
import RegionApplyResultsDialog from '~/features/cards/RegionApplyResultsDialog.vue'
import { regionFromCandidate } from '~/services/asset-discovery/new-region'
import { discoveryProject } from '../fixtures/asset-discovery'

it('separates source protection from errors and routes to the exact region or icon', async () => {
  const card = discoveryProject().cards[0]!
  const region = regionFromCandidate(card.ocrCandidates![0]!, 0)
  card.regions = [region]
  const protectedIssue = { regionId: region.id, message: 'OCR履歴がないため、原文を保護しました', preview: true }
  const iconIssue = { message: 'グループのアセット割当を確認', occurrenceId: 'icon', regionId: region.id }
  const props = { cards: [card], issues: [{ cardId: card.id, cardName: card.imageName, messages: [], details: [protectedIssue, iconIssue] }] }
  const wrapper = mount(RegionApplyResultsDialog, { props })
  expect(wrapper.text()).toContain('原文・アイコン・枠の更新を保留')
  expect(wrapper.text()).toContain('現在の内容を使うなら操作不要')
  expect(wrapper.get('.protected-summary').text()).toContain('1枚')
  expect(wrapper.get('.problem-summary').text()).toContain('1枚')
  expect(wrapper.findAll('blockquote')[0]!.text()).toContain(region.originalText)
  const button = (name: string) => wrapper.findAll('button').find(button => button.text() === name)!
  await button('変更案を比較').trigger('click')
  expect(wrapper.emitted('resolve')?.[0]).toEqual([card.id, protectedIssue, 'preview'])
  await wrapper.get('select').setValue('problem')
  expect(wrapper.findAll('.issue-row')).toHaveLength(1)
  expect(wrapper.text()).not.toContain('OCR履歴がないため')
  await button('アイコン候補を調整').trigger('click')
  expect(wrapper.emitted('resolve')?.[1]).toEqual([card.id, iconIssue, 'discovery'])
  await wrapper.setProps({ cards: [] })
  expect(button('アイコン候補を調整').attributes('disabled')).toBeDefined()
  wrapper.unmount()
})

it('handles many long filenames without dumping details into the sidebar and retains unstructured failures', async () => {
  const card = discoveryProject().cards[0]!
  const cards = Array.from({ length: 37 }, (_, index) => ({ ...card, id: `card-${index}`, imageName: `synthetic-long-file-name-${index}-00000000-0000-0000-0000-000000000000.png` }))
  const issues = cards.slice(0, 29).map(card => ({ cardId: card.id, cardName: card.imageName, messages: ['元画像を読み込めません。'] }))
  const wrapper = mount(RegionApplyResultsDialog, { props: { cards, issues } })
  expect(wrapper.findAll('.card-result')).toHaveLength(29)
  expect(wrapper.get('.problem-summary').text()).toContain('29枚')
  expect(wrapper.emitted('requestThumbnail')).toHaveLength(29)
  const open = wrapper.findAll('button').find(button => button.text() === 'カードを開く')!
  await open.trigger('click')
  expect(wrapper.emitted('resolve')?.[0]).toEqual(['card-0', { message: '元画像を読み込めません。' }, 'region'])
  await wrapper.get('select').setValue('protected')
  expect(wrapper.findAll('.card-result')).toHaveLength(0)
  expect(wrapper.text()).toContain('この分類の未反映項目はありません')
  wrapper.unmount()
})
