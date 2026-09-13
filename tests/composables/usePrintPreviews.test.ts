import type { FolderProjectCard } from '~/types/editor'
import { afterEach, expect, it, vi } from 'vitest'
import { usePrintPreviews } from '~/composables/usePrintPreviews'

const hooks = vi.hoisted(() => ({ unmount: () => {} }))
vi.mock('vue', async importOriginal => ({
  ...await importOriginal<typeof import('vue')>(),
  onBeforeUnmount: (callback: () => void) => hooks.unmount = callback,
}))
afterEach(() => vi.restoreAllMocks())
const cards = ['one', 'two', 'three'].map(id => ({ id, printArea: { x: 0, y: 0, width: 10, height: 10 } }) as FolderProjectCard)

it('releases pending images and ignores an in-flight result after unmount', async () => {
  const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:first')
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  let complete!: (blob: Blob) => void
  let secondStarted!: () => void
  const started = new Promise<void>(resolve => secondStarted = resolve)
  const render = vi.fn(async (card: FolderProjectCard, signal: AbortSignal) => {
    if (card.id === 'one')
      return new Blob(['first'])
    expect(signal.aborted).toBe(false)
    secondStarted()
    return new Promise<Blob>(resolve => complete = resolve)
  })
  const state = usePrintPreviews(() => cards, render)
  const preparing = state.preparePreviews()
  await started
  hooks.unmount()
  expect(revoke).toHaveBeenCalledWith('blob:first')
  expect(render.mock.calls[1]![1].aborted).toBe(true)
  complete(new Blob(['late']))
  await preparing
  expect(create).toHaveBeenCalledTimes(1)
  expect(render).toHaveBeenCalledTimes(2)
  expect(state.previews.value.size).toBe(0)
  expect(state.loading.value).toBe(false)
})

it('keeps completed previews until unmount and releases every URL', async () => {
  vi.spyOn(URL, 'createObjectURL').mockReturnValueOnce('blob:one').mockReturnValueOnce('blob:two')
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  const state = usePrintPreviews(() => cards.slice(0, 2), async () => new Blob(['image']))
  await state.preparePreviews()
  expect(state.previews.value.size).toBe(2)
  expect(revoke).not.toHaveBeenCalled()
  hooks.unmount()
  expect(revoke.mock.calls.flat()).toEqual(['blob:one', 'blob:two'])
})
