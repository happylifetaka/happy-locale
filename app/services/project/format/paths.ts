/** フォルダ外のファイルを参照・削除しないよう、保存形式で許可する相対パスを限定する。 */
export function isSafeProjectPath(path: string): boolean {
  const parts = path.split('/')
  return (
    path.length > 0
    && !path.startsWith('/')
    && parts.every(part => part.length > 0 && part !== '.' && part !== '..')
  )
}

/** 元画像用ディレクトリ内の許可された相対パスか確認する。 */
export function isSafeCardImagePath(path: string): boolean {
  return /^images\/[^/]+\.(?:png|jpe?g)$/iu.test(path)
    && isSafeProjectPath(path)
}

/** アセット用ディレクトリ内のPNGパスか確認する。 */
export function isSafeAssetImagePath(path: string): boolean {
  return /^assets\/[^/]+\.png$/iu.test(path)
    && isSafeProjectPath(path)
}
