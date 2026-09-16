import type { RuntimeLoadedImage } from '~/composables/useProjectRuntime'
import { assertFileSize, assertImageDimensions, FILE_LIMITS } from '~/utils/file-limits'

interface EditorImageLoadingOptions {
  isActive: () => boolean
  setMessage: (message: string) => void
  logDiagnostic: (message: string, details?: unknown, level?: 'info' | 'error') => void
}

/** 読込中は画像とURLを所有し、成功時だけ呼出元へ所有を渡す。終了状態はエディターと共有する。 */
export function useEditorImageLoading({ isActive, setMessage, logDiagnostic }: EditorImageLoadingOptions) {
  /** 取り込み対象として扱える画像形式か確認する。 */
  function isImageFile(file: File) {
    return (
      ['image/png', 'image/jpeg'].includes(file.type)
      || /\.(?:png|jpe?g)$/iu.test(file.name)
    )
  }

  /** 画像の形式・容量・寸法を確認し、表示用要素とURLを用意する。採用後の解放はruntimeが担う。 */
  async function loadImage(file: File): Promise<RuntimeLoadedImage | null> {
    if (!isActive())
      return null
    logDiagnostic('画像ファイルを受け取りました', {
      type: file.type || '(未設定)',
      size: file.size,
      extension: file.name.match(/\.[^.]+$/u)?.[0]?.toLowerCase() ?? '(なし)',
    })
    if (!isImageFile(file)) {
      logDiagnostic('画像形式を判定できませんでした', undefined, 'error')
      setMessage('PNGまたはJPEG画像を選択してください。')
      return null
    }
    try {
      assertFileSize(file, FILE_LIMITS.imageBytes, '画像')
    }
    catch (error) {
      logDiagnostic('画像ファイルの上限を超えています', error, 'error')
      setMessage(error instanceof Error ? error.message : '画像が大きすぎます。')
      return null
    }
    const url = URL.createObjectURL(file)
    logDiagnostic('画像用Object URLを作成しました')
    const loadedImage = new Image()
    loadedImage.decoding = 'async'
    try {
      await new Promise<void>((resolve, reject) => {
        loadedImage.onload = () => resolve()
        loadedImage.onerror = () =>
          reject(new Error('画像のloadイベントが失敗しました。'))
        loadedImage.src = url
      })
      if (!isActive()) {
        URL.revokeObjectURL(url)
        loadedImage.removeAttribute('src')
        return null
      }
      assertImageDimensions(loadedImage.naturalWidth, loadedImage.naturalHeight)
      try {
        await loadedImage.decode()
        if (!isActive()) {
          URL.revokeObjectURL(url)
          loadedImage.removeAttribute('src')
          return null
        }
        logDiagnostic('画像のデコードが完了しました')
      }
      catch (error) {
        if (!isActive()) {
          URL.revokeObjectURL(url)
          loadedImage.removeAttribute('src')
          return null
        }
        // loadイベントが成功していれば画像は利用できるため、decode固有の失敗は継続する。
        logDiagnostic('decode()は失敗しましたがload済み画像を使用します', error)
      }
    }
    catch (error) {
      URL.revokeObjectURL(url)
      loadedImage.removeAttribute('src')
      if (!isActive())
        return null
      logDiagnostic('画像を読み込めませんでした', error, 'error')
      setMessage(
        error instanceof Error ? error.message : '画像を読み込めませんでした。',
      )
      return null
    }
    logDiagnostic('画像の読み込み準備が完了しました', {
      width: loadedImage.naturalWidth,
      height: loadedImage.naturalHeight,
    })
    return { element: loadedImage, file, url }
  }

  return { loadImage }
}
