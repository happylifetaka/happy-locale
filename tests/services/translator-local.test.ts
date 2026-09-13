import { describe, expect, it, vi } from 'vitest'
import {
  LocalTranslationProvider,
  translationErrorMessage,
  TranslationProviderError,
} from '../../app/services/translator/local'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('local translation provider', () => {
  it('sends the expected translation request and returns translatedText', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ translatedText: 'カードを2枚引く。' }),
    )
    const provider = new LocalTranslationProvider(
      'http://localhost:4578',
      fetcher,
    )

    await expect(provider.translate('Draw two cards.', 'EN', 'JA')).resolves.toBe(
      'カードを2枚引く。',
    )
    expect(fetcher).toHaveBeenCalledWith(
      'http://localhost:4578/translate',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: 'Draw two cards.',
          source: 'EN',
          target: 'JA',
        }),
        redirect: 'error',
      },
    )
  })

  it('rejects redirects for health checks with a distinct error', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(
      new TypeError('fetch failed because of redirect'),
    )
    const provider = new LocalTranslationProvider(
      'http://localhost:4578',
      fetcher,
    )

    await expect(provider.checkHealth()).rejects.toMatchObject({
      kind: 'redirect',
    })
    expect(fetcher).toHaveBeenCalledWith(
      'http://localhost:4578/health',
      expect.objectContaining({ redirect: 'error' }),
    )
  })

  it('uses the configured endpoint without a duplicate slash', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ translatedText: '訳文' }),
    )
    const provider = new LocalTranslationProvider(
      'http://127.0.0.1:9000/api/',
      fetcher,
    )

    await provider.translate('Source', 'EN', 'JA')

    expect(fetcher).toHaveBeenCalledWith(
      'http://127.0.0.1:9000/api/translate',
      expect.any(Object),
    )
  })

  it('turns an HTTP error into a typed provider error', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ error: 'unavailable' }, 503),
    )
    const provider = new LocalTranslationProvider(
      'http://localhost:4578',
      fetcher,
    )

    const request = provider.translate('Source', 'EN', 'JA')

    await expect(request).rejects.toMatchObject({
      name: 'TranslationProviderError',
      kind: 'http',
    })
  })

  it('accepts a successful health response', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ status: 'ok', provider: 'deepl' }),
    )
    const provider = new LocalTranslationProvider(
      'http://localhost:4578',
      fetcher,
    )

    await expect(provider.checkHealth()).resolves.toEqual({
      status: 'ok',
      provider: 'deepl',
    })
    expect(fetcher).toHaveBeenCalledWith(
      'http://localhost:4578/health',
      { method: 'GET', redirect: 'error' },
    )
  })

  it('invokes fetch with the global object as its receiver', async () => {
    const fetcher = vi.fn(function (this: typeof globalThis) {
      if (this !== globalThis)
        throw new TypeError('Illegal invocation')
      return Promise.resolve(jsonResponse({ status: 'ok' }))
    }) as unknown as typeof fetch
    const provider = new LocalTranslationProvider(
      'http://localhost:4578',
      fetcher,
    )

    await expect(provider.checkHealth()).resolves.toEqual({ status: 'ok' })
  })

  it('reports a connection failure with a user-facing message', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(
      new TypeError('fetch failed'),
    )
    const provider = new LocalTranslationProvider(
      'http://localhost:4578',
      fetcher,
    )

    const error = await provider.checkHealth().catch(value => value)

    expect(error).toBeInstanceOf(TranslationProviderError)
    if (!(error instanceof TranslationProviderError))
      throw new TypeError('Expected TranslationProviderError')
    expect(error).toMatchObject({
      kind: 'connection',
    })
    expect(translationErrorMessage(error)).toBe(
      'Translation Endpointに接続できません。\n接続先が起動しているか、Endpointを確認してください。',
    )
  })

  it('rejects responses without translatedText', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({}))
    const provider = new LocalTranslationProvider(
      'http://localhost:4578',
      fetcher,
    )

    await expect(provider.translate('Source', 'EN', 'JA')).rejects.toMatchObject({
      kind: 'invalid-response',
    })
  })

  it('does not allow credentials in the endpoint URL', () => {
    expect(
      () => new LocalTranslationProvider('http://user:secret@localhost:4578'),
    ).toThrow(/認証情報/u)
  })

  it('does not allow query strings or fragments in the endpoint URL', () => {
    expect(
      () => new LocalTranslationProvider('http://localhost:4578?token=x'),
    ).toThrow(/query/u)
    expect(
      () => new LocalTranslationProvider('http://localhost:4578/#settings'),
    ).toThrow(/fragment/u)
  })
})
