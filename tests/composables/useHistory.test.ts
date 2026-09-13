import { describe, expect, it } from 'vitest'
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
