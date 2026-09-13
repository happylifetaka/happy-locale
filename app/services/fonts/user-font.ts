import type { FontReference } from '~/types/editor'
import { assertFileSize, FILE_LIMITS } from '~/utils/file-limits'

/** 取り込みを許可するフォントファイル拡張子。 */
export const supportedFontPattern = /\.(ttf|otf|woff2?)$/iu

/** 選択ファイルの拡張子が対応フォント形式か判定する。 */
export function isSupportedFont(file: File): boolean {
  return supportedFontPattern.test(file.name)
}

/** 選択されたフォントを検証・読み込みし、編集データに保存する参照と表示用FontFaceを作る。 */
export async function loadUserFont(
  file: File,
  existing?: FontReference,
): Promise<{ reference: FontReference, face: FontFace, blob: Blob }> {
  if (!isSupportedFont(file)) {
    throw new Error('TTF、OTF、WOFF、WOFF2フォントを選択してください。')
  }
  assertFileSize(file, FILE_LIMITS.fontBytes, 'フォント')
  if (existing && existing.fileName !== file.name) {
    throw new Error(`「${existing.fileName}」を選択してください。`)
  }
  const id = existing?.id ?? crypto.randomUUID()
  const familyName
    = existing?.familyName ?? `HappyLocaleUserFont_${id.replaceAll('-', '_')}`
  const blob = file.slice(0, file.size, file.type)
  const face = new FontFace(familyName, await blob.arrayBuffer())
  await face.load()
  document.fonts.add(face)
  return {
    reference: existing ?? {
      id,
      displayName: file.name.replace(/\.[^.]+$/u, ''),
      familyName,
      fileName: file.name,
      source: 'user',
    },
    face,
    blob,
  }
}
