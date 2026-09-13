import { readdir, readFile } from 'node:fs/promises'
import { basename, join, relative } from 'node:path'
import process from 'node:process'

const outputDirectory = '.output/public'
const forbiddenNames = new Set([
  '.env',
  'project.json',
  'project.backup.json',
])
const forbiddenSuffixes = ['.pem', '.key', '.p12', '.pfx']
const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
  /\bAKIA[0-9A-Z]{16}\b/u,
  /\bcf(?:at|ut)_[\w-]{40,}\b/u,
  /\bgh[pousr]_[A-Za-z0-9]{36,}\b/u,
  /\bsk-[A-Za-z0-9]{32,}\b/u,
]

async function filesUnder(directory) {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory())
      files.push(...await filesUnder(path))
    else if (entry.isFile())
      files.push(path)
  }
  return files
}

async function main() {
  const files = await filesUnder(outputDirectory)
  const forbiddenFiles = files.filter((path) => {
    // Only the bundled demo may use this otherwise private project filename.
    if (relative(outputDirectory, path) === join('sample-project', 'project.json'))
      return false
    const name = basename(path).toLowerCase()
    return forbiddenNames.has(name)
      || name.startsWith('.env.')
      || forbiddenSuffixes.some(suffix => name.endsWith(suffix))
      || /(?:^|[-_.])(?:fixture|secret|credential)(?:[-_.]|$)/u.test(name)
  })

  if (forbiddenFiles.length > 0) {
    throw new Error(
      `静的生成物に公開禁止ファイルがあります:\n${forbiddenFiles
        .map(path => relative(outputDirectory, path))
        .join('\n')}`,
    )
  }

  const samplePath = join('sample-project', 'project.json')
  const bundledSample = await readFile(join('public', samplePath))
  const generatedSample = await readFile(join(outputDirectory, samplePath))
  if (!generatedSample.equals(bundledSample))
    throw new Error('静的生成物のデモ設定が公開用サンプルと一致しません。')

  for (const path of files) {
    const contents = await readFile(path)
    if (contents.includes(0))
      continue
    const text = contents.toString('utf8')
    if (secretPatterns.some(pattern => pattern.test(text))) {
      throw new Error(
        `静的生成物に秘密情報らしき文字列があります: ${relative(outputDirectory, path)}`,
      )
    }
  }

  const index = await readFile(join(outputDirectory, 'index.html'), 'utf8')
  if (index.includes('翻訳設定（α）'))
    throw new Error('公開版に翻訳設定が含まれています。')
  if (!index.includes('translationEndpointEnabled:false'))
    throw new Error('公開版でTranslation Endpointが無効になっていません。')

  process.stdout.write(`${files.length}ファイルの静的生成物を検査しました。\n`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
