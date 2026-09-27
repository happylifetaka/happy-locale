import { assertFileSize, FILE_LIMITS } from '~/utils/file-limits'

/** 同じ不変Blobの同時計算を共有する。ファイル名・更新日時ではなく実バイトを照合する。 */
export function createImageDigestCache() {
  let cache = new WeakMap<Blob, Promise<string>>()

  function digest(blob: Blob): Promise<string> {
    const existing = cache.get(blob)
    if (existing)
      return existing
    const currentCache = cache
    const computing = (async () => {
      assertFileSize(blob, FILE_LIMITS.imageBytes, '照合する画像')
      const subtle = globalThis.crypto?.subtle
      if (!subtle)
        throw new Error('この環境では画像の同一性を確認できません。HTTPSまたはlocalhostで開いてください。')
      const bytes = await blob.arrayBuffer()
      const result = await subtle.digest('SHA-256', bytes)
      return Array.from(new Uint8Array(result), byte => byte.toString(16).padStart(2, '0')).join('')
    })()
    currentCache.set(blob, computing)
    // 失敗はキャッシュしない。再試行の余地を残し、破棄後の新キャッシュには触れない。
    void computing.catch(() => currentCache.delete(blob))
    return computing
  }

  function clear() {
    cache = new WeakMap()
  }
  return { digest, clear }
}
