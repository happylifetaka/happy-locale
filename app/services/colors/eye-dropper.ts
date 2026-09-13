interface EyeDropperResult {
  sRGBHex: string
}

interface EyeDropperInstance {
  open: () => Promise<EyeDropperResult>
}

type EyeDropperConstructor = new () => EyeDropperInstance

type EyeDropperWindow = Window & typeof globalThis & {
  EyeDropper?: EyeDropperConstructor
}

/** ブラウザが画面上の色を採取するAPIに対応しているか調べる。 */
export function supportsEyeDropper() {
  return typeof window !== 'undefined' && 'EyeDropper' in window
}

/** ブラウザのスポイトを呼び出す。ユーザーのキャンセルはエラー表示せずnullとして返す。 */
export async function pickScreenColor(): Promise<string | null> {
  const EyeDropper = (window as EyeDropperWindow).EyeDropper
  if (!EyeDropper)
    throw new Error('このChromeではスポイト機能を使用できません。')
  try {
    const result = await new EyeDropper().open()
    return result.sRGBHex
  }
  catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError')
      return null
    throw error
  }
}
