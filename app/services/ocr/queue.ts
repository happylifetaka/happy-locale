import type { RegionCandidate } from './types'

export type OCRQueueCardState
  = | { status: 'queued' }
    | { status: 'processing' }
    | { status: 'review', candidates: number }
    | { status: 'empty' }
    | { status: 'error', message: string }

export interface OCRQueueProgress {
  cardId: string
  index: number
  total: number
  state: OCRQueueCardState
}

export interface OCRQueueSummary {
  completed: number
  review: number
  empty: number
  errors: number
  cancelled: boolean
}

/** カード単位で順番にOCRを実行する。一枚の失敗は記録して続行し、中止は次のカードの前に確認する。 */
export async function runSequentialOCRQueue(
  cardIds: readonly string[],
  process: (cardId: string) => Promise<RegionCandidate[]>,
  options: {
    cancelled?: () => boolean
    onProgress?: (progress: OCRQueueProgress) => void
  } = {},
): Promise<OCRQueueSummary> {
  const summary: OCRQueueSummary = {
    completed: 0,
    review: 0,
    empty: 0,
    errors: 0,
    cancelled: false,
  }

  for (let index = 0; index < cardIds.length; index += 1) {
    if (options.cancelled?.()) {
      summary.cancelled = true
      break
    }
    const cardId = cardIds[index]!
    options.onProgress?.({
      cardId,
      index,
      total: cardIds.length,
      state: { status: 'processing' },
    })
    try {
      const candidates = await process(cardId)
      const state: OCRQueueCardState = candidates.length > 0
        ? { status: 'review', candidates: candidates.length }
        : { status: 'empty' }
      summary.completed += 1
      if (state.status === 'review')
        summary.review += 1
      else
        summary.empty += 1
      options.onProgress?.({ cardId, index, total: cardIds.length, state })
    }
    catch (error) {
      summary.completed += 1
      summary.errors += 1
      options.onProgress?.({
        cardId,
        index,
        total: cardIds.length,
        state: {
          status: 'error',
          message: error instanceof Error ? error.message : String(error),
        },
      })
    }
  }
  return summary
}
