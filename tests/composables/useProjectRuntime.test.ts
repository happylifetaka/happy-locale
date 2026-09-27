import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useProjectRuntime } from '~/composables/useProjectRuntime'

class FakeImageBitmap {
  close = vi.fn()
}

function loadedImage(name: string) {
  return {
    element: { removeAttribute: vi.fn() } as unknown as HTMLImageElement,
    file: new File(['image'], name, { type: 'image/png' }),
    url: `blob:${name}`,
  }
}

describe('project runtime cache', () => {
  const createObjectURL = vi.fn(() => `blob:thumbnail-${crypto.randomUUID()}`)
  const revokeObjectURL = vi.fn()
  const deleteFont = vi.fn()

  beforeEach(() => {
    vi.stubGlobal('ImageBitmap', FakeImageBitmap)
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })
    vi.stubGlobal('document', { fonts: { delete: deleteFont } })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('only clears the asset blobs that were actually saved', () => {
    const runtime = useProjectRuntime()
    runtime.setPendingAssetWrite('unchanged', new Blob(['saved']))
    runtime.setPendingAssetWrite('updated', new Blob(['old']))
    const saved = new Map(runtime.pendingAssetWrites.value)
    const newer = new Blob(['new'])
    runtime.setPendingAssetWrite('updated', newer)
    runtime.setPendingAssetWrite('added', newer)
    runtime.acknowledgeAssetWrites(saved)
    expect([...runtime.pendingAssetWrites.value.keys()]).toEqual(['updated', 'added'])
    expect(runtime.pendingAssetWrites.value.get('updated')).toBe(newer)
  })

  it('retains the actual saved PNG across acknowledgement, recrop during saving, deletion and reload', () => {
    const runtime = useProjectRuntime()
    const original = new Blob(['original PNG'])
    const firstImage = new FakeImageBitmap() as unknown as ImageBitmap
    runtime.setAssetImage('asset', firstImage)
    runtime.replaceAssetFiles(new Map([['asset', original]]))
    expect(runtime.assetFiles.value.get('asset')).toBe(original)
    const before = new Blob(['before save'])
    runtime.setAssetImage('asset', new FakeImageBitmap() as unknown as ImageBitmap)
    runtime.setPendingAssetWrite('asset', before)
    const saved = new Map(runtime.pendingAssetWrites.value)
    const after = new Blob(['during save'])
    runtime.setAssetImage('asset', new FakeImageBitmap() as unknown as ImageBitmap)
    expect(runtime.assetFiles.value.has('asset')).toBe(false)
    expect(runtime.pendingAssetWrites.value.has('asset')).toBe(false)
    runtime.setPendingAssetWrite('asset', after)
    runtime.acknowledgeAssetWrites(saved)
    expect(runtime.pendingAssetWrites.value.get('asset')).toBe(after)
    expect(runtime.assetFiles.value.has('asset')).toBe(false)
    runtime.acknowledgeAssetWrites(new Map([['asset', after]]))
    expect(runtime.assetFiles.value.get('asset')).toBe(after)
    expect(runtime.pendingAssetWrites.value.has('asset')).toBe(false)
    runtime.removeAssetImage('asset')
    runtime.acknowledgeAssetWrites(saved)
    expect(runtime.assetFiles.value.has('asset')).toBe(false)
    const folder = {} as FileSystemDirectoryHandle
    runtime.setDirectory(folder)
    const generation = runtime.projectGeneration.value
    runtime.setDirectory(folder)
    expect(runtime.projectGeneration.value).toBe(generation + 1)
    runtime.dispose()
    expect(runtime.assetFiles.value.size).toBe(0)
  })

  it('replaces and releases the current card image', () => {
    const runtime = useProjectRuntime()
    const first = loadedImage('first.png')
    const second = loadedImage('second.png')

    runtime.replaceCardImage(first)
    runtime.replaceCardImage(second)

    expect(first.element.removeAttribute).toHaveBeenCalledWith('src')
    expect(revokeObjectURL).toHaveBeenCalledWith(first.url)
    expect(runtime.cardImage.value).toBe(second.element)
    expect(runtime.cardSourceFile.value).toBe(second.file)

    runtime.clearCardImage()
    expect(second.element.removeAttribute).toHaveBeenCalledWith('src')
    expect(revokeObjectURL).toHaveBeenCalledWith(second.url)
    expect(runtime.cardImage.value).toBeNull()
  })

  it('owns thumbnail object URLs and pending blobs', () => {
    const runtime = useProjectRuntime()
    const first = new Blob(['first'])
    const second = new Blob(['second'])

    runtime.setCardThumbnail('card-1', first)
    const firstUrl = runtime.cardThumbnails.value.get('card-1')!
    runtime.setPendingCardThumbnail('card-1', first)
    runtime.setCardThumbnail('card-1', second)

    expect(revokeObjectURL).toHaveBeenCalledWith(firstUrl)
    expect(runtime.pendingCardThumbnailBlobs.value.get('card-1')).toBe(first)

    runtime.removeCardThumbnail('card-1')
    expect(runtime.cardThumbnails.value.has('card-1')).toBe(false)
    expect(runtime.pendingCardThumbnailBlobs.value.has('card-1')).toBe(false)
  })

  it('closes replaced runtime assets and unregisters fonts', () => {
    const runtime = useProjectRuntime()
    const first = new FakeImageBitmap()
    const second = new FakeImageBitmap()
    const firstFont = {} as FontFace
    const secondFont = {} as FontFace

    runtime.setAssetImage('asset-1', first as unknown as ImageBitmap)
    runtime.setAssetImage('asset-1', second as unknown as ImageBitmap)
    runtime.setLoadedFont('font-1', firstFont)
    runtime.setLoadedFont('font-1', secondFont)

    expect(first.close).toHaveBeenCalledOnce()
    expect(deleteFont).toHaveBeenCalledWith(firstFont)

    runtime.dispose()
    expect(second.close).toHaveBeenCalledOnce()
    expect(deleteFont).toHaveBeenCalledWith(secondFont)
    expect(runtime.directory.value).toBeNull()
  })
})
