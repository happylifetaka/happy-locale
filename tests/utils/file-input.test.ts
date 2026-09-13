import { describe, expect, it } from 'vitest'
import {
  consumeSelectedFile,
  consumeSelectedFiles,
} from '~/utils/file-input'

function input(files: File[]) {
  return {
    files: files as unknown as FileList,
    value: '/fake/path/selected.file',
  }
}

describe('file input consumption', () => {
  it('returns the selected file and immediately resets the input', () => {
    const file = { name: 'oversized.png' } as File
    const element = input([file])

    expect(consumeSelectedFile(element)).toBe(file)
    expect(element.value).toBe('')
  })

  it('returns every selected file and resets empty selections too', () => {
    const files = [
      { name: 'one.png' } as File,
      { name: 'two.png' } as File,
    ]
    const selected = input(files)
    const empty = input([])

    expect(consumeSelectedFiles(selected)).toEqual(files)
    expect(selected.value).toBe('')
    expect(consumeSelectedFiles(empty)).toEqual([])
    expect(empty.value).toBe('')
  })
})
