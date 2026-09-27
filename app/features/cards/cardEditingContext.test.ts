import type { useCardEditing, useCardOCR, useCardResources, useCardSourceIcons } from './cardEditingContext'
import { expectTypeOf, it } from 'vitest'

// pnpm typecheckでも検査する。実装に内部操作を追加しても子の公開型へ漏れない契約。
it('does not expose project lifecycle, resource disposal or candidate detection to child views', () => {
  type Editing = ReturnType<typeof useCardEditing>
  type OCR = ReturnType<typeof useCardOCR>
  type Resources = ReturnType<typeof useCardResources>
  expectTypeOf<Extract<keyof Editing['editor'], 'loadSavedProject' | 'loadImageProject' | 'switchSavedProject' | 'bindSavedCard'>>().toEqualTypeOf<never>()
  expectTypeOf<Extract<keyof Editing['workspace'], 'stopEditing' | 'resetCardSelection' | 'maskEditing' | 'exclusionEditing'>>().toEqualTypeOf<never>()
  expectTypeOf<Extract<keyof OCR['candidates'], 'detectRegionCandidates' | 'clearRegionCandidates' | 'regionCandidateEditHistory'>>().toEqualTypeOf<never>()
  expectTypeOf<Extract<keyof Resources, 'dispose' | 'replaceCardImage' | 'replaceLoadedFonts'>>().toEqualTypeOf<never>()
})

it('lets the inspector open source icon review without owning its target or applying it', () => {
  expectTypeOf<keyof ReturnType<typeof useCardSourceIcons>>().toEqualTypeOf<'open'>()
})
