import { describe, expect, it } from 'vitest'
import { isSupportedFont, loadUserFont } from '~/services/fonts/user-font'
import { FILE_LIMITS } from '~/utils/file-limits'

describe('user font validation', () => {
  it.each(['font.ttf', 'font.otf', 'font.woff', 'font.woff2', 'FONT.TTF'])(
    'accepts %s',
    name => expect(isSupportedFont({ name } as File)).toBe(true),
  )

  it('rejects unrelated files', () => {
    expect(isSupportedFont({ name: 'font.zip' } as File)).toBe(false)
  })

  it('rejects an oversized font before decoding it', async () => {
    const file = {
      name: 'large.ttf',
      size: FILE_LIMITS.fontBytes + 1,
    } as File
    await expect(loadUserFont(file)).rejects.toThrow('20 MiB')
  })
})
