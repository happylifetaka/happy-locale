// @vitest-environment happy-dom
import type { PdfAnalysis } from '~/services/pdf'
import { flushPromises, shallowMount } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import PdfEditor from '~/features/pdf/PdfEditor.vue'

const io = vi.hoisted(() => ({
  analyzePdf: vi.fn<typeof import('~/services/pdf').analyzePdf>(),
  renderPdfPagePreview: vi.fn<typeof import('~/services/pdf').renderPdfPagePreview>(),
}))
vi.mock('~/services/pdf', async importOriginal => ({
  ...await importOriginal<typeof import('~/services/pdf')>(),
  ...io,
}))
vi.mock('~/services/ocr/tesseract', () => ({
  TesseractOCRProvider: class { dispose = async () => {} },
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
        PdfPreviewCanvas: { name: 'PdfPreviewCanvas', props: ['page', 'selectedEntryId', 'protectionEditing', 'ocrEditing'], template: '<div />' },
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
