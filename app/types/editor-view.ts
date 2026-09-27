/** 保存データではなく、カード編集アプリ内の作業画面。 */
export type EditorView = 'card' | 'assets' | 'discovery' | 'ocr' | 'translation' | 'print'
export type EditorTabView = Exclude<EditorView, 'print'>
