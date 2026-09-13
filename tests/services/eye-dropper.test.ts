import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  pickScreenColor,
  supportsEyeDropper,
} from '~/services/colors/eye-dropper'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('eye dropper', () => {
  it('returns the selected sRGB color', async () => {
    vi.stubGlobal('window', {
      EyeDropper: class {
        async open() {
          return { sRGBHex: '#12abef' }
        }
      },
    })

    expect(supportsEyeDropper()).toBe(true)
    await expect(pickScreenColor()).resolves.toBe('#12abef')
  })

  it('returns null when selection is cancelled', async () => {
    vi.stubGlobal('window', {
      EyeDropper: class {
        async open() {
          throw new DOMException('Cancelled', 'AbortError')
        }
      },
    })

    await expect(pickScreenColor()).resolves.toBeNull()
  })
})
