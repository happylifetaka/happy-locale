import type { IconOccurrence } from '~/types/asset-discovery'
import { containsBounds } from './review'
import { ICON_THUMBNAIL_MAX_SIDE, iconThumbnailDimensions } from './thumbnail'

type ThumbnailIdentity = Pick<IconOccurrence, 'imageDigest' | 'imageSize' | 'bounds'>
const maximumBytes = 256 * 1024

/** パスには内部生成のハッシュだけを使う。カード名・アセット名は使わない。 */
export async function iconThumbnailCacheName(item: ThumbnailIdentity) {
  if (!/^[a-f0-9]{64}$/u.test(item.imageDigest) || !containsBounds({ x: 0, y: 0, ...item.imageSize }, item.bounds))
    throw new Error('候補画像のキャッシュ識別情報が不正です。')
  const { x, y, width, height } = item.bounds
  const identity = JSON.stringify(['icon-thumbnail-v1', ICON_THUMBNAIL_MAX_SIDE, item.imageDigest, item.imageSize.width, item.imageSize.height, x, y, width, height])
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity))
  return `${Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')}.png`
}

/** 任意の削除可能キャッシュ。欠損・破損・非対応は生成へフォールバックする。 */
export async function readIconThumbnailCache(directory: FileSystemDirectoryHandle, item: ThumbnailIdentity): Promise<Blob | null> {
  let bitmap: ImageBitmap | undefined
  try {
    const name = await iconThumbnailCacheName(item)
    const temp = await directory.getDirectoryHandle('temp')
    const cache = await temp.getDirectoryHandle('asset-thumbnails')
    const file = await (await cache.getFileHandle(name)).getFile()
    if (file.size < 24 || file.size > maximumBytes)
      return null
    // File-backed URLは再書込で失効するため、小さなPNGだけバイトを所有する。
    const bytes = await file.arrayBuffer()
    const signature = new Uint8Array(bytes, 0, 8)
    if (![137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => signature[index] === byte))
      return null
    const expected = iconThumbnailDimensions(item.bounds)
    const header = new DataView(bytes)
    if (header.getUint32(12) !== 0x49484452 || header.getUint32(16) !== expected.width || header.getUint32(20) !== expected.height)
      return null
    const blob = new Blob([bytes], { type: 'image/png' })
    bitmap = await createImageBitmap(blob)
    return bitmap.width === expected.width && bitmap.height === expected.height ? blob : null
  }
  catch { return null }
  finally { bitmap?.close() }
}

/** キャッシュ書込失敗は編集・保存成功判定に影響させない。暗黙の権限要求もしない。 */
export async function writeIconThumbnailCache(directory: FileSystemDirectoryHandle, item: ThumbnailIdentity, blob: Blob, isCurrent: () => boolean): Promise<boolean> {
  let writer: FileSystemWritableFileStream | undefined
  try {
    if (blob.type !== 'image/png' || blob.size > maximumBytes || !isCurrent())
      return false
    const permissions = directory as FileSystemDirectoryHandle & { queryPermission?: (descriptor: { mode: 'readwrite' }) => Promise<PermissionState> }
    if (permissions.queryPermission && await permissions.queryPermission({ mode: 'readwrite' }) !== 'granted')
      return false
    const name = await iconThumbnailCacheName(item)
    if (!isCurrent())
      return false
    const temp = await directory.getDirectoryHandle('temp', { create: true })
    if (!isCurrent())
      return false
    const cache = await temp.getDirectoryHandle('asset-thumbnails', { create: true })
    if (!isCurrent())
      return false
    const handle = await cache.getFileHandle(name, { create: true })
    if (!isCurrent())
      return false
    writer = await handle.createWritable()
    if (isCurrent())
      await writer.write(blob)
    if (!isCurrent()) {
      await writer.abort()
      return false
    }
    await writer.close()
    return true
  }
  catch {
    await writer?.abort().catch(() => {})
    return false
  }
}
