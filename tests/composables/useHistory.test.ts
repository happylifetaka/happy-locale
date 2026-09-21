import { describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'
import { useHistory, useKeyedHistory } from '~/composables/useHistory'

describe('useHistory', () => {
  it('ignores repeated input states without consuming the history limit', () => {
    const history = useHistory({ text: 'original' }, 2)
    history.commit({ text: 'original' })
    expect(history.canUndo.value).toBe(false)
    history.commit({ text: 'translated' })
    const current = history.state.value
    for (let index = 0; index < 5; index++)
      history.commit(reactive({ text: 'translated' }))
    expect(history.state.value).toBe(current)
    history.undo()
    expect(history.state.value.text).toBe('original')
    expect(history.canUndo.value).toBe(false)
    history.redo()
    expect(history.state.value.text).toBe('translated')
  })

  it('retains redo when an unchanged input is committed after undo and a card switch', () => {
    const history = useKeyedHistory({ text: 'original' })
    history.reset('a', { text: 'original' })
    history.commit({ text: 'translated' })
    history.undo()
    history.switchTo('b', { text: 'other' })
    history.commit({ text: 'other translation' })
    history.switchTo('a', { text: 'original' })
    history.commit({ text: 'original' })
    expect(history.canRedo.value).toBe(true)
    history.redo()
    expect(history.state.value.text).toBe('translated')
  })

  it('reactively enables undo after the first commit', () => {
    const history = useHistory({ count: 0 })

    expect(history.canUndo.value).toBe(false)
    history.commit({ count: 1 })
    expect(history.canUndo.value).toBe(true)

    history.undo()
    expect(history.canUndo.value).toBe(false)
    expect(history.canRedo.value).toBe(true)
  })

  it('supports commit, undo, redo, and clears redo on a new branch', () => {
    const history = useHistory({ count: 0 })
    history.commit({ count: 1 })
    history.commit({ count: 2 })
    history.undo()
    expect(history.state.value.count).toBe(1)
    expect(history.canRedo.value).toBe(true)

    history.redo()
    expect(history.state.value.count).toBe(2)
    history.undo()
    history.commit({ count: 3 })
    expect(history.canRedo.value).toBe(false)
  })

  it('commits state containing nested Vue proxies', () => {
    const history = useHistory({ strokes: [] as { points: number[] }[] })
    const stroke = reactive({ points: [1, 2] })

    expect(() => history.commit({ strokes: [stroke] })).not.toThrow()
    expect(history.state.value.strokes).toEqual([{ points: [1, 2] }])
  })

  it('limits retained undo snapshots', () => {
    const history = useHistory({ count: 0 }, 3)
    for (let count = 1; count <= 5; count += 1) {
      history.commit({ count })
    }

    history.undo()
    history.undo()
    history.undo()
    history.undo()
    expect(history.state.value.count).toBe(2)
    expect(history.canUndo.value).toBe(false)
  })

  it('undoes and redoes one committed mask stroke at a time', () => {
    const history = useHistory({ strokes: [] as string[] })
    history.commit({ strokes: ['paint'] })
    history.commit({ strokes: ['paint', 'erase'] })

    history.undo()
    expect(history.state.value.strokes).toEqual(['paint'])
    history.undo()
    expect(history.state.value.strokes).toEqual([])

    history.redo()
    expect(history.state.value.strokes).toEqual(['paint'])
    history.redo()
    expect(history.state.value.strokes).toEqual(['paint', 'erase'])
  })

  it('restores an independent undo and redo timeline from a snapshot', () => {
    const history = useHistory({ count: 0 })
    history.commit({ count: 1 })
    history.commit({ count: 2 })
    history.undo()
    const firstTimeline = history.snapshot()

    history.replace({ count: 10 })
    history.commit({ count: 11 })
    expect(history.state.value.count).toBe(11)

    history.restore(firstTimeline)
    expect(history.state.value.count).toBe(1)
    expect(history.canUndo.value).toBe(true)
    expect(history.canRedo.value).toBe(true)
    history.redo()
    expect(history.state.value.count).toBe(2)
  })

  it('keeps an independent timeline for each key', () => {
    const history = useKeyedHistory({ count: 0 })
    history.reset('card-a', { count: 0 })
    history.commit({ count: 1 })

    history.switchTo('card-b', { count: 10 })
    history.commit({ count: 11 })
    history.switchTo('card-a', { count: 1 })
    expect(history.state.value.count).toBe(1)
    expect(history.canUndo.value).toBe(true)
    history.undo()
    expect(history.state.value.count).toBe(0)

    history.switchTo('card-b', { count: 11 })
    history.undo()
    expect(history.state.value.count).toBe(10)
  })

  it('discards a saved timeline when its current state changed externally', () => {
    const history = useKeyedHistory({ count: 0 })
    history.reset('card-a', { count: 0 })
    history.commit({ count: 1 })
    history.switchTo('card-b', { count: 10 })

    history.switchTo('card-a', { count: 99 })
    expect(history.state.value.count).toBe(99)
    expect(history.canUndo.value).toBe(false)
  })
})

describe('history transition effects', () => {
  it('commits inactive cards without changing the visible timeline and preserves earlier effects', () => {
    const history = useKeyedHistory<{ count: number }, string>({ count: 0 })
    history.reset('a', { count: 0 })
    history.commit({ count: 1 }, 'first')
    history.switchTo('b', { count: 10 })
    const visible = history.snapshot()
    history.commitTo('a', { count: 1 }, { count: 2 }, 'batch', vi.fn())
    expect(history.snapshot()).toEqual(visible)
    history.switchTo('a', { count: 2 })
    const undo = vi.fn()
    history.undo(undo)
    history.undo(undo)
    expect(undo.mock.calls).toEqual([[{ count: 1 }, 'batch'], [{ count: 0 }, 'first']])
  })

  it('leaves inactive history untouched when publication fails', () => {
    const history = useKeyedHistory({ count: 0 })
    history.reset('a', { count: 0 })
    history.commit({ count: 1 })
    history.switchTo('b', { count: 10 })
    expect(() => history.commitTo('a', { count: 1 }, { count: 2 }, null, () => {
      throw new Error('failed')
    })).toThrow('failed')
    expect(history.state.value).toEqual({ count: 10 })
    history.switchTo('a', { count: 1 })
    history.undo()
    expect(history.state.value).toEqual({ count: 0 })
  })

  it('keeps effects on the matching edge, including changes with identical main state', () => {
    const history = useHistory<{ count: number }, { candidate: string }>({ count: 0 })
    const publish = vi.fn()
    const effect = { candidate: 'first' }
    history.commit({ count: 0 }, effect, publish)
    effect.candidate = 'caller mutation'
    history.commit({ count: 1 })
    history.commit({ count: 2 }, { candidate: 'second' })
    for (let i = 0; i < 3; i++) history.undo(publish)
    expect(publish.mock.calls).toEqual([
      [{ count: 0 }, { candidate: 'first' }],
      [{ count: 1 }, { candidate: 'second' }],
      [{ count: 0 }, null],
      [{ count: 0 }, { candidate: 'first' }],
    ])
    publish.mockClear()
    for (let i = 0; i < 3; i++) history.redo(publish)
    expect(publish.mock.calls).toEqual([
      [{ count: 0 }, { candidate: 'first' }],
      [{ count: 1 }, null],
      [{ count: 2 }, { candidate: 'second' }],
    ])
  })

  it('keeps all history unchanged on failed publication and isolates callback values', () => {
    const history = useHistory<{ count: number }, { id: string }>({ count: 0 })
    const fail = () => {
      throw new Error('conflict')
    }
    const initial = history.snapshot()
    expect(() => history.commit({ count: 1 }, { id: 'a' }, fail)).toThrow('conflict')
    expect(history.snapshot()).toEqual(initial)
    history.commit({ count: 1 }, { id: 'a' })
    const beforeUndo = history.snapshot()
    expect(() => history.undo(fail)).toThrow('conflict')
    expect(history.snapshot()).toEqual(beforeUndo)
    history.undo((next, effect) => {
      next.count = 100
      effect!.id = 'mutated'
    })
    expect(history.state.value.count).toBe(0)
    const beforeRedo = history.snapshot()
    expect(() => history.redo(fail)).toThrow('conflict')
    expect(history.snapshot()).toEqual(beforeRedo)
    const publish = vi.fn()
    history.redo(publish)
    expect(publish).toHaveBeenCalledWith({ count: 1 }, { id: 'a' })
  })

  it('bounds effects with history, snapshots them across cards, and retains them through shared metadata migration', () => {
    const history = useKeyedHistory<{ count: number }, { id: number }>({ count: 0 }, 2)
    history.reset('a', { count: 0 })
    for (let i = 1; i <= 3; i++) history.commit({ count: i }, { id: i })
    history.undo()
    history.switchTo('b', { count: 10 })
    history.commit({ count: 11 }, { id: 11 })
    history.mapStates(state => ({ count: state.count + 100 }))
    history.switchTo('a', { count: 102 })
    const publish = vi.fn()
    history.undo(publish)
    expect(publish).toHaveBeenCalledWith({ count: 101 }, { id: 2 })
    expect(history.canUndo.value).toBe(false)
    history.redo(publish)
    history.redo(publish)
    expect(publish).toHaveBeenLastCalledWith({ count: 103 }, { id: 3 })
    history.switchTo('b', { count: 111 })
    history.undo(publish)
    expect(publish).toHaveBeenLastCalledWith({ count: 110 }, { id: 11 })
  })

  it('drops effects with a new branch, reset or external card changes, and rejects malformed snapshots', () => {
    const history = useKeyedHistory<{ count: number }, string>({ count: 0 })
    history.reset('a', { count: 0 })
    history.commit({ count: 1 }, 'first')
    history.undo()
    history.commit({ count: 2 })
    expect(history.snapshot().effects).toBeUndefined()
    const snapshot = history.snapshot()
    expect(() => history.restore({ ...snapshot, effects: { past: [], future: [] } })).toThrow()
    expect(history.snapshot()).toEqual(snapshot)
    history.commit({ count: 3 }, 'third')
    history.switchTo('b', { count: 5 })
    history.switchTo('a', { count: 9 })
    expect(history.snapshot()).toEqual({ state: { count: 9 }, past: [], future: [] })
    history.commit({ count: 10 }, 'last')
    history.reset('a', { count: 11 })
    expect(history.snapshot().effects).toBeUndefined()
  })
})
