// @vitest-environment happy-dom
import type { IconProposalReview } from '~/services/asset-discovery/proposal-review'
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import DiscoveryProposalComparison from '~/features/cards/DiscoveryProposalComparison.vue'
import { discoveryProject, discoveryProposal } from '../fixtures/asset-discovery'

function setup() {
  const project = discoveryProject()
  const item = project.assetDiscovery!.occurrences[0]!
  const proposal = discoveryProposal().occurrences[0]!
  const changed = { ...proposal, id: 'changed', bounds: { ...item.bounds, x: item.bounds.x - 1, width: item.bounds.width + 1, height: item.bounds.height + 1 } }
  const fresh = { ...proposal, id: 'new', bounds: { x: 140, y: 180, width: 20, height: 20 } }
  const review: IconProposalReview = {
    cardId: item.cardId,
    imageDigest: item.imageDigest,
    occurrences: [proposal, changed, fresh],
    differences: [
      { status: 'unchanged', detectedId: proposal.id, occurrenceIds: [item.id], peerIds: [], hasUserReview: true },
      { status: 'changed', detectedId: changed.id, occurrenceIds: [item.id], peerIds: [], hasUserReview: true },
      { status: 'new', detectedId: fresh.id, occurrenceIds: [], peerIds: [], hasUserReview: false },
      { status: 'missing', detectedId: null, occurrenceIds: [item.id], peerIds: [], hasUserReview: true },
      { status: 'ambiguous', detectedId: fresh.id, occurrenceIds: [item.id], peerIds: [changed.id], hasUserReview: true },
    ],
    limitsHit: [],
  }
  const thumbnails = { key: vi.fn(item => item.id), subscribe: vi.fn(() => () => {}) }
  const props = {
    review,
    occurrences: project.assetDiscovery!.occurrences,
    groups: project.assetDiscovery!.groups,
    assets: project.assets,
    card: project.cards[0]!,
    imageUrl: 'blob:synthetic',
    thumbnails,
    active: true,
    disabled: false,
    selectedIds: [],
  }
  const wrapper = mount(DiscoveryProposalComparison, { props, global: { stubs: { DiscoveryThumbnail: { props: ['item', 'active'], template: '<span class="thumbnail-stub">{{ item.id }}</span>' } } } })
  return { wrapper, props, item, review }
}

describe('discovery proposal visual comparison', () => {
  it('shows both crops, human names, minimal edge changes and collapsed coordinate details', () => {
    const { wrapper } = setup()
    const rows = wrapper.findAll('.difference')
    expect(rows).toHaveLength(5)
    expect(rows[1]!.findAll('.thumbnail-stub')).toHaveLength(2)
    expect(rows[1]!.text()).toContain('synthetic-icon / Synthetic group')
    expect(rows[1]!.text()).toContain('左へ1px拡張・下へ1px拡張')
    expect(rows[2]!.text()).toContain('カード下部・右側')
    expect(rows[2]!.text()).toContain('採用後に分類・割当')
    expect(rows[3]!.text()).toContain('現在の候補は保持します')
    expect(rows.every(row => !(row.get('details').element as HTMLDetailsElement).open)).toBe(true)
    expect(wrapper.text()).not.toContain('手動確認済み')
    wrapper.unmount()
  })

  it('allows only new/changed selections and does not edit stored candidates when showing positions', async () => {
    const { wrapper, props } = setup()
    const before = JSON.stringify(props)
    const rows = wrapper.findAll('.difference')
    expect(rows.map(row => (row.get('input').element as HTMLInputElement).disabled)).toEqual([true, false, false, true, true])
    await rows[1]!.get('input').setValue(true)
    expect(wrapper.emitted('update:selectedIds')!.at(-1)).toEqual([['changed']])
    await rows[1]!.get('button').trigger('click')
    expect(rows[1]!.findAll('svg')).toHaveLength(2)
    const rects = rows[1]!.findAll('svg')[1]!.findAll('rect')
    expect(rects.map(rect => rect.attributes('x'))).toEqual(['40', '39'])
    expect(rects[0]!.attributes('stroke-dasharray')).toBe('5 4')
    expect(rects[1]!.attributes('stroke-dasharray')).toBeUndefined()
    expect(rows[1]!.get('image').attributes('href')).toBe('blob:synthetic')
    await rows[2]!.get('button').trigger('click')
    expect(rows[1]!.findAll('svg')).toHaveLength(0)
    expect(rows[2]!.findAll('svg rect')).toHaveLength(2)
    expect(JSON.stringify(props)).toBe(before)
    await wrapper.setProps({ disabled: true })
    expect(wrapper.findAll('input').every(input => (input.element as HTMLInputElement).disabled)).toBe(true)
    wrapper.unmount()
  })

  it('does not display a current image as an old source or show another card position', async () => {
    const { wrapper, props, item } = setup()
    await wrapper.setProps({
      occurrences: [{ ...item, imageDigest: 'c'.repeat(64) }],
      review: { ...props.review, differences: [{ status: 'source-changed', detectedId: null, occurrenceIds: [item.id], peerIds: [], hasUserReview: true }] },
    })
    expect(wrapper.findAll('.thumbnail-stub')).toHaveLength(0)
    expect(wrapper.text()).toContain('検出時の画像は表示できません')
    expect((wrapper.get('button').element as HTMLButtonElement).disabled).toBe(true)
    await wrapper.setProps({ review: props.review, occurrences: props.occurrences, imageUrl: undefined })
    expect(wrapper.findAll('button').every(button => (button.element as HTMLButtonElement).disabled)).toBe(true)
    wrapper.unmount()
  })

  it('resets the focused comparison when a different proposal is opened', async () => {
    const { wrapper, review } = setup()
    await wrapper.findAll('.difference')[0]!.get('button').trigger('click')
    expect(wrapper.findAll('svg')).toHaveLength(2)
    await wrapper.setProps({ review: { ...review } })
    expect(wrapper.findAll('svg')).toHaveLength(0)
    wrapper.unmount()
  })
})
