/** 画面内で確認する診断ログ。画像やファイル内容ではなく操作の補足情報を保持する。 */
export interface DiagnosticEntry {
  time: string
  message: string
  details?: string
  level: 'info' | 'error'
}
