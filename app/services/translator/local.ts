import type {
  TranslationProvider,
  TranslationServerHealth,
} from './types'

type Fetch = typeof globalThis.fetch

export type TranslationErrorKind
  = | 'connection'
    | 'http'
    | 'invalid-endpoint'
    | 'invalid-response'
    | 'redirect'

export class TranslationProviderError extends Error {
  constructor(
    public readonly kind: TranslationErrorKind,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'TranslationProviderError'
  }
}

/** 認証情報・クエリ等を含む接続先を拒否し、APIパスを連結できるHTTP URLに限定する。 */
function normalizeEndpoint(endpoint: string): string {
  const value = endpoint.trim().replace(/\/+$/u, '')
  let url: URL
  try {
    url = new URL(value)
  }
  catch (cause) {
    throw new TranslationProviderError(
      'invalid-endpoint',
      '翻訳サーバーのEndpointが正しくありません。',
      { cause },
    )
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new TranslationProviderError(
      'invalid-endpoint',
      '翻訳サーバーのEndpointには認証情報を含まないHTTP URLを指定してください。',
    )
  }
  if (url.search || url.hash) {
    throw new TranslationProviderError(
      'invalid-endpoint',
      '翻訳サーバーのEndpointにqueryまたはfragmentは指定できません。',
    )
  }
  return value
}

/** 値がnull以外のオブジェクトとして扱えるか判定する。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** 翻訳接続の失敗種別を画面用の説明へ変換する。 */
export function translationErrorMessage(error: unknown): string {
  if (error instanceof TranslationProviderError) {
    if (error.kind === 'invalid-endpoint')
      return error.message
    if (error.kind === 'connection') {
      return 'Translation Endpointに接続できません。\n接続先が起動しているか、Endpointを確認してください。'
    }
    if (error.kind === 'redirect')
      return 'Translation Endpointのリダイレクトを拒否しました。\n画面に表示されたEndpointを確認してください。'
  }
  return '翻訳サーバーから正常な応答を受け取れませんでした。\nサーバーの状態とEndpointを確認してください。'
}

export class LocalTranslationProvider implements TranslationProvider {
  private readonly endpoint: string

  constructor(endpoint: string, private readonly fetcher: Fetch = globalThis.fetch) {
    this.endpoint = normalizeEndpoint(endpoint)
  }

  /** 原文と言語を接続先へ送り、応答のtranslatedTextが文字列であることを確認して返す。 */
  async translate(
    text: string,
    sourceLang: string,
    targetLang: string,
  ): Promise<string> {
    const response = await this.request('/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        source: sourceLang,
        target: targetLang,
      }),
    })
    const body: unknown = await this.readJson(response)
    if (!isRecord(body) || typeof body.translatedText !== 'string') {
      throw new TranslationProviderError(
        'invalid-response',
        'Translation response does not contain translatedText.',
      )
    }
    return body.translatedText
  }

  /** 設定した接続先のヘルスチェック応答を検証する。 */
  async checkHealth(): Promise<TranslationServerHealth> {
    const response = await this.request('/health', { method: 'GET' })
    const body: unknown = await this.readJson(response)
    if (
      !isRecord(body)
      || body.status !== 'ok'
      || (body.provider !== undefined && typeof body.provider !== 'string')
    ) {
      throw new TranslationProviderError(
        'invalid-response',
        'Health response is invalid.',
      )
    }
    return {
      status: 'ok',
      ...(body.provider ? { provider: body.provider } : {}),
    }
  }

  /** 原文の送信先が変わらないようリダイレクトを拒否し、通信エラーを表示用の分類へ変換する。 */
  private async request(path: string, init: RequestInit): Promise<Response> {
    let response: Response
    try {
      response = await this.fetcher.call(
        globalThis,
        `${this.endpoint}${path}`,
        { ...init, redirect: 'error' },
      )
    }
    catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      throw new TranslationProviderError(
        /redirect/iu.test(message) ? 'redirect' : 'connection',
        /redirect/iu.test(message)
          ? 'Translation server redirects are not allowed.'
          : 'Could not connect to the translation server.',
        { cause },
      )
    }
    if (!response.ok) {
      throw new TranslationProviderError(
        'http',
        `Translation server returned HTTP ${response.status}.`,
      )
    }
    return response
  }

  /** 翻訳サーバーの応答をJSONとして読み、不正な応答を分類する。 */
  private async readJson(response: Response): Promise<unknown> {
    try {
      return await response.json()
    }
    catch (cause) {
      throw new TranslationProviderError(
        'invalid-response',
        'Translation server returned invalid JSON.',
        { cause },
      )
    }
  }
}
