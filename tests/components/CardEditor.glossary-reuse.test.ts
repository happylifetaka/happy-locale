// @vitest-environment happy-dom
import { flushPromises } from '@vue/test-utils'
import { expect, it } from 'vitest'
import { nextTick } from 'vue'
import { useProjectStore } from '~/stores/project'
import { mountSavedEditor } from './helpers/card-editor'

it('normalizes glossary inputs, rejects duplicates and empty edits, and updates the entry itself', async () => {
  const { wrapper } = await mountSavedEditor()
  const glossary = wrapper.findComponent({ name: 'GlossaryDialog' })
  glossary.vm.$emit('add', '  Draw  ', ' 引く ', ' 注記 ')
  await nextTick()
  const store = useProjectStore()
  const id = store.glossary[0]!.id
  expect(store.glossary).toEqual([{ id, source: 'Draw', translation: '引く', note: '注記' }])
  glossary.vm.$emit('add', 'draw', '重複', '')
  glossary.vm.$emit('add', ' ', '空原文', '')
  glossary.vm.$emit('add', 'Empty', ' ', '')
  glossary.vm.$emit('update', id, { source: ' ', translation: 'invalid', note: '' })
  glossary.vm.$emit('update', id, { source: 'Draw', translation: ' ', note: '' })
  await nextTick()
  expect(store.glossary).toEqual([{ id, source: 'Draw', translation: '引く', note: '注記' }])
  glossary.vm.$emit('update', id, { source: ' DRAW ', translation: ' 引きます ', note: ' 改訂 ' })
  await nextTick()
  expect(store.glossary).toEqual([{ id, source: 'DRAW', translation: '引きます', note: '改訂' }])
  glossary.vm.$emit('remove', id)
  await nextTick()
  expect(store.glossary).toEqual([])
})

it('rejects renaming a glossary entry to another normalized key', async () => {
  const { wrapper } = await mountSavedEditor()
  const glossary = wrapper.findComponent({ name: 'GlossaryDialog' })
  glossary.vm.$emit('add', 'Draw', '引く', '')
  glossary.vm.$emit('add', 'Take', '取る', '')
  await nextTick()
  const store = useProjectStore()
  const before = JSON.stringify(store.glossary)
  glossary.vm.$emit('update', store.glossary[1]!.id, { source: ' DRAW ', translation: '競合', note: '' })
  await nextTick()
  expect(JSON.stringify(store.glossary)).toBe(before)
})

async function requestReuse() {
  const context = await mountSavedEditor()
  const { wrapper, canvas, inspector } = context
  canvas.vm.$emit('select-region', 'region-0')
  await nextTick()
  wrapper.findComponent({ name: 'GlossaryDialog' }).vm.$emit('add', 'Source 0', '用語集の訳', '')
  const store = useProjectStore()
  const card = store.document!.cards[1]!
  store.updateCard(card.id, { ...card, regions: card.regions.map(region => ({ ...region, originalText: 'Source 0', translatedText: '他カードの訳' })) })
  await nextTick()
  inspector.vm.$emit('reuse-translation')
  await nextTick()
  return { ...context, dialog: wrapper.findComponent({ name: 'TranslationReuseDialog' }) }
}

it('offers glossary and other-card translations and applies a candidate with undo', async () => {
  const { dialog, canvas, toolbar } = await requestReuse()
  expect(dialog.props('candidates').map((item: { translation: string }) => item.translation)).toEqual(['用語集の訳', '他カードの訳'])
  expect(canvas.props('project').regions[0].translatedText).toBe('Before 0')
  dialog.vm.$emit('apply', '他カードの訳')
  await nextTick()
  expect(canvas.props('project').regions[0]).toMatchObject({ translatedText: '他カードの訳', translationStatus: 'draft' })
  toolbar.vm.$emit('undo')
  await nextTick()
  expect(canvas.props('project').regions[0].translatedText).toBe('Before 0')
  expect(useProjectStore().document!.cards[1]!.regions[0]!.translatedText).toBe('他カードの訳')
})

it.each(['original', 'translation', 'card'] as const)('rejects reuse after the requested %s changes', async (change) => {
  const { dialog, wrapper, inspector, canvas } = await requestReuse()
  if (change === 'card')
    wrapper.findComponent({ name: 'CardList' }).vm.$emit('select', 'two')
  else
    inspector.vm.$emit('update', 'region-0', change === 'original' ? { originalText: 'Changed' } : { translatedText: 'Changed' })
  await flushPromises()
  const before = JSON.stringify(canvas.props('project'))
  dialog.vm.$emit('apply', '古い候補')
  await nextTick()
  expect(JSON.stringify(canvas.props('project'))).toBe(before)
  expect(wrapper.findComponent({ name: 'TranslationReuseDialog' }).exists()).toBe(false)
})

it('cancels reuse without adding an undo step', async () => {
  const { dialog, canvas, toolbar } = await requestReuse()
  dialog.vm.$emit('close')
  await nextTick()
  toolbar.vm.$emit('undo')
  await nextTick()
  expect(canvas.props('project').regions[0].translatedText).toBe('Before 0')
})
