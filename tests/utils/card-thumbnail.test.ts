import { describe, expect, it } from 'vitest'
import {
  CARD_THUMBNAIL_MAX_HEIGHT,
  CARD_THUMBNAIL_MAX_WIDTH,
  cardThumbnailDimensions,
} from '~/utils/card-thumbnail'

describe('card thumbnail dimensions', () => {
  it('fits portrait and landscape images without changing their ratio', () => {
    expect(cardThumbnailDimensions(1000, 2000)).toEqual({
      width: 90,
      height: CARD_THUMBNAIL_MAX_HEIGHT,
    })
    expect(cardThumbnailDimensions(2000, 1000)).toEqual({
      width: CARD_THUMBNAIL_MAX_WIDTH,
      height: 72,
    })
  })

  it('does not enlarge a small source image', () => {
    expect(cardThumbnailDimensions(72, 90)).toEqual({ width: 72, height: 90 })
  })
})
