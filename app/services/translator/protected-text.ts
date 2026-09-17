/** 翻訳中のタグ破損は候補として適用できないため、推測で補わず停止する。 */
export class TranslationTokenError extends Error {
  constructor() {
    super('アセットタグを正しく復元できませんでした。原文のタグを確認し、再試行または手動で翻訳してください。')
    this.name = 'TranslationTokenError'
  }
}

const iconPattern = /\[icon:[^[\]\r\n]+\]/gu

/** 原文と衝突しない識別子で出現ごとのタグを退避する。語順変更は許す。 */
export function protectTranslationText(source: string) {
  if (/\[\s*icon\b/iu.test(source.replace(iconPattern, '')))
    throw new TranslationTokenError()
  let prefix = 'zxqicon'
  while (source.toLowerCase().includes(prefix))
    prefix = `zxq${prefix}`
  const tokens: string[] = []
  const text = source.replace(iconPattern, (token) => {
    tokens.push(token)
    return `${prefix}${tokens.length}qxz`
  })
  return {
    text,
    restore(translated: string): string {
      // 識別子に退避したはずのタグが生成された場合も拒否する。
      if (/\[\s*icon\b/iu.test(translated))
        throw new TranslationTokenError()
      let restored = translated
      for (const [index, token] of tokens.entries()) {
        const pattern = new RegExp(`(?<![a-z0-9])${prefix}${index + 1}qxz(?![a-z0-9])`, 'giu')
        if ([...restored.matchAll(pattern)].length !== 1)
          throw new TranslationTokenError()
        // $を含むアセット名も置換構文として解釈しない。
        restored = restored.replace(pattern, () => token)
      }
      if (tokens.length && restored.toLowerCase().includes(prefix))
        throw new TranslationTokenError()
      return restored
    },
  }
}
