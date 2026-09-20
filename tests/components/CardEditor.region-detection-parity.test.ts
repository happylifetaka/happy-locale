// @vitest-environment happy-dom
import type { RegionCandidate } from '~/services/ocr/types'
import { flushPromises } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import { useProjectStore } from '~/stores/project'
import { baselineOCR } from '../fixtures/refactoring-baseline'
import { mountSavedEditor, ocrIO } from './helpers/card-editor'

it('produces identical geometry, text, confidence, selection and lines in single and batch detection', async () => {
  const recognized = baselineOCR()
  // Fit the synthetic blocks into the same 100x140 decoded image used by both paths.
  for (const block of [...recognized.blocks, ...recognized.words ?? []]) {
    block.x /= 2
    block.y /= 2
    block.width /= 2
    block.height /= 2
  }
  ocrIO.recognize.mockResolvedValue(recognized)
  const close = vi.fn()
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 100, height: 140, close }))
  const { wrapper, canvas } = await mountSavedEditor(false)
  const panel = wrapper.getComponent({ name: 'RegionCandidatePanel' })
  panel.vm.$emit('detect')
  await flushPromises()
  const single: RegionCandidate[] = JSON.parse(JSON.stringify(canvas.props('regionCandidates')))
  expect(single.map(candidate => candidate.text)).toEqual(['Synthetic Card', 'CASTLE', 'Choose an ally.\nDraw two cards.', 'noise text'])
  expect(single.map(candidate => candidate.selected)).toEqual([true, true, true, false])
  panel.vm.$emit('cancel')
  await flushPromises()
  wrapper.getComponent({ name: 'CardList' }).vm.$emit('start-batch-ocr')
  await flushPromises()
  expect(ocrIO.recognize).toHaveBeenCalledTimes(4)
  expect(close).toHaveBeenCalledTimes(3)
  for (const card of useProjectStore().document!.cards)
    expect(card.ocrCandidates).toEqual(single)
  expect(canvas.props('regionCandidates')).toEqual(single)
})
