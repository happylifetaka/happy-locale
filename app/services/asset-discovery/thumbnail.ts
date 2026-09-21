import type { RegionDraft } from '~/types/editor'
import { assertImageDimensions } from '~/utils/file-limits'
import { containsBounds } from './review'

export const ICON_THUMBNAIL_MAX_SIDE = 128

export function iconThumbnailDimensions(bounds: RegionDraft) {
  const scale = Math.min(1, ICON_THUMBNAIL_MAX_SIDE / Math.max(bounds.width, bounds.height))
  return { width: Math.max(1, Math.round(bounds.width * scale)), height: Math.max(1, Math.round(bounds.height * scale)) }
}

/** 元画像から直接切り抜く表示専用PNG。原画像・登録アセットは変更しない。 */
export async function createIconThumbnail(source: CanvasImageSource, imageSize: { width: number, height: number }, bounds: RegionDraft): Promise<Blob> {
  assertImageDimensions(imageSize.width, imageSize.height)
  if (!containsBounds({ x: 0, y: 0, ...imageSize }, bounds))
    throw new Error('候補の範囲が元画像からはみ出しています。')
  const size = iconThumbnailDimensions(bounds)
  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height
  try {
    const context = canvas.getContext('2d')
    if (!context)
      throw new Error('候補のプレビューを作成できません。')
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    context.drawImage(source, bounds.x, bounds.y, bounds.width, bounds.height, 0, 0, canvas.width, canvas.height)
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('候補の画像を生成できません。')), 'image/png'))
  }
  finally {
    canvas.width = canvas.height = 1
  }
}
