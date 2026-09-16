import type { TranslationProvider } from './types'
import { protectTranslationText } from './protected-text'

export type BrowserTranslationAvailability = 'unsupported' | 'unavailable' | 'downloadable' | 'downloading' | 'available'
export interface BrowserTranslationOptions {
  signal?: AbortSignal
  onProgress?: (message: string) => void
}
interface BrowserTranslator {
  translate: (text: string, options: { signal?: AbortSignal }) => Promise<string>
  destroy: () => void
}
export interface BrowserTranslatorAPI {
  availability: (options: { sourceLanguage: string, targetLanguage: string }) => Promise<Exclude<BrowserTranslationAvailability, 'unsupported'>>
  create: (options: {
    sourceLanguage: string
    targetLanguage: string
    signal?: AbortSignal
    monitor: (monitor: { addEventListener: (type: 'downloadprogress', callback: (event: { loaded: number }) => void) => void }) => void
  }) => Promise<BrowserTranslator>
}

/** SSR・非対応ブラウザではAPIに触れず、外部サービスへ代替送信もしない。 */
function browserAPI(): BrowserTranslatorAPI | undefined {
  return (globalThis as typeof globalThis & { Translator?: BrowserTranslatorAPI }).Translator
}

export async function browserTranslationAvailability(): Promise<BrowserTranslationAvailability> {
  return await browserAPI()?.availability({ sourceLanguage: 'en', targetLanguage: 'ja' }) ?? 'unsupported'
}

export function browserTranslationError(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'AbortError')
      return '翻訳を中止しました。'
    if (error.name === 'NotAllowedError')
      return '翻訳ボタンをもう一度押してください。ブラウザの権限設定も確認してください。'
    if (error.name === 'NotSupportedError')
      return '英日翻訳モデルを準備できませんでした。Chromeの対応状況や通信を確認して再試行してください。'
    if (error.name === 'QuotaExceededError')
      return '原文が長すぎます。領域を分割して再試行してください。'
    return error.message
  }
  return 'ブラウザ内翻訳に失敗しました。再試行してください。'
}

/** 操作ごとのモデルを確実に解放し、キャンセル後の出力を適用しない。 */
export class BrowserTranslationProvider implements TranslationProvider {
  async translate(text: string, sourceLang: string, targetLang: string, options: BrowserTranslationOptions = {}): Promise<string> {
    options.signal?.throwIfAborted()
    const api = browserAPI()
    if (!api)
      throw new Error('このブラウザはブラウザ内翻訳に対応していません。デスクトップ版Chrome、または手動翻訳をご利用ください。')
    if (!text.trim())
      throw new Error('翻訳する原文を入力してください。')
    const protectedText = protectTranslationText(text)
    let translator: BrowserTranslator | undefined
    try {
      options.onProgress?.('翻訳モデルを準備しています…')
      // 初回createは利用者操作の直後に呼び、先行する非同期処理でactivationを失わない。
      translator = await api.create({
        sourceLanguage: sourceLang.toLowerCase(),
        targetLanguage: targetLang.toLowerCase(),
        signal: options.signal,
        monitor(monitor) {
          monitor.addEventListener('downloadprogress', ({ loaded }) => {
            if (!options.signal?.aborted && Number.isFinite(loaded))
              options.onProgress?.(`翻訳モデルを取得中…${Math.round(Math.max(0, Math.min(1, loaded)) * 100)}%`)
          })
        },
      })
      options.signal?.throwIfAborted()
      options.onProgress?.('翻訳候補を作成しています…')
      const translated = await translator.translate(protectedText.text, { signal: options.signal })
      options.signal?.throwIfAborted()
      if (!translated.trim())
        throw new Error('翻訳結果が空でした。再試行または手動で翻訳してください。')
      return protectedText.restore(translated)
    }
    finally {
      translator?.destroy()
    }
  }
}
