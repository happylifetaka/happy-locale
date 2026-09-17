import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { extname, join, resolve, sep } from 'node:path'
import { chromium, expect } from '@playwright/test'

// 公開用ビルドと実Chromeモデルを検証する。フォルダ選択だけを専用OPFSへ差し替える。
const root = resolve('.output/public')
const hints = JSON.parse(await readFile('samples/cards/demo-regions.json', 'utf8'))
const server = createServer(async (request, response) => {
  try {
    let path = resolve(root, `.${new URL(request.url, 'http://localhost').pathname}`)
    if (!path.startsWith(`${root}${sep}`) && path !== root)
      throw new Error('Invalid path')
    if ((await stat(path)).isDirectory())
      path = join(path, 'index.html')
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' }
    response.writeHead(200, { 'Content-Type': types[extname(path)] ?? 'application/octet-stream' })
    response.end(await readFile(path))
  }
  catch {
    response.writeHead(404)
    response.end()
  }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const profile = await mkdtemp(join(tmpdir(), 'happy-locale-translation-ui-'))
let context
try {
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chrome',
    headless: false,
    ignoreDefaultArgs: true,
    args: [`--user-data-dir=${profile}`, '--remote-debugging-pipe', '--no-first-run', '--no-default-browser-check'],
    viewport: { width: 1440, height: 1000 },
  })
  await context.addInitScript(() => {
    localStorage.setItem('happy-locale.translation-settings.v1', JSON.stringify({ provider: 'manual', endpoint: 'http://localhost:4578' }))
  })
  const page = context.pages()[0] ?? await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`http://127.0.0.1:${server.address().port}/cards/`)
  await page.evaluate(async (hints) => {
    const root = await navigator.storage.getDirectory()
    const directory = await root.getDirectoryHandle('translation-ui-fixture', { create: true })
    const project = await (await fetch('/sample-project/project.json')).json()
    delete project.demoPreset
    project.name = '翻訳検証'
    project.cards = project.cards.slice(0, 1)
    project.cards[0].regions = hints['sample-01'].slice(0, 3)
    project.cards[0].regions[0].originalText = 'Gain 2 [icon:sun].'
    project.cards[0].regions[1].originalText = 'Spend 1 [icon:drop] to gain 2 [icon:sun].'
    project.cards[0].regions[2].translatedText = '手修正済みの訳'
    for (const path of ['images/01-grove.png', 'assets/sun.png', 'assets/drop.png']) {
      const [folder, name] = path.split('/')
      const target = await directory.getDirectoryHandle(folder, { create: true })
      const writable = await (await target.getFileHandle(name, { create: true })).createWritable()
      await writable.write(await (await fetch(`/sample-project/${path}`)).blob())
      await writable.close()
    }
    const writable = await (await directory.getFileHandle('project.json', { create: true })).createWritable()
    await writable.write(JSON.stringify(project))
    await writable.close()
    window.showDirectoryPicker = async () => directory
  }, hints)
  await page.getByRole('button', { name: 'プロジェクトを開く／作成', exact: true }).click()
  await page.locator('summary').filter({ hasText: 'ツール' }).click()
  await page.getByRole('button', { name: '翻訳設定', exact: true }).click()
  const settings = page.getByRole('dialog', { name: '翻訳', exact: true })
  await settings.getByRole('radio', { name: 'ブラウザ内翻訳', exact: false }).check()
  await expect(settings.getByText('Translation Endpoint（α）', { exact: true })).not.toBeVisible()
  await settings.getByRole('button', { name: '英日翻訳の対応状況を確認', exact: true }).click()
  await expect(settings.getByRole('status')).toContainText('利用可能', { timeout: 30000 })
  await settings.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByRole('button', { name: 'まとめて翻訳', exact: true }).click()
  const review = page.getByRole('dialog', { name: '翻訳をまとめて確認' })
  await expect(review).toBeVisible()
  await review.getByRole('button', { name: '表示中の未翻訳を取得', exact: true }).click()
  await expect(review.getByRole('button', { name: '取得を中止', exact: true })).not.toBeVisible({ timeout: 120000 })
  const values = await review.locator('textarea').evaluateAll(items => items.map(item => item.value))
  expect(values[0]).toContain('[icon:sun]')
  expect(values[1]).toContain('[icon:drop]')
  expect(values[1]).toContain('[icon:sun]')
  expect(values[2]).toBe('手修正済みの訳')
  await page.screenshot({ path: '/tmp/happy-locale-translation-ui.png', fullPage: true })
  await review.getByRole('button', { name: '選択した変更2件を反映', exact: true }).click()
  await expect(review).not.toBeVisible()
  await page.getByRole('button', { name: '元に戻す', exact: true }).click()
  await page.getByRole('button', { name: 'まとめて翻訳', exact: true }).click()
  await expect(review).toBeVisible()
  const undone = await review.locator('textarea').evaluateAll(items => items.map(item => item.value))
  expect(undone).toEqual(['', '', '手修正済みの訳'])
  await review.getByRole('button', { name: '閉じる', exact: true }).click()
  await context.setOffline(true)
  const offline = await page.evaluate(async () => {
    const availability = await Translator.availability({ sourceLanguage: 'en', targetLanguage: 'ja' })
    const translator = await Translator.create({ sourceLanguage: 'en', targetLanguage: 'ja' })
    try {
      return { online: navigator.onLine, availability, translation: await translator.translate('Do not discard this card.') }
    }
    finally { translator.destroy() }
  })
  expect(offline.online).toBe(false)
  expect(offline.translation).toContain('ない')
  const cancelled = await page.evaluate(async () => {
    const controller = new AbortController()
    const request = Translator.create({ sourceLanguage: 'en', targetLanguage: 'ja', signal: controller.signal })
    controller.abort()
    try {
      const translator = await request
      translator.destroy()
      return 'unexpected success'
    }
    catch (error) { return error.name }
  })
  expect(cancelled).toBe('AbortError')
  await writeFile('/tmp/happy-locale-translation-ui.json', JSON.stringify({ settings: 'browser selected; endpoint hidden', values, undone, offline, cancelled, errors }, null, 2))
  expect(errors).toEqual([])
  console.log(JSON.stringify({ values, undone, offline, cancelled, errors }))
}
finally {
  await context?.close()
  await new Promise(resolve => server.close(resolve))
}
