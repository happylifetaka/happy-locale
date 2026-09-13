import type { ImageAsset, SourceIcon } from '~/types/editor'
import { describe, expect, it } from 'vitest'
import { useCardEditor } from '~/composables/useCardEditor'
import { createLayoutTemplate, placeLayoutTemplate } from '~/utils/layout-template'
import { transformRegionContents } from '~/utils/regions'
import { sourceIconProblems, textWithSourceIcons } from '~/utils/source-icons'
import { splitTextRegion } from '~/utils/split-region'

const assets = [{ id: 'a', name: 'wound' }, { id: 'b', name: 'spell' }] as ImageAsset[]
const icons: SourceIcon[] = [
  { id: 'one', assetId: 'a', x: 80, y: 0, width: 20, height: 20 },
  { id: 'two', assetId: 'b', x: 100, y: 40, width: 20, height: 20 },
]
const word = (text: string, x: number, y: number) => ({ text, x: 12 + x * 3, y: 12 + y * 3, width: 15 * 3, height: 20 * 3, confidence: 90 })
function editorFixture() {
  const editor = useCardEditor()
  editor.loadImageProject('source.png', 200, 200)
  editor.addRegion({ x: 0, y: 0, width: 160, height: 80 }, '#fff')
  editor.updateRegion(editor.selectedRegionId.value!, { sourceIcons: icons })
  return editor
}

describe('source image icons', () => {
  it('inserts icons in geometric reading order without interpreting their meaning or numbers', () => {
    const result = { text: 'unreliable', confidence: 90, blocks: [], words: [word('.', 130, 40), word('or', 50, 0), word('Gain', 0, 40), word('Discard', 0, 0), word('+1', 50, 40)] }
    expect(textWithSourceIcons(result, [...icons].reverse(), assets)).toBe('Discard or [icon:wound]\nGain +1 [icon:spell] .')
    expect(textWithSourceIcons(result, [], assets)).toBe('unreliable')
    expect(() => textWithSourceIcons({ ...result, words: [] }, icons, assets)).toThrow('単語の位置')
  })

  it('requires registered assets and valid region-local bounds', () => {
    const region = editorFixture().selectedRegion.value!
    expect(sourceIconProblems(region, assets)).toEqual([])
    expect(sourceIconProblems(region, assets.slice(1))).toHaveLength(1)
    expect(sourceIconProblems({ ...region, width: 90 }, assets)).toHaveLength(2)
  })

  it('preserves anchors through templates, moves and splits and blocks splitting through an icon', () => {
    const editor = editorFixture()
    const region = editor.selectedRegion.value!
    const template = createLayoutTemplate('any layout', editor.project.value, [region.id])
    expect(placeLayoutTemplate(template, 400, 400)[0]!.sourceIcons![0]).toMatchObject({ x: 160, y: 0, width: 40, height: 40 })
    expect(transformRegionContents(region, { ...region, x: 10, width: 150 }).sourceIcons![0]!.x).toBe(70)
    const texts = [{ originalText: '', translatedText: '' }, { originalText: '', translatedText: '' }] as const
    const [first, second] = splitTextRegion(region, 'horizontal', 30, texts)
    expect(first.sourceIcons).toHaveLength(1)
    expect(second.sourceIcons![0]).toMatchObject({ assetId: 'b', y: 10 })
    expect(() => splitTextRegion(region, 'horizontal', 50, texts)).toThrow('アイコンをまたがない')
  })

  it('renames source tokens along with translated tokens and handles literal replacement characters', () => {
    const editor = editorFixture()
    editor.updateRegion(editor.selectedRegionId.value!, { originalText: '+1 [icon:spell]', translatedText: '+1 [icon:spell]' })
    editor.renameAssetToken('b', 'spell', '$&')
    expect(editor.selectedRegion.value!.originalText).toBe('+1 [icon:$&]')
    expect(editor.selectedRegion.value!.translatedText).toBe('+1 [icon:$&]')
    expect(editor.selectedRegion.value!.sourceIcons![1]!.assetId).toBe('b')
  })
})
