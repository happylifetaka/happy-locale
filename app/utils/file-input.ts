type FileInput = Pick<HTMLInputElement, 'files' | 'value'>

/** 選択後にinputを空に戻し、同じファイルを再選択したときもchangeが発火するようにする。 */
export function consumeSelectedFiles(input: FileInput): File[] {
  const files = [...(input.files ?? [])]
  input.value = ''
  return files
}

/** 選択した先頭ファイルを取り出し、同じファイルを再選択できる状態へ戻す。 */
export function consumeSelectedFile(input: FileInput): File | undefined {
  return consumeSelectedFiles(input)[0]
}
