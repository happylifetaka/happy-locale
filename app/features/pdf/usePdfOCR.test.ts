import type { OCRResult } from '~/services/ocr/types'
import type { PdfAnalysis } from '~/services/pdf'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { effectScope, ref, shallowRef } from 'vue'
import { usePdfOCR } from './usePdfOCR'

const io = vi.hoisted(() => ({
  prepare: vi.fn<typeof import('~/services/ocr/image').prepareRegionForOCR>(),
  recognize: vi.fn<import('~/services/ocr/types').OCRProvider['recognize']>(),
  dispose: vi.fn<() => Promise<void>>(),
}))
vi.mock('~/services/ocr/image', () => ({ prepareRegionForOCR: io.prepare }))
vi.mock('~/services/ocr/tesseract', () => ({
  TesseractOCRProvider: class {
    recognize = io.recognize
    dispose = io.dispose
  },
}))

const scopes: ReturnType<typeof effectScope>[] = []
const area = { x: 10, y: 20, width: 80, height: 30 }
const result = { text: 'Recognized text', confidence: 90, blocks: [] }
beforeEach(() => {
  io.prepare.mockResolvedValue(new Blob(['ocr']))
  io.recognize.mockResolvedValue(result)
  io.dispose.mockResolvedValue(undefined)
})
afterEach(() => {
  scopes.splice(0).forEach(scope => scope.stop())
  vi.resetAllMocks()
})

function setup() {
  const analysis = shallowRef<PdfAnalysis | null>({
    fileName: 'rules.pdf',
    sourceFingerprint: 'a'.repeat(64),
    kind: 'image',
    pageCount: 2,
    features: { formFields: 0, links: 0, annotations: 0 },
    pages: [1, 2].map(pageNumber => ({ pageNumber, kind: 'image', width: 600, height: 800, textCount: 0, rotation: 0, viewportTransform: [1, 0, 0, -1, 0, 800] })),
    entries: [],
  })
  const pageNumber = ref(1)
  const image = shallowRef({ naturalWidth: 1200 } as HTMLImageElement)
  const onApplied = vi.fn()
  const setMessage = vi.fn()
  const scope = effectScope()
  scopes.push(scope)
  const ocr = scope.run(() => usePdfOCR({ analysis, pageNumber, image, baseURL: '/', onApplied, setMessage }))!
  return { scope, analysis, pageNumber, onApplied, setMessage, ocr }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

it('does not start recognition if the page changes during preparation', async () => {
  const { ocr, pageNumber, analysis, onApplied } = setup()
  const pending = deferred<Blob>()
  io.prepare.mockReturnValueOnce(pending.promise)
  const work = ocr.recognizeArea(area)
  pageNumber.value = 2
  pending.resolve(new Blob(['late']))
  await work
  expect(io.recognize).not.toHaveBeenCalled()
  expect(analysis.value!.entries).toEqual([])
  expect(onApplied).not.toHaveBeenCalled()
  expect(ocr.running.value).toBe(false)
})

it.each(['resolve', 'reject'] as const)('ignores progress and %s after the document changes', async (completion) => {
  const { ocr, analysis, onApplied, setMessage } = setup()
  const pending = deferred<OCRResult>()
  io.recognize.mockReturnValueOnce(pending.promise)
  const work = ocr.recognizeArea(area)
  await Promise.resolve()
  analysis.value = { ...analysis.value!, fileName: 'replacement.pdf' }
  const before = analysis.value
  io.recognize.mock.calls[0]![1]!.onProgress!({ status: 'stale progress', progress: 0.9 })
  expect(ocr.progress.value).toBe(0)
  if (completion === 'resolve')
    pending.resolve(result)
  else
    pending.reject(new Error('late failure'))
  await work
  expect(analysis.value).toBe(before)
  expect(onApplied).not.toHaveBeenCalled()
  expect(setMessage).not.toHaveBeenCalled()
  expect(ocr.running.value).toBe(false)
})

it('disposes once and prevents old progress or results from reaching a new instance', async () => {
  const old = setup()
  const pending = deferred<OCRResult>()
  io.recognize.mockReturnValueOnce(pending.promise)
  const work = old.ocr.recognizeArea(area)
  await Promise.resolve()
  await old.ocr.recognizeArea(area)
  expect(io.recognize).toHaveBeenCalledOnce()
  old.scope.stop()
  expect(io.dispose).toHaveBeenCalledOnce()
  expect(old.ocr.running.value).toBe(false)
  expect(old.ocr.status.value).toBe('')
  const current = setup()
  await current.ocr.recognizeArea(area)
  const before = current.analysis.value
  io.recognize.mock.calls[0]![1]!.onProgress!({ status: 'stale progress', progress: 0.8 })
  pending.resolve(result)
  await work
  await old.ocr.recognizeArea(area)
  expect(io.recognize).toHaveBeenCalledTimes(2)
  expect(old.ocr.progress.value).toBe(0)
  expect(old.ocr.status.value).toBe('')
  expect(old.onApplied).not.toHaveBeenCalled()
  expect(current.analysis.value).toBe(before)
  expect(current.onApplied).toHaveBeenCalledOnce()
})

it('clears the busy state after failure and allows a new request', async () => {
  const { ocr, analysis, setMessage } = setup()
  io.prepare.mockRejectedValueOnce(new Error('preparation failed'))
  await ocr.recognizeArea(area)
  expect(ocr.running.value).toBe(false)
  expect(ocr.status.value).toBe('')
  expect(setMessage).toHaveBeenCalledWith(expect.stringContaining('preparation failed'))
  expect(analysis.value!.entries).toEqual([])
  await ocr.recognizeArea(area)
  expect(analysis.value!.entries).toHaveLength(1)
  expect(ocr.running.value).toBe(false)
})
