import { assertImageDimensions } from '~/utils/file-limits'

/** 画像の読み込み途中で失敗した場合も、それまでに作ったビットマップを解放する。 */
export async function loadProjectAssetImages(files: ReadonlyMap<string, File>) {
  const images = new Map<string, ImageBitmap>()
  try {
    for (const [id, file] of files) {
      const image = await createImageBitmap(file)
      images.set(id, image)
      assertImageDimensions(image.width, image.height, 'アセット画像')
    }
    return images
  }
  catch (error) {
    images.forEach(image => image.close())
    throw error
  }
}
