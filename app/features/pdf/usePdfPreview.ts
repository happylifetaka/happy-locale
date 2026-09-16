import type { Ref } from 'vue'
import { onScopeDispose, ref, shallowReadonly, shallowRef, watch } from 'vue'

/** PDFページ画像の採用と寿命を管理する。描画自体の中断はrender側の契約に従う。 */
export function usePdfPreview(
  source: Ref<File | null>,
  render: (file: File, page: number) => Promise<Blob>,
) {
  const pageNumber = ref(1)
  const image = shallowRef<HTMLImageElement | null>(null)
  const loading = ref(false)
  const error = shallowRef<unknown>(null)
  let currentUrl: string | null = null
  let request = 0
  let disposed = false
  let cancelImage: (() => void) | undefined

  function releaseCurrent() {
    if (currentUrl)
      URL.revokeObjectURL(currentUrl)
    image.value?.removeAttribute('src')
    currentUrl = null
    image.value = null
  }

  function reset() {
    request += 1
    cancelImage?.()
    releaseCurrent()
    pageNumber.value = 1
    loading.value = false
    error.value = null
  }

  watch(source, reset, { flush: 'sync' })
  onScopeDispose(() => {
    disposed = true
    reset()
  })

  /** 採用できた場合だけtrueを返し、画面側の選択・モード更新につなぐ。 */
  async function load(nextPage: number): Promise<boolean> {
    const file = source.value
    if (!file || disposed)
      return false
    const generation = ++request
    cancelImage?.()
    loading.value = true
    error.value = null
    const isCurrent = () => !disposed && generation === request
    let nextUrl: string | null = null
    let nextImage: HTMLImageElement | null = null
    let cancel: (() => void) | undefined
    try {
      const blob = await render(file, nextPage)
      if (!isCurrent())
        return false
      nextUrl = URL.createObjectURL(blob)
      nextImage = new Image()
      const target = nextImage
      const url = nextUrl
      const loaded = await new Promise<boolean>((resolve, reject) => {
        cancel = () => {
          target.onload = null
          target.onerror = null
          target.removeAttribute('src')
          if (nextUrl) {
            URL.revokeObjectURL(nextUrl)
            nextUrl = null
          }
          resolve(false)
        }
        cancelImage = cancel
        target.onload = () => resolve(true)
        target.onerror = () => reject(new Error('PDFプレビュー画像を読み込めませんでした。'))
        target.src = url
      })
      if (!loaded || !isCurrent())
        return false
      releaseCurrent()
      currentUrl = nextUrl
      nextUrl = null
      image.value = target
      pageNumber.value = nextPage
      return true
    }
    catch (cause) {
      if (isCurrent())
        error.value = cause
      return false
    }
    finally {
      if (nextImage) {
        nextImage.onload = null
        nextImage.onerror = null
      }
      if (nextUrl) {
        URL.revokeObjectURL(nextUrl)
        nextImage?.removeAttribute('src')
      }
      if (cancelImage === cancel)
        cancelImage = undefined
      if (isCurrent())
        loading.value = false
    }
  }

  return {
    pageNumber: shallowReadonly(pageNumber),
    image: shallowReadonly(image),
    loading: shallowReadonly(loading),
    error: shallowReadonly(error),
    load,
  }
}
