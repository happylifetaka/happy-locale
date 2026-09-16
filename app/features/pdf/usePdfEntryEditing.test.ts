import type { PdfAnalysis } from '~/services/pdf'
import { afterEach, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref, shallowRef } from 'vue'
import { usePdfEntryEditing } from './usePdfEntryEditing'

const scopes: ReturnType<typeof effectScope>[] = []
afterEach(() => scopes.splice(0).forEach(scope => scope.stop()))

function setup() {
  const analysis = shallowRef<PdfAnalysis | null>({
    fileName: 'rules.pdf',
    sourceFingerprint: 'a'.repeat(64),
    kind: 'text',
    pageCount: 2,
    features: { formFields: 0, links: 0, annotations: 0 },
    pages: [1, 2].map(pageNumber => ({ pageNumber, kind: 'text', width: 600, height: 800, textCount: 1, rotation: 0, viewportTransform: [1, 0, 0, -1, 0, 800] })),
    entries: [1, 2].map(pageNumber => ({ id: `entry-${pageNumber}`, pageNumber, original: `Page ${pageNumber}`, x: 20, y: 700, width: 100, height: 12, fontSize: 10 })),
  })
  const translations = shallowRef(new Map([['entry-1', '訳文1'], ['entry-2', '訳文2']]))
  const pageNumber = ref(1)
  const setMessage = vi.fn()
  const scope = effectScope()
  scopes.push(scope)
  const editing = scope.run(() => usePdfEntryEditing({ analysis, translations, pageNumber, setMessage }))!
  return { analysis, translations, pageNumber, setMessage, editing }
}

it('keeps the document and translations when the original draft is invalid', async () => {
  const { analysis, translations, editing, setMessage } = setup()
  editing.selectedEntryId.value = 'entry-1'
  await nextTick()
  const before = analysis.value
  const translationsBefore = translations.value
  editing.originalDraft.value = '   '
  editing.applySelectedEntryOriginal()
  expect(analysis.value).toBe(before)
  expect(translations.value).toBe(translationsBefore)
  expect(editing.originalDraft.value).toBe('   ')
  expect(setMessage).toHaveBeenCalledOnce()
})

it('does not merge entries across pages or apply a draft after selection disappears', async () => {
  const { analysis, translations, editing, pageNumber } = setup()
  editing.selectedEntryId.value = 'entry-1'
  await nextTick()
  const before = analysis.value
  editing.mergeSelectedEntry()
  expect(analysis.value).toBe(before)
  editing.originalDraft.value = 'Unsaved draft'
  pageNumber.value = 2
  await nextTick()
  expect(editing.selectedEntry.value).toBeNull()
  expect(editing.originalDraft.value).toBe('')
  editing.applySelectedEntryOriginal()
  expect(analysis.value).toBe(before)
  expect(translations.value.get('entry-1')).toBe('訳文1')
})

it('resets selection and draft when restoring exclusions and keeps instances independent', async () => {
  const { editing } = setup()
  const other = setup().editing
  editing.selectedEntryId.value = 'entry-1'
  await nextTick()
  editing.originalDraft.value = 'Unsaved draft'
  editing.toggleSelectedEntryExclusion()
  editing.reset(['entry-2'])
  await nextTick()
  expect(editing.selectedEntryId.value).toBeNull()
  expect(editing.originalDraft.value).toBe('')
  expect([...editing.excludedEntryIds.value]).toEqual(['entry-2'])
  expect(other.excludedEntryIds.value.size).toBe(0)
  editing.reset()
  expect(editing.excludedEntryIds.value.size).toBe(0)
})
