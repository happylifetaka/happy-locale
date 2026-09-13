import type { FontReference } from '~/types/editor'
import { assertFileSize, FILE_LIMITS } from '~/utils/file-limits'

export interface LocalFontData {
  postscriptName: string
  fullName: string
  family: string
  style: string
  blob: () => Promise<Blob>
}

type LocalFontWindow = Window & typeof globalThis & {
  queryLocalFonts?: (options?: {
    postscriptNames?: string[]
  }) => Promise<LocalFontData[]>
}

/** ブラウザがOSフォントの列挙APIに対応しているか調べる。 */
export function supportsLocalFonts() {
  return typeof window !== 'undefined' && 'queryLocalFonts' in window
}

/** フォント名の重複比較に使う表記へ揃える。 */
function normalizedFontName(value: string) {
  return value.trim().toLocaleLowerCase()
}

/** 同じローカルフォントが複数返る環境でも、選択候補を重複表示しないよう整理する。 */
export function deduplicateLocalFonts(fonts: LocalFontData[]) {
  const postscriptNames = new Set<string>()
  const displayNames = new Set<string>()
  return fonts.filter((font) => {
    const postscriptName = normalizedFontName(font.postscriptName)
    const displayName = [font.fullName, font.family, font.style]
      .map(normalizedFontName)
      .join('\0')
    if (postscriptNames.has(postscriptName) || displayNames.has(displayName))
      return false
    postscriptNames.add(postscriptName)
    displayNames.add(displayName)
    return true
  })
}

/** ユーザーの許可を通してOSフォント一覧を取得する。 */
export async function queryLocalFonts(): Promise<LocalFontData[]> {
  const query = (window as LocalFontWindow).queryLocalFonts
  if (!query)
    throw new Error('このChromeではPCフォントの取得に対応していません。')
  return deduplicateLocalFonts(await query.call(window))
}

/** ユーザーが選んだOSフォントをアプリ専用のfamily名で読み込み、編集用の参照を作る。 */
export async function loadLocalFont(
  font: LocalFontData,
  existing?: FontReference,
): Promise<{ reference: FontReference, face: FontFace, blob: Blob }> {
  if (existing?.postscriptName && existing.postscriptName !== font.postscriptName) {
    throw new Error(`「${existing.displayName}」を選択してください。`)
  }
  const id = existing?.id ?? crypto.randomUUID()
  const familyName
    = existing?.familyName ?? `HappyLocaleSystemFont_${id.replaceAll('-', '_')}`
  const blob = await font.blob()
  assertFileSize(blob, FILE_LIMITS.fontBytes, 'フォント')
  const face = new FontFace(familyName, await blob.arrayBuffer())
  await face.load()
  document.fonts.add(face)
  return {
    reference: existing ?? {
      id,
      displayName: font.fullName,
      familyName,
      fileName: '',
      source: 'system',
      postscriptName: font.postscriptName,
      style: font.style,
    },
    face,
    blob,
  }
}
