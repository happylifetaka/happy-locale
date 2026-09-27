import type { DetectRegionsOptions, RegionDetectionResult } from './detect-regions'
import { assertFileSize, assertImageDimensions, FILE_LIMITS } from '~/utils/file-limits'
import { detectRegions } from './detect-regions'

export type DetectFileRegionsOptions = Omit<DetectRegionsOptions, 'image'> & { file: File }

/** ハッシュ確認した同じ不変Fileを渡す。Storeは変更せず、Bitmapだけを所有する。Providerは呼出元が所有する。 */
export async function detectFileRegions({ file, ...options }: DetectFileRegionsOptions): Promise<RegionDetectionResult | null> {
  const { isCurrent, imageWidth, imageHeight } = options
  let bitmap: ImageBitmap | undefined
  try {
    if (!isCurrent())
      return null
    assertFileSize(file, FILE_LIMITS.imageBytes, '領域検出元画像')
    assertImageDimensions(imageWidth, imageHeight)
    if (typeof globalThis.createImageBitmap !== 'function')
      throw new Error('この環境では元画像を読み込んで再検出できません。対応ブラウザで開いてください。')
    bitmap = await createImageBitmap(file)
    if (!isCurrent())
      return null
    assertImageDimensions(bitmap.width, bitmap.height)
    if (bitmap.width !== imageWidth || bitmap.height !== imageHeight)
      throw new Error('元画像の寸法が変わりました。カードを開き直してから再検出してください。')
    const result = await detectRegions({
      ...options,
      image: bitmap,
      onProgress: (progress) => {
        if (isCurrent())
          options.onProgress?.(progress)
      },
      onRefinement: () => {
        if (isCurrent())
          options.onRefinement?.()
      },
      onEnhancementError: (error) => {
        if (isCurrent())
          options.onEnhancementError?.(error)
      },
    })
    return isCurrent() ? result : null
  }
  catch (error) {
    if (!isCurrent())
      return null
    throw error
  }
  finally {
    bitmap?.close()
  }
}
