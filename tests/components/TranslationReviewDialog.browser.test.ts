// @vitest-environment happy-dom
import type { FolderProjectCard } from '~/types/editor'
import { flushPromises, shallowMount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Vue from 'vue'
import TranslationReviewDialog from '~/components/TranslationReviewDialog.vue'
import { sampleRegions } from '~/services/project/sample'

beforeEach(() => {
  for (const name of ['computed', 'ref', 'watch', 'nextTick', 'onMounted', 'onBeforeUnmount'] as const)
    vi.stubGlobal(name, Vue[name])
})
afterEach(() => vi.unstubAllGlobals())

function setup(translate: (text: string) => Promise<string>, sameSource = false) {
  const card: FolderProjectCard = { id: 'sample-01', imageName: 'sample.png', imagePath: '', imageWidth: 744, imageHeight: 1039, printArea: null, sourceDpi: null, regions: [] }
  card.regions = sampleRegions(card).slice(0, 3)
  card.regions[2]!.translatedText = '手修正済み'
  if (sameSource)
    card.regions[1]!.originalText = card.regions[0]!.originalText
  const wrapper = shallowMount(TranslationReviewDialog, {
    props: { cards: [card], activeCardId: card.id, assets: [], assetImages: new Map(), glossary: [], loadImage: async () => new Blob(), translate, browserTranslation: true, autoTranslate: true },
  })
  const button = (label: string) => wrapper.findAll('button').find(item => item.text() === label)!
  return { wrapper, button, card }
}

describe('browser translation review batch', () => {
  it('translates repeated source text only once within a batch', async () => {
    const translate = vi.fn().mockResolvedValue('共通の候補')
    const { wrapper, button } = setup(translate, true)
    await wrapper.findAll('.review-row-check')[0]!.setValue(true)
    await wrapper.findAll('.review-row-check')[1]!.setValue(true)
    await button('選択した行を翻訳').trigger('click')
    await flushPromises()
    expect(translate).toHaveBeenCalledOnce()
    expect(wrapper.findAll('textarea').map(item => item.element.value)).toEqual(['共通の候補', '共通の候補', '手修正済み'])
    wrapper.unmount()
  })
  it('waits for a click, preserves existing drafts and retries only failed rows', async () => {
    const translate = vi.fn().mockResolvedValueOnce('最初の候補').mockRejectedValueOnce(new Error('一時的な失敗')).mockResolvedValueOnce('再試行の候補')
    const { wrapper, button, card } = setup(translate)
    await flushPromises()
    expect(translate).not.toHaveBeenCalled()
    await wrapper.findAll('.review-row-check')[0]!.setValue(true)
    await wrapper.findAll('.review-row-check')[1]!.setValue(true)
    await button('選択した行を翻訳').trigger('click')
    await flushPromises()
    expect(translate).toHaveBeenCalledTimes(2)
    expect(wrapper.findAll('textarea').map(item => item.element.value)).toEqual(['最初の候補', '', '手修正済み'])
    expect(card.regions[0]!.translatedText).toBe('')
    await button('失敗した行を再試行').trigger('click')
    await flushPromises()
    expect(translate).toHaveBeenCalledTimes(3)
    expect(wrapper.findAll('textarea').map(item => item.element.value)).toEqual(['最初の候補', '再試行の候補', '手修正済み'])
    wrapper.unmount()
  })
  it('discards in-flight output after cancellation and skips subsequent rows', async () => {
    let resolve!: (value: string) => void
    const translate = vi.fn(() => new Promise<string>(done => resolve = done))
    const { wrapper, button } = setup(translate)
    await wrapper.findAll('.review-row-check')[0]!.setValue(true)
    await wrapper.findAll('.review-row-check')[1]!.setValue(true)
    await button('選択した行を翻訳').trigger('click')
    await button('取得を中止').trigger('click')
    resolve('遅い結果')
    await flushPromises()
    expect(translate).toHaveBeenCalledOnce()
    expect(wrapper.findAll('textarea').map(item => item.element.value)).toEqual(['', '', '手修正済み'])
    expect(wrapper.text()).toContain('中止しました')
    wrapper.unmount()
  })
  it('uses a unique exact glossary translation before calling the model', async () => {
    const translate = vi.fn().mockResolvedValue('モデルの候補')
    const { wrapper, button, card } = setup(translate)
    await wrapper.setProps({ glossary: [{ id: 'term', source: card.regions[0]!.originalText, translation: '用語集の訳', note: '' }] })
    await wrapper.findAll('.review-row-check')[0]!.setValue(true)
    await wrapper.findAll('.review-row-check')[1]!.setValue(true)
    await button('選択した行を翻訳').trigger('click')
    await flushPromises()
    expect(translate).toHaveBeenCalledOnce()
    expect(wrapper.findAll('textarea')[0]!.element.value).toBe('用語集の訳')
    wrapper.unmount()
  })
})

it('translates only the clicked row, ignoring batch selection and reuse candidates', async () => {
  const translate = vi.fn().mockResolvedValue('個別の候補')
  const { wrapper, card } = setup(translate)
  await wrapper.setProps({ glossary: [{ id: 'g', source: card.regions[0]!.originalText, translation: '既存訳', note: '' }] })
  const articles = wrapper.findAll('article.review-row')
  await articles[1]!.get('input[type=checkbox]').setValue(true)
  const actions = articles[0]!.findAll('.review-row-actions button')
  expect(actions.map(button => button.text())).toEqual(['翻訳', '同じ原文の訳を再利用'])
  expect(wrapper.text()).not.toContain('カード上で確認')
  await actions[0]!.trigger('click')
  await flushPromises()
  expect(translate).toHaveBeenCalledExactlyOnceWith(card.regions[0]!.originalText, expect.objectContaining({ signal: expect.any(AbortSignal) }))
  expect(wrapper.findAll('textarea').map(input => input.element.value)).toEqual(['個別の候補', '', '手修正済み'])
  expect(card.regions[0]!.translatedText).toBe('')
  wrapper.unmount()
})

it('retranslates an existing draft without applying it to the card', async () => {
  const translate = vi.fn().mockResolvedValue('新しい訳')
  const { wrapper, button, card } = setup(translate)
  await button('再翻訳').trigger('click')
  await flushPromises()
  expect(translate).toHaveBeenCalledExactlyOnceWith(card.regions[2]!.originalText, expect.anything())
  expect(wrapper.findAll('textarea')[2]!.element.value).toBe('新しい訳')
  expect(card.regions[2]!.translatedText).toBe('手修正済み')
  wrapper.unmount()
})

it.each(['cancel', 'failure'])('retains the existing draft after individual translation %s', async (mode) => {
  let resolve!: (text: string) => void
  let reject!: (error: Error) => void
  const translate = vi.fn(() => new Promise<string>((accept, decline) => {
    resolve = accept
    reject = decline
  }))
  const { wrapper, button } = setup(translate)
  await button('再翻訳').trigger('click')
  if (mode === 'cancel') {
    await button('取得を中止').trigger('click')
    resolve('遅い候補')
  }
  else {
    reject(new Error('翻訳失敗'))
  }
  await flushPromises()
  expect(wrapper.findAll('textarea')[2]!.element.value).toBe('手修正済み')
  expect(button('再翻訳').attributes('disabled')).toBeUndefined()
  wrapper.unmount()
})

it('shows a disabled individual translation button and guidance when translation is not configured', async () => {
  const { wrapper, button } = setup(vi.fn())
  await wrapper.setProps({ translate: undefined, browserTranslation: false })
  expect(button('翻訳').attributes('disabled')).toBeDefined()
  expect(wrapper.text()).toContain('「翻訳設定」でブラウザ内翻訳を選択')
  wrapper.unmount()
})

it('disables batch translation with no selection and translates only checked rows', async () => {
  const translate = vi.fn().mockResolvedValue('選択行の訳')
  const { wrapper, button, card } = setup(translate)
  const batch = button('選択した行を翻訳')
  expect(batch.attributes('disabled')).toBeDefined()
  await batch.trigger('click')
  expect(translate).not.toHaveBeenCalled()
  const check = wrapper.findAll('.review-row-check')[1]!
  await check.setValue(true)
  expect(batch.attributes('disabled')).toBeUndefined()
  await check.setValue(false)
  expect(batch.attributes('disabled')).toBeDefined()
  await check.setValue(true)
  await batch.trigger('click')
  await flushPromises()
  expect(translate).toHaveBeenCalledExactlyOnceWith(card.regions[1]!.originalText, expect.anything())
  expect(wrapper.findAll('textarea').map(input => input.element.value)).toEqual(['', '選択行の訳', '手修正済み'])
  wrapper.unmount()
})
