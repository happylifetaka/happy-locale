import type { LocalFontData } from '~/services/fonts/local-font'
import { describe, expect, it } from 'vitest'
import { deduplicateLocalFonts } from '~/services/fonts/local-font'

function font(
  postscriptName: string,
  fullName: string,
  family = fullName,
  style = 'Regular',
): LocalFontData {
  return {
    postscriptName,
    fullName,
    family,
    style,
    blob: async () => new Blob(),
  }
}

describe('local font list', () => {
  it('removes duplicate PostScript names', () => {
    const first = font('NotoSansJP-Regular', 'Noto Sans JP Regular')
    const duplicate = font('NotoSansJP-Regular', 'Noto Sans JP Regular')

    expect(deduplicateLocalFonts([first, duplicate])).toEqual([first])
  })

  it('removes visually identical entries with different PostScript names', () => {
    const first = font('Example-Regular', 'Example', 'Example', 'Regular')
    const duplicate = font('ExampleRoman', 'Example', 'Example', 'Regular')

    expect(deduplicateLocalFonts([first, duplicate])).toEqual([first])
  })

  it('keeps different styles from the same family', () => {
    const regular = font('Example-Regular', 'Example Regular', 'Example')
    const bold = font('Example-Bold', 'Example Bold', 'Example', 'Bold')

    expect(deduplicateLocalFonts([regular, bold])).toEqual([regular, bold])
  })
})
