import type { Ref } from 'vue'
import type { useCardEditor } from '~/composables/useCardEditor'
import type { BrowserTranslationOptions } from '~/services/translator/browser'
import type { TranslationSettings } from '~/services/translator/types'
import { onBeforeUnmount, ref, shallowRef } from 'vue'
import { browserTranslationError, BrowserTranslationProvider } from '~/services/translator/browser'
import { LocalTranslationProvider, translationErrorMessage } from '~/services/translator/local'
import { SampleTranslationProvider } from '~/services/translator/sample'
import { statusForTranslation } from '~/utils/translation-status'

interface EditorTranslationOptions {
  editor: Pick<ReturnType<typeof useCardEditor>, 'project' | 'selectedRegion' | 'updateRegion'>
  currentImageId: Ref<string>
  isDemo: Ref<boolean>
  translationEndpointEnabled: boolean
  translationSettings: Ref<TranslationSettings>
  setMessage: (message: string) => void
  logDiagnostic: (message: string, details?: unknown, level?: 'info' | 'error') => void
}

/** 送信確認から候補の検証・確定までを管理し、履歴への反映はeditorへ委ねる。 */
export function useEditorTranslation({
  editor,
  currentImageId,
  isDemo,
  translationEndpointEnabled,
  translationSettings,
  setMessage,
  logDiagnostic,
}: EditorTranslationOptions) {
  /** 翻訳候補の取得処理中か。 */
  const translationRunning = ref(false)
  const browserProgress = ref('')
  let browserController: AbortController | null = null
  function cancelBrowserTranslation() {
    browserController?.abort()
  }
  onBeforeUnmount(cancelBrowserTranslation)
  async function browserTranslate(text: string, options: BrowserTranslationOptions = {}) {
    try {
      return await new BrowserTranslationProvider().translate(text, 'en', 'ja', options)
    }
    catch (error) {
      if (options.signal?.aborted)
        throw error
      throw new Error(browserTranslationError(error))
    }
  }
  /** 送信確認に表示する原文・接続先・対象領域。 */
  const translationRequest = shallowRef<{
    cardId: string
    regionId: string
    originalText: string
    endpoint: string
  } | null>(null)
  /** 反映前の翻訳候補と、取得時の原文・訳文の比較基準。 */
  const translationPreview = shallowRef<{
    cardId: string
    regionId: string
    originalText: string
    currentTranslation: string
    proposedTranslation: string
  } | null>(null)
  /** サンプル原文に対応する固定の日本語訳を取得する。 */
  function sampleTranslate(text: string) {
    if (!isDemo.value)
      throw new Error('サンプル翻訳はデモでのみ使用できます。')
    return new SampleTranslationProvider().translate(text, 'EN', 'JA')
  }

  /** 選択領域の翻訳候補を取得するか、外部送信の確認を開く。 */
  async function translateSelectedRegion() {
    const region = editor.selectedRegion.value
    if (
      !region
      || (!isDemo.value
        && translationSettings.value.provider !== 'browser'
        && (!translationEndpointEnabled || translationSettings.value.provider !== 'local'))
      || translationRunning.value
    ) {
      return
    }
    if (isDemo.value || translationSettings.value.provider === 'browser') {
      const cardId = currentImageId.value
      const originalText = region.originalText
      const currentTranslation = region.translatedText
      translationRunning.value = true
      try {
        browserController = new AbortController()
        const proposedTranslation = isDemo.value
          ? await sampleTranslate(originalText)
          : await browserTranslate(originalText, { signal: browserController.signal, onProgress: message => browserProgress.value = message })
        const current = editor.project.value.regions.find(item => item.id === region.id)
        if (cardId !== currentImageId.value || !current || current.originalText !== originalText || current.translatedText !== currentTranslation) {
          setMessage('対象が変更されたため、翻訳候補を破棄しました。')
          return
        }
        translationPreview.value = { cardId, regionId: region.id, originalText, currentTranslation, proposedTranslation }
      }
      catch (error) {
        setMessage(browserTranslationError(error))
      }
      finally {
        translationRunning.value = false
        browserController = null
        browserProgress.value = ''
      }
      return
    }
    translationRequest.value = {
      cardId: currentImageId.value,
      regionId: region.id,
      originalText: region.originalText,
      endpoint: translationSettings.value.endpoint,
    }
  }

  /** 確認済みの送信先と原文を使う。取得結果は直接保存せず、カードに紐づく候補として提示する。 */
  async function sendTranslationRequest() {
    const request = translationRequest.value
    if (!request || translationRunning.value)
      return
    translationRequest.value = null
    translationRunning.value = true
    try {
      const translatedText = await new LocalTranslationProvider(
        request.endpoint,
      ).translate(request.originalText, 'EN', 'JA')
      if (currentImageId.value !== request.cardId) {
        setMessage('カードが切り替わったため、翻訳候補を破棄しました。')
        return
      }
      const currentRegion = editor.project.value.regions.find(
        item => item.id === request.regionId,
      )
      if (!currentRegion) {
        setMessage('対象の翻訳領域が見つかりません。')
        return
      }
      translationPreview.value = {
        cardId: request.cardId,
        regionId: currentRegion.id,
        originalText: request.originalText,
        currentTranslation: currentRegion.translatedText,
        proposedTranslation: translatedText,
      }
      setMessage('翻訳候補を取得しました。反映前に内容を確認してください。')
    }
    catch (error) {
      logDiagnostic('ローカル翻訳に失敗しました', error, 'error')
      setMessage(translationErrorMessage(error))
    }
    finally {
      translationRunning.value = false
    }
  }

  /** 候補取得後のカード切り替えや本文変更を検出し、古い候補で最新の編集を上書きしない。 */
  function applyTranslationPreview() {
    const preview = translationPreview.value
    if (!preview)
      return
    const region = editor.project.value.regions.find(
      item => item.id === preview.regionId,
    )
    if (!region || preview.cardId !== currentImageId.value
      || region.originalText !== preview.originalText || region.translatedText !== preview.currentTranslation) {
      translationPreview.value = null
      setMessage('対象が変更されたため、翻訳候補を反映しませんでした。候補を取得し直してください。')
      return
    }
    editor.updateRegion(region.id, {
      translatedText: preview.proposedTranslation,
      translationStatus: statusForTranslation(preview.proposedTranslation),
    })
    translationPreview.value = null
    setMessage('翻訳候補を日本語訳へ反映しました。')
  }

  /** 取得した翻訳候補を反映せず破棄する。 */
  function discardTranslationPreview() {
    translationPreview.value = null
    setMessage('翻訳候補を破棄しました。')
  }

  return {
    translationRunning,
    browserProgress,
    cancelBrowserTranslation,
    browserTranslate,
    translationRequest,
    translationPreview,
    sampleTranslate,
    translateSelectedRegion,
    sendTranslationRequest,
    applyTranslationPreview,
    discardTranslationPreview,
  }
}
