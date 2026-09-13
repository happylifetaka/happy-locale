import type { RegionCandidate } from '../../app/services/ocr/types'
import { describe, expect, it } from 'vitest'
import { runSequentialOCRQueue } from '../../app/services/ocr/queue'

const candidate: RegionCandidate = {
  id: 'candidate-1',
  text: 'Card text',
  x: 0,
  y: 0,
  width: 100,
  height: 20,
  confidence: 90,
  selected: true,
  lines: [],
}

describe('runSequentialOCRQueue', () => {
  it('processes one card at a time and reports review and empty results', async () => {
    const running: string[] = []
    let concurrent = 0
    let maxConcurrent = 0
    const states: string[] = []

    const summary = await runSequentialOCRQueue(
      ['card-1', 'card-2'],
      async (cardId) => {
        running.push(cardId)
        concurrent += 1
        maxConcurrent = Math.max(maxConcurrent, concurrent)
        await Promise.resolve()
        concurrent -= 1
        return cardId === 'card-1' ? [candidate] : []
      },
      { onProgress: progress => states.push(`${progress.cardId}:${progress.state.status}`) },
    )

    expect(running).toEqual(['card-1', 'card-2'])
    expect(maxConcurrent).toBe(1)
    expect(states).toEqual([
      'card-1:processing',
      'card-1:review',
      'card-2:processing',
      'card-2:empty',
    ])
    expect(summary).toEqual({
      completed: 2,
      review: 1,
      empty: 1,
      errors: 0,
      cancelled: false,
    })
  })

  it('continues after a card error and cancels between cards', async () => {
    let cancel = false
    const states: string[] = []
    const summary = await runSequentialOCRQueue(
      ['broken', 'done', 'skipped'],
      async (cardId) => {
        if (cardId === 'broken')
          throw new Error('decode failed')
        cancel = true
        return [candidate]
      },
      {
        cancelled: () => cancel,
        onProgress: progress => states.push(`${progress.cardId}:${progress.state.status}`),
      },
    )

    expect(states).toEqual([
      'broken:processing',
      'broken:error',
      'done:processing',
      'done:review',
    ])
    expect(summary).toEqual({
      completed: 2,
      review: 1,
      empty: 0,
      errors: 1,
      cancelled: true,
    })
  })
})
