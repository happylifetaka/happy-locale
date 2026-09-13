import { assertFileSize, assertImageDimensions, FILE_LIMITS } from './file-limits'

/** カード一覧用サムネイルの最大横幅。画素単位。 */
export const CARD_THUMBNAIL_MAX_WIDTH = 144
/** カード一覧用サムネイルの最大高さ。画素単位。 */
export const CARD_THUMBNAIL_MAX_HEIGHT = 180

/** 縦横比を保ち、一覧用の最大寸法に収まる縮小サイズを求める。 */
export function cardThumbnailDimensions(width: number, height: number) {
  assertImageDimensions(width, height)
  const scale = Math.min(
    CARD_THUMBNAIL_MAX_WIDTH / width,
    CARD_THUMBNAIL_MAX_HEIGHT / height,
    1,
  )
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

/** サムネイルCanvasを画像Blobへ変換する。 */
function thumbnailBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.72))
}

/** 元画像を一覧用サイズへ縮小してサムネイルを生成する。 */
export async function createCardThumbnailBlob(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
) {
  const dimensions = cardThumbnailDimensions(sourceWidth, sourceHeight)
  const canvas = document.createElement('canvas')
  canvas.width = dimensions.width
  canvas.height = dimensions.height
  const context = canvas.getContext('2d')
  if (!context)
    return null
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(source, 0, 0, canvas.width, canvas.height)
  return thumbnailBlob(canvas)
}

/** 一覧用の小画像を生成し、生成に使ったImageBitmapは成功・失敗にかかわらず解放する。 */
export async function createCardThumbnailBlobFromFile(
  file: File,
  sourceWidth: number,
  sourceHeight: number,
) {
  assertFileSize(file, FILE_LIMITS.imageBytes, '画像')
  const hasStoredDimensions = sourceWidth > 0 && sourceHeight > 0
  const dimensions = hasStoredDimensions
    ? cardThumbnailDimensions(sourceWidth, sourceHeight)
    : null
  const bitmap = dimensions
    ? await createImageBitmap(file, {
        resizeWidth: dimensions.width,
        resizeHeight: dimensions.height,
        resizeQuality: 'high',
      })
    : await createImageBitmap(file)
  try {
    return await createCardThumbnailBlob(
      bitmap,
      dimensions?.width ?? bitmap.width,
      dimensions?.height ?? bitmap.height,
    )
  }
  finally {
    bitmap.close()
  }
}
