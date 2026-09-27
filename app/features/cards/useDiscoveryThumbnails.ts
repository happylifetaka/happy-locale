import type { DiscoveryWorkspaceOptions } from './useDiscoveryWorkspace'
import type { IconOccurrence } from '~/types/asset-discovery'
import { onScopeDispose, watch } from 'vue'
import { createImageDigestCache } from '~/services/asset-discovery/digest'
import { createIconThumbnail } from '~/services/asset-discovery/thumbnail'
import { readIconThumbnailCache, writeIconThumbnailCache } from '~/services/asset-discovery/thumbnail-cache'
import { loadFolderProjectCardImage } from '~/services/project/folder'
import { assertImageDimensions } from '~/utils/file-limits'

export interface DiscoveryThumbnailState { url?: string, error?: string }
interface Request {
  item: IconOccurrence
  sourceKey: string
  listeners: Set<(state: DiscoveryThumbnailState) => void>
}

/** 表示中だけ要求する。カード単位で逐次デコードし、同じ画像の要求は一度に切り出す。 */
export function useDiscoveryThumbnails(options: Pick<DiscoveryWorkspaceOptions, 'runtime' | 'store' | 'currentImageId'>) {
  const cache = new Map<string, DiscoveryThumbnailState>()
  const requests = new Map<string, Request>()
  const queued = new Set<string>()
  const digest = createImageDigestCache()
  let generation = 0
  let disposed = false
  let running = false
  let scheduled = false
  const card = (id: string) => options.store.document?.cards.find(card => card.id === id)
  const sourceKey = (item: IconOccurrence) => JSON.stringify([generation, options.runtime.projectGeneration.value, item.cardId, card(item.cardId)?.imagePath, item.imageDigest, item.imageSize.width, item.imageSize.height])
  const key = (item: IconOccurrence) => JSON.stringify([sourceKey(item), item.bounds.x, item.bounds.y, item.bounds.width, item.bounds.height])

  function releaseEntry(id: string) {
    const url = cache.get(id)?.url
    if (url)
      URL.revokeObjectURL(url)
    cache.delete(id)
  }
  function trim() {
    // 表示中のURLは破棄しない。非表示分を含む通常キャッシュは最大128枚。
    for (const id of cache.keys()) {
      if (cache.size <= 128)
        break
      if (!requests.has(id))
        releaseEntry(id)
    }
  }
  function publish(id: string, state: DiscoveryThumbnailState) {
    releaseEntry(id)
    cache.set(id, state)
    requests.get(id)?.listeners.forEach(listener => listener(state))
    trim()
  }
  async function drain() {
    scheduled = false
    if (running || disposed)
      return
    running = true
    try {
      while (queued.size) {
        if (disposed)
          break
        const first = queued.values().next().value!
        const request = requests.get(first)
        if (!request) {
          queued.delete(first)
          continue
        }
        const token = generation
        const directory = options.runtime.directory.value
        const current = () => !disposed && token === generation && directory === options.runtime.directory.value
        let bitmap: ImageBitmap | undefined
        try {
          if (typeof createImageBitmap !== 'function')
            throw new Error('この環境では候補画像を生成できません。')
          const item = request.item
          const target = card(item.cardId)
          const file = directory && target
            ? await loadFolderProjectCardImage(directory, target)
            : item.cardId === options.currentImageId.value ? options.runtime.cardSourceFile.value : null
          if (!current())
            continue
          if (!file)
            throw new Error('候補の元画像を読み込めません。')
          if (await digest.digest(file) !== item.imageDigest)
            throw new Error('検出時から元画像が変わっています。候補を確認してください。')
          if (!current())
            continue
          // 読込中に増えた同一画像の要求も、このBitmapから生成する。
          for (const id of queued) {
            if (!current())
              break
            const next = requests.get(id)
            if (!next || next.sourceKey !== request.sourceKey)
              continue
            queued.delete(id)
            try {
              const wanted = () => current() && requests.get(id) === next
              let blob = directory ? await readIconThumbnailCache(directory, next.item) : null
              if (!wanted())
                continue
              if (!blob) {
                bitmap ??= await createImageBitmap(file)
                if (!wanted())
                  continue
                assertImageDimensions(bitmap.width, bitmap.height)
                if (bitmap.width !== item.imageSize.width || bitmap.height !== item.imageSize.height)
                  throw new Error('候補と元画像の寸法が一致しません。')
                blob = await createIconThumbnail(bitmap, next.item.imageSize, next.item.bounds)
                if (!wanted())
                  continue
                // 保存できなくてもメモリ上のプレビューは使用できる。
                if (directory)
                  await writeIconThumbnailCache(directory, next.item, blob, wanted)
              }
              if (wanted())
                publish(id, { url: URL.createObjectURL(blob) })
            }
            catch (error) {
              if (current() && requests.get(id) === next)
                publish(id, { error: error instanceof Error ? error.message : '候補画像の生成に失敗しました。' })
            }
          }
        }
        catch (error) {
          if (current()) {
            for (const id of queued) {
              if (requests.get(id)?.sourceKey !== request.sourceKey)
                continue
              queued.delete(id)
              publish(id, { error: error instanceof Error ? error.message : '元画像の読込に失敗しました。' })
            }
          }
        }
        finally { bitmap?.close() }
      }
    }
    finally { running = false }
  }
  function subscribe(item: IconOccurrence, listener: (state: DiscoveryThumbnailState) => void) {
    if (disposed)
      return () => {}
    const id = key(item)
    let request = requests.get(id)
    if (!request) {
      request = { item: { ...item, bounds: { ...item.bounds }, imageSize: { ...item.imageSize } }, sourceKey: sourceKey(item), listeners: new Set() }
      requests.set(id, request)
    }
    request.listeners.add(listener)
    const existing = cache.get(id)
    if (existing?.url) {
      cache.delete(id)
      cache.set(id, existing)
      listener(existing)
    }
    else {
      listener({})
      queued.add(id)
      if (!scheduled) {
        scheduled = true
        queueMicrotask(() => void drain())
      }
    }
    return () => {
      request.listeners.delete(listener)
      if (!request.listeners.size && requests.get(id) === request) {
        requests.delete(id)
        queued.delete(id)
      }
      trim()
    }
  }
  function clear() {
    generation++
    queued.clear()
    requests.clear()
    for (const id of cache.keys()) releaseEntry(id)
    digest.clear()
  }
  watch(() => [options.runtime.projectGeneration.value, options.runtime.directory.value], clear, { flush: 'sync' })
  onScopeDispose(() => {
    disposed = true
    clear()
  })
  return { key, subscribe }
}

export type DiscoveryThumbnails = ReturnType<typeof useDiscoveryThumbnails>
