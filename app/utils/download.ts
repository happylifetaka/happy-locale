/** Blobに一時URLを割り当て、指定名でブラウザのダウンロードを開始する。 */
export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  URL.revokeObjectURL(url)
}

/** 文字列を指定形式のBlobへ変換してダウンロードする。 */
export function downloadText(text: string, fileName: string, type: string) {
  downloadBlob(new Blob([text], { type }), fileName)
}
