import type { FolderProjectCard, ImageAsset } from '~/types/editor'
import { describe, expect, it, vi } from 'vitest'
import {
  cardThumbnailFileName,
  loadFolderProjectCardThumbnail,
  removeFolderProjectAssetImages,
  removeFolderProjectCardImages,
  writeFolderProjectCardThumbnail,
} from '~/services/project/folder'

function directory(removed: string[]) {
  return {
    getDirectoryHandle: vi.fn(async () => ({
      removeEntry: vi.fn(async (name: string) => {
        removed.push(name)
      }),
    })),
  } as unknown as FileSystemDirectoryHandle
}

describe('folder project deletion safety', () => {
  it('uses only bounded safe card IDs for thumbnail file names', () => {
    expect(cardThumbnailFileName('card_01-safe')).toBe('card_01-safe.jpg')
    expect(cardThumbnailFileName('../project')).toBeNull()
    expect(cardThumbnailFileName('card/name')).toBeNull()
    expect(cardThumbnailFileName('x'.repeat(129))).toBeNull()
  })

  it('deletes approved card and asset image paths', async () => {
    const removed: string[] = []
    const root = directory(removed)
    await removeFolderProjectCardImages(root, [
      { id: 'card-id', imagePath: 'images/card-id.png' } as FolderProjectCard,
    ])
    await removeFolderProjectAssetImages(
      root,
      [{ id: 'asset-id', imagePath: 'assets/asset-id.png' } as ImageAsset],
      [],
    )

    expect(removed).toEqual(['card-id.png', 'card-id.jpg', 'asset-id.png'])
  })

  it('never deletes files outside the approved directories', async () => {
    const removed: string[] = []
    const root = directory(removed)
    await expect(removeFolderProjectCardImages(root, [
      { imagePath: 'other/valuable.png' } as FolderProjectCard,
    ])).rejects.toThrow('削除を拒否')
    await expect(removeFolderProjectAssetImages(
      root,
      [{ id: 'asset-id', imagePath: 'project.json' } as ImageAsset],
      [],
    )).rejects.toThrow('削除を拒否')

    expect(removed).toEqual([])
  })

  it('loads and writes optional thumbnail cache files', async () => {
    const thumbnail = new File(['thumb'], 'card-id.jpg', {
      type: 'image/jpeg',
    })
    const write = vi.fn()
    const close = vi.fn()
    const getFileHandle = vi.fn(async () => ({
      getFile: vi.fn().mockResolvedValue(thumbnail),
      createWritable: vi.fn().mockResolvedValue({ write, close }),
    }))
    const getDirectoryHandle = vi.fn(async () => ({ getFileHandle }))
    const root = { getDirectoryHandle } as unknown as FileSystemDirectoryHandle

    await expect(loadFolderProjectCardThumbnail(root, 'card-id')).resolves.toBe(
      thumbnail,
    )
    await expect(
      writeFolderProjectCardThumbnail(root, 'card-id', thumbnail),
    ).resolves.toBe(true)

    expect(getDirectoryHandle).toHaveBeenCalledWith('thumbnails')
    expect(getDirectoryHandle).toHaveBeenCalledWith('thumbnails', {
      create: true,
    })
    expect(getFileHandle).toHaveBeenCalledWith('card-id.jpg')
    expect(getFileHandle).toHaveBeenCalledWith('card-id.jpg', { create: true })
    expect(write).toHaveBeenCalledWith(thumbnail)
    expect(close).toHaveBeenCalledOnce()
  })

  it('treats a missing thumbnail directory as an empty cache', async () => {
    const root = {
      getDirectoryHandle: vi.fn().mockRejectedValue(
        new DOMException('missing', 'NotFoundError'),
      ),
    } as unknown as FileSystemDirectoryHandle

    await expect(loadFolderProjectCardThumbnail(root, 'card-id')).resolves.toBeNull()
  })
})
