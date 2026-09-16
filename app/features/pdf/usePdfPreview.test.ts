import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, shallowRef } from 'vue'
import { usePdfPreview } from './usePdfPreview'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((accept, decline) => {
    resolve = accept
    reject = decline
  })
  return { promise, resolve, reject }
}

class PreviewImage {
  static instances: PreviewImage[] = []
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  src = ''
  removeAttribute = vi.fn()
  constructor() { PreviewImage.instances.push(this) }
}

const scopes: ReturnType<typeof effectScope>[] = []
function setup() {
  const scope = effectScope()
  scopes.push(scope)
  const source = shallowRef<File | null>(new File(['pdf'], 'one.pdf'))
  const render = vi.fn<(file: File, page: number) => Promise<Blob>>()
  const preview = scope.run(() => usePdfPreview(source, render))!
  return { scope, source, render, preview }
}

async function rendered() {
  await Promise.resolve()
  return PreviewImage.instances.at(-1)!
}

beforeEach(() => {
  PreviewImage.instances = []
  vi.stubGlobal('Image', PreviewImage)
  let sequence = 0
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:${++sequence}`)
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
})
afterEach(() => {
  scopes.splice(0).forEach(scope => scope.stop())
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('pdf preview ownership', () => {
  it('adopts decoded pages and releases the previous image and the final URL', async () => {
    const { preview, render, scope } = setup()
    render.mockResolvedValue(new Blob(['page']))
    const first = preview.load(1)
    const firstImage = await rendered()
    firstImage.onload!()
    expect(await first).toBe(true)
    const second = preview.load(2)
    const secondImage = await rendered()
    expect(preview.pageNumber.value).toBe(1)
    secondImage.onload!()
    expect(await second).toBe(true)
    expect(preview.image.value).toBe(secondImage)
    expect(preview.pageNumber.value).toBe(2)
    expect(firstImage.removeAttribute).toHaveBeenCalledWith('src')
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:1')
    scope.stop()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:2')
    expect(preview.image.value).toBeNull()
  })

  it.each(['resolve', 'reject'] as const)('ignores an obsolete render %s while the current request loads', async (outcome) => {
    const { preview, render } = setup()
    const old = deferred<Blob>()
    render.mockReturnValueOnce(old.promise).mockResolvedValueOnce(new Blob())
    const first = preview.load(1)
    const second = preview.load(2)
    const currentImage = await rendered()
    if (outcome === 'resolve')
      old.resolve(new Blob())
    else old.reject(new Error('obsolete'))
    expect(await first).toBe(false)
    expect(preview.error.value).toBeNull()
    expect(preview.loading.value).toBe(true)
    currentImage.onload!()
    expect(await second).toBe(true)
    expect(preview.pageNumber.value).toBe(2)
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
  })

  it('cancels an obsolete image load without waiting for its browser event', async () => {
    const { preview, render } = setup()
    render.mockResolvedValue(new Blob())
    const first = preview.load(1)
    const old = await rendered()
    const second = preview.load(2)
    expect(await first).toBe(false)
    expect(old.onload).toBeNull()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:1')
    const current = await rendered()
    current.onload!()
    expect(await second).toBe(true)
  })

  it('keeps the last adopted page on image failure and clears the error on retry', async () => {
    const { preview, render } = setup()
    render.mockResolvedValue(new Blob())
    const first = preview.load(1)
    const previous = await rendered()
    previous.onload!()
    await first
    const failed = preview.load(2)
    ;(await rendered()).onerror!()
    expect(await failed).toBe(false)
    expect(preview.image.value).toBe(previous)
    expect(preview.error.value).toBeInstanceOf(Error)
    expect(preview.loading.value).toBe(false)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:2')
    const retry = preview.load(2)
    expect(preview.error.value).toBeNull()
    ;(await rendered()).onload!()
    expect(await retry).toBe(true)
  })

  it.each(['replace', 'dispose'] as const)('%s invalidates pending rendering', async (action) => {
    const { preview, render, source, scope } = setup()
    const pending = deferred<Blob>()
    render.mockReturnValue(pending.promise)
    const loading = preview.load(3)
    if (action === 'replace')
      source.value = new File(['new'], 'two.pdf')
    else scope.stop()
    pending.reject(new Error('late failure'))
    expect(await loading).toBe(false)
    expect(preview.error.value).toBeNull()
    expect(preview.loading.value).toBe(false)
    expect(URL.createObjectURL).not.toHaveBeenCalled()
  })

  it.each(['replace', 'dispose'] as const)('%s releases both displayed and pending images immediately', async (action) => {
    const { preview, render, source, scope } = setup()
    render.mockResolvedValue(new Blob())
    const first = preview.load(2)
    ;(await rendered()).onload!()
    await first
    const pending = preview.load(3)
    await rendered()
    if (action === 'replace')
      source.value = new File(['new'], 'two.pdf')
    else scope.stop()
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2)
    expect(preview.image.value).toBeNull()
    expect(preview.pageNumber.value).toBe(1)
    expect(await pending).toBe(false)
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2)
  })
})
