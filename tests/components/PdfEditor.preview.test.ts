// @vitest-environment happy-dom
import type { PdfAnalysis } from '~/services/pdf'
import { flushPromises, shallowMount } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import PdfEditor from '~/features/pdf/PdfEditor.vue'
import * as pdfService from '~/services/pdf'
import { serializePdfTranslationCsv } from '~/services/pdf'
import { parsePdfProject } from '~/services/pdf-project'

const io = vi.hoisted(() => ({
  analyzePdf: vi.fn<typeof import('~/services/pdf').analyzePdf>(),
  renderPdfPagePreview: vi.fn<typeof import('~/services/pdf').renderPdfPagePreview>(),
  createTranslatedPdf: vi.fn<typeof import('~/services/pdf').createTranslatedPdf>(),
  fingerprintPdfFile: vi.fn<typeof import('~/services/pdf').fingerprintPdfFile>(),
}))
const downloads = vi.hoisted(() => ({ downloadBlob: vi.fn(), downloadText: vi.fn() }))
vi.mock('~/utils/download', () => downloads)
const ocr = vi.hoisted(() => ({
  prepareRegionForOCR: vi.fn<typeof import('~/services/ocr/image').prepareRegionForOCR>(),
  recognize: vi.fn<import('~/services/ocr/types').OCRProvider['recognize']>(),
  dispose: vi.fn<() => Promise<void>>(),
}))
vi.mock('~/services/ocr/image', () => ({ prepareRegionForOCR: ocr.prepareRegionForOCR }))
vi.mock('~/services/pdf', async importOriginal => ({
  ...await importOriginal<typeof import('~/services/pdf')>(),
  ...io,
}))
vi.mock('~/services/ocr/tesseract', () => ({
  TesseractOCRProvider: class {
    recognize = ocr.recognize
    dispose = ocr.dispose
  },
}))
let wrapper: ReturnType<typeof shallowMount<typeof PdfEditor>> | undefined

beforeEach(() => {
  for (const [name, value] of Object.entries({
    computed,
    onBeforeUnmount,
    ref,
    shallowRef,
    watch,
    useRuntimeConfig: () => ({ app: { baseURL: '/' } }),
    useUnsavedChanges: () => ({ leaveConfirmationOpen: ref(false), confirmLeave: async () => true, resolveLeave: () => {} }),
  })) vi.stubGlobal(name, value)
  vi.stubGlobal('Image', class {
    naturalWidth = 1200
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    source = ''
    get src() { return this.source }
    set src(value: string) {
      this.source = value
      queueMicrotask(() => this.onload?.())
    }

    removeAttribute() {}
  })
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:preview')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  io.renderPdfPagePreview.mockResolvedValue(new Blob(['page']))
  io.createTranslatedPdf.mockResolvedValue(new Blob(['translated pdf']))
  io.fingerprintPdfFile.mockResolvedValue('a'.repeat(64))
  ocr.prepareRegionForOCR.mockResolvedValue(new Blob(['ocr']))
  ocr.recognize.mockResolvedValue({ text: 'Recognized text', confidence: 90, blocks: [] })
  ocr.dispose.mockResolvedValue(undefined)
  const analysis: PdfAnalysis = {
    fileName: 'rules.pdf',
    sourceFingerprint: 'a'.repeat(64),
    kind: 'text',
    pageCount: 2,
    pages: [1, 2].map(pageNumber => ({ pageNumber, kind: 'text', width: 600, height: 800, textCount: 1, rotation: 0, viewportTransform: [1, 0, 0, -1, 0, 800] })),
    entries: [1, 2].map(pageNumber => ({ id: `entry-${pageNumber}`, pageNumber, original: `Page ${pageNumber}`, x: 20, y: 700, width: 100, height: 12, fontSize: 10 })),
    features: { formFields: 0, links: 0, annotations: 0 },
  }
  io.analyzePdf.mockResolvedValue(analysis)
  wrapper = shallowMount(PdfEditor, {
    global: {
      stubs: {
        AppNavigation: true,
        BrandMark: true,
        DataPrivacyFooter: true,
        UnsavedChangesDialog: true,
        PdfPreviewCanvas: { name: 'PdfPreviewCanvas', props: ['page', 'entries', 'translations', 'excludedEntryIds', 'selectedEntryId', 'protectionEditing', 'ocrEditing'], template: '<div />' },
      },
    },
  })
})
afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.resetAllMocks()
})

async function openPdf() {
  const input = wrapper!.get('input[accept="application/pdf,.pdf"]')
  Object.defineProperty(input.element, 'files', { value: [new File(['pdf'], 'rules.pdf')], configurable: true })
  await input.trigger('change')
  await flushPromises()
}

it('selects the adopted page entry and resets editing modes after page navigation', async () => {
  await openPdf()
  const canvas = () => wrapper!.getComponent({ name: 'PdfPreviewCanvas' })
  expect(canvas().props('selectedEntryId')).toBe('entry-1')
  const protect = wrapper!.findAll('button').find(button => button.text() === '保護領域を追加')!
  await protect.trigger('click')
  expect(canvas().props('protectionEditing')).toBe(true)
  await wrapper!.get('.pdf-preview-toolbar select').setValue('2')
  await flushPromises()
  expect(canvas().props('page').pageNumber).toBe(2)
  expect(canvas().props('selectedEntryId')).toBe('entry-2')
  expect(canvas().props('protectionEditing')).toBe(false)
  expect(canvas().props('ocrEditing')).toBe(false)
  expect(wrapper!.get('textarea').element.value).toBe('Page 2')
})

it('clears the previous document image when a replacement preview fails', async () => {
  await openPdf()
  io.renderPdfPagePreview.mockRejectedValueOnce(new Error('replacement failed'))
  await openPdf()
  expect(wrapper!.findComponent({ name: 'PdfPreviewCanvas' }).exists()).toBe(false)
  expect(wrapper!.get('[role="status"]').text()).toContain('replacement failed')
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview')
})

async function clickButton(label: string) {
  const button = wrapper!.findAll('button').find(button => button.text() === label)
  expect(button, label).toBeDefined()
  await button!.trigger('click')
}

async function importTranslations() {
  const analysis = await io.analyzePdf.mock.results[0]!.value
  const csv = serializePdfTranslationCsv(analysis, new Map([['entry-1', '訳文1'], ['entry-2', '訳文2']]))
  const input = wrapper!.get('input[accept=".csv,text/csv"]')
  const file = new File([csv], 'translations.csv')
  Object.defineProperty(file, 'text', { value: async () => csv })
  Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
  await input.trigger('change')
  await flushPromises()
}

it('updates the selected original and invalidates only its translation', async () => {
  await openPdf()
  await importTranslations()
  const canvas = wrapper!.getComponent({ name: 'PdfPreviewCanvas' })
  expect(canvas.props('translations').get('entry-1')).toBe('訳文1')
  await wrapper!.get('textarea').setValue('Corrected original')
  await clickButton('原文を更新')
  expect(canvas.props('entries')[0].original).toBe('Corrected original')
  expect(canvas.props('translations').has('entry-1')).toBe(false)
  expect(canvas.props('translations').get('entry-2')).toBe('訳文2')
  await wrapper!.get('.pdf-preview-toolbar select').setValue('2')
  await flushPromises()
  expect(wrapper!.get('textarea').element.value).toBe('Page 2')
})

it('keeps selection and exclusion consistent through split, reorder and merge', async () => {
  await openPdf()
  await importTranslations()
  const canvas = wrapper!.getComponent({ name: 'PdfPreviewCanvas' })
  await clickButton('CSV対象から除外')
  await wrapper!.get('textarea').setValue('First line\nSecond line')
  await clickButton('改行で分割')
  const ids = canvas.props('entries').map((entry: { id: string }) => entry.id)
  expect(ids).toHaveLength(2)
  expect(canvas.props('selectedEntryId')).toBe(ids[0])
  expect([...canvas.props('excludedEntryIds')]).toEqual(expect.arrayContaining(ids))
  expect(canvas.props('translations').has('entry-1')).toBe(false)
  expect(canvas.props('translations').get('entry-2')).toBe('訳文2')
  await clickButton('次へ')
  expect(canvas.props('entries').map((entry: { id: string }) => entry.id)).toEqual([ids[1], ids[0]])
  await clickButton('前へ')
  await clickButton('次の項目と結合')
  expect(canvas.props('entries')).toHaveLength(1)
  expect(canvas.props('selectedEntryId')).toBe(ids[0])
  expect([...canvas.props('excludedEntryIds')]).toEqual([ids[0]])
  expect(wrapper!.get('textarea').element.value).toContain('Second line')
  await clickButton('CSV対象へ戻す')
  expect(canvas.props('excludedEntryIds').size).toBe(0)
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

it('adds OCR results to the current page and selects the new entry', async () => {
  await openPdf()
  await clickButton('範囲を選んでOCR')
  const canvas = wrapper!.getComponent({ name: 'PdfPreviewCanvas' })
  canvas.vm.$emit('add-ocr-area', { x: 10, y: 20, width: 80, height: 30 })
  await flushPromises()
  expect(ocr.prepareRegionForOCR).toHaveBeenCalledWith(expect.anything(), { x: 20, y: 40, width: 160, height: 60 }, { scale: 2, padding: 8 })
  expect(canvas.props('entries')).toHaveLength(2)
  const added = canvas.props('entries').find((entry: { original: string }) => entry.original === 'Recognized text')
  expect(added).toBeDefined()
  expect(canvas.props('selectedEntryId')).toBe(added.id)
  expect(canvas.props('ocrEditing')).toBe(false)
  expect(wrapper!.get('textarea').element.value).toBe('Recognized text')
})

it.each([
  ['prepare', 'resolve'],
  ['prepare', 'reject'],
  ['recognize', 'resolve'],
  ['recognize', 'reject'],
] as const)('ignores OCR %s completion with %s after unmount', async (stage, completion) => {
  await openPdf()
  const preparation = deferred<Blob>()
  const recognition = deferred<import('~/services/ocr/types').OCRResult>()
  if (stage === 'prepare')
    ocr.prepareRegionForOCR.mockReturnValueOnce(preparation.promise)
  else
    ocr.recognize.mockReturnValueOnce(recognition.promise)
  const addEntry = vi.spyOn(pdfService, 'addPdfOcrEntry')
  const formatError = vi.spyOn(pdfService, 'pdfProcessingErrorMessage')
  wrapper!.getComponent({ name: 'PdfPreviewCanvas' }).vm.$emit('add-ocr-area', { x: 10, y: 20, width: 80, height: 30 })
  await flushPromises()
  wrapper!.unmount()
  wrapper = undefined
  expect(ocr.dispose).toHaveBeenCalledOnce()
  if (stage === 'prepare') {
    if (completion === 'resolve')
      preparation.resolve(new Blob(['ocr']))
    else preparation.reject(new Error('late preprocessing failure'))
  }
  else {
    if (completion === 'resolve')
      recognition.resolve({ text: 'Late result', confidence: 90, blocks: [] })
    else recognition.reject(new Error('late recognition failure'))
  }
  await flushPromises()
  expect(ocr.recognize).toHaveBeenCalledTimes(stage === 'prepare' ? 0 : 1)
  expect(addEntry).not.toHaveBeenCalled()
  expect(formatError).not.toHaveBeenCalled()
})

async function selectTextFile(selector: string, name: string, text: string) {
  const input = wrapper!.get(selector)
  const file = new File([text], name)
  Object.defineProperty(file, 'text', { value: async () => text })
  Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
  await input.trigger('change')
  await flushPromises()
}

it('exports the current translations, exclusions, protected areas and output settings', async () => {
  await openPdf()
  await importTranslations()
  await clickButton('CSV対象から除外')
  const area = { x: 10, y: 20, width: 80, height: 30 }
  wrapper!.getComponent({ name: 'PdfPreviewCanvas' }).vm.$emit('add-protected-area', area)
  await wrapper!.get('input[value="white"]').setValue(true)
  await clickButton('3. 翻訳PDFを保存')
  await flushPromises()
  expect(io.createTranslatedPdf).toHaveBeenCalledOnce()
  const args = io.createTranslatedPdf.mock.calls[0]!
  expect(args[2].get('entry-2')).toBe('訳文2')
  expect(args[4]).toMatchObject({ backgroundMode: 'white' })
  expect([...args[4]!.excludedEntryIds!]).toEqual(['entry-1'])
  expect(args[4]!.protectedAreas!.get(1)).toEqual([area])
  expect(downloads.downloadBlob).toHaveBeenCalledWith(expect.any(Blob), 'rules-ja.pdf')
  expect(wrapper!.find('.pdf-processing-status').exists()).toBe(false)
})

it('saves and restores the edited document only after matching the source PDF', async () => {
  await openPdf()
  await importTranslations()
  await clickButton('CSV対象から除外')
  await clickButton('作業を保存')
  const savedText = downloads.downloadText.mock.calls[0]![0] as string
  expect(parsePdfProject(savedText).excludedEntryIds).toEqual(['entry-1'])
  await wrapper!.get('textarea').setValue('Unsaved change')
  await clickButton('原文を更新')
  await selectTextFile('input[accept=".json,application/json"]', 'work.json', savedText)
  await openPdf()
  const canvas = wrapper!.getComponent({ name: 'PdfPreviewCanvas' })
  expect(io.fingerprintPdfFile).toHaveBeenCalledOnce()
  expect(canvas.props('entries')[0].original).toBe('Page 1')
  expect(canvas.props('translations').get('entry-1')).toBe('訳文1')
  expect([...canvas.props('excludedEntryIds')]).toEqual(['entry-1'])
  expect(wrapper!.find('.pdf-processing-status').exists()).toBe(false)
})

it('keeps the current document when the project source fingerprint mismatches', async () => {
  await openPdf()
  await clickButton('作業を保存')
  await selectTextFile('input[accept=".json,application/json"]', 'work.json', downloads.downloadText.mock.calls[0]![0])
  await wrapper!.get('textarea').setValue('Keep this edit')
  await clickButton('原文を更新')
  io.fingerprintPdfFile.mockResolvedValueOnce('b'.repeat(64))
  await openPdf()
  expect(wrapper!.get('textarea').element.value).toBe('Keep this edit')
  expect(wrapper!.find('.pdf-processing-status').exists()).toBe(false)
})

it.each(['resolve', 'reject'] as const)('ignores PDF export %s after unmount', async (completion) => {
  await openPdf()
  await importTranslations()
  const pending = deferred<Blob>()
  io.createTranslatedPdf.mockReturnValueOnce(pending.promise)
  const formatError = vi.spyOn(pdfService, 'pdfProcessingErrorMessage')
  await clickButton('3. 翻訳PDFを保存')
  await flushPromises()
  const signal = io.createTranslatedPdf.mock.calls[0]![5]!
  wrapper!.unmount()
  wrapper = undefined
  expect(signal.aborted).toBe(true)
  if (completion === 'resolve')
    pending.resolve(new Blob(['late export']))
  else
    pending.reject(new Error('late export error'))
  await flushPromises()
  expect(downloads.downloadBlob).not.toHaveBeenCalled()
  expect(formatError).not.toHaveBeenCalled()
})

it('does not adopt analysis if cancellation races with successful completion', async () => {
  await openPdf()
  await wrapper!.get('textarea').setValue('Keep this edit')
  await clickButton('原文を更新')
  const original = await io.analyzePdf.mock.results[0]!.value
  const pending = deferred<PdfAnalysis>()
  io.analyzePdf.mockReturnValueOnce(pending.promise)
  await openPdf()
  await wrapper!.get('.pdf-processing-status button').trigger('click')
  expect(io.analyzePdf.mock.calls[1]![2]!.aborted).toBe(true)
  pending.resolve(original)
  await flushPromises()
  expect(wrapper!.get('textarea').element.value).toBe('Keep this edit')
  expect(wrapper!.find('.pdf-processing-status').exists()).toBe(false)
})

it('does not download an export that completes after cancellation', async () => {
  await openPdf()
  await importTranslations()
  const pending = deferred<Blob>()
  io.createTranslatedPdf.mockReturnValueOnce(pending.promise)
  await clickButton('3. 翻訳PDFを保存')
  await wrapper!.get('.pdf-processing-status button').trigger('click')
  pending.resolve(new Blob(['cancelled export']))
  await flushPromises()
  expect(downloads.downloadBlob).not.toHaveBeenCalled()
  expect(wrapper!.find('.pdf-processing-status').exists()).toBe(false)
  expect(wrapper!.get('[role="status"]').text()).toContain('キャンセルしました')
})

it('does not restore a project if cancelled during source verification', async () => {
  await openPdf()
  await clickButton('作業を保存')
  await selectTextFile('input[accept=".json,application/json"]', 'work.json', downloads.downloadText.mock.calls[0]![0])
  await wrapper!.get('textarea').setValue('Keep this edit')
  await clickButton('原文を更新')
  const pending = deferred<string>()
  io.fingerprintPdfFile.mockReturnValueOnce(pending.promise)
  await openPdf()
  await wrapper!.get('.pdf-processing-status button').trigger('click')
  pending.resolve('a'.repeat(64))
  await flushPromises()
  expect(wrapper!.get('textarea').element.value).toBe('Keep this edit')
  expect(wrapper!.find('.pdf-processing-status').exists()).toBe(false)
})

it('ignores an analysis error after unmount', async () => {
  const pending = deferred<PdfAnalysis>()
  io.analyzePdf.mockReturnValueOnce(pending.promise)
  const formatError = vi.spyOn(pdfService, 'pdfProcessingErrorMessage')
  await openPdf()
  wrapper!.unmount()
  wrapper = undefined
  pending.reject(new Error('late analysis failure'))
  await flushPromises()
  expect(formatError).not.toHaveBeenCalled()
})
