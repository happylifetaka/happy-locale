import { Buffer } from 'node:buffer'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { chromium } from '@playwright/test'
import ts from 'typescript'

// 実モデルの検証専用。本体・既存Chromeプロファイル・プロジェクトデータを変更しない。
const cases = [
  { id: 'sequence', source: 'Draw 2 cards, then keep 1.', check: '2枚引いてから1枚残す順序' },
  { id: 'condition', source: 'If your reserve is empty, gain 1 point.', check: '予備が空の場合だけ得る条件' },
  { id: 'negation', source: 'Do not discard this card.', check: '捨ててはいけないという否定' },
  { id: 'optional', source: 'You may stop on an occupied space.', check: '止まることが任意である' },
  { id: 'limit', source: 'Move up to 3 spaces.', check: '必ず3マスではなく最大3マス' },
  { id: 'target', source: 'Move one marker from this card to your reserve.', check: '移動元・移動先・1個という数量' },
  { id: 'icon', source: 'When you enter this place, gain 2 [icon:sun].', check: '入ったときにsunを2個得る' },
  { id: 'cost', source: 'Spend 2 [icon:drop] to move up to 3 spaces.', check: 'dropを2個消費して最大3マス移動' },
  { id: 'repeat', source: 'Spend 1 [icon:sun] to gain 2 [icon:sun].', check: 'sunの消費1個と獲得2個を混同しない' },
  { id: 'multiple', source: 'Spend 1 [icon:drop] to gain 2 [icon:sun].', check: '消費dropと獲得sunを混同しない' },
  { id: 'japanese-name', source: 'Gain 1 [icon:太陽].', check: '日本語のアセット名を保持する' },
]

// 本体のProviderをブラウザへ読み込み、試作との違いも同じ実モデルで比較する。
const transpile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
const moduleURL = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
const protectedModule = moduleURL(transpile(await readFile(new URL('../app/services/translator/protected-text.ts', import.meta.url), 'utf8')))
const providerModule = moduleURL(transpile(await readFile(new URL('../app/services/translator/browser.ts', import.meta.url), 'utf8')).replace('\'./protected-text\'', JSON.stringify(protectedModule)))
const output = process.argv[2] ?? '/tmp/happy-locale-translation-probe.json'
const profile = await mkdtemp(join(tmpdir(), 'happy-locale-translation-probe-'))
const server = createServer((_request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  response.end('<!doctype html><html lang="ja"><meta charset="utf-8"><title>翻訳API検証</title><h1>英日翻訳の実モデル検証</h1><p>テスト文だけを使用します。開始時にChromeが翻訳モデルを取得する場合があります。</p><button id="start">検証開始</button><pre id="status">待機中</pre></html>')
})
await new Promise((resolve, reject) => {
  server.once('error', reject)
  server.listen(0, '127.0.0.1', resolve)
})
let context
const report = { startedAt: new Date().toISOString(), profile, cases, events: [] }
try {
  // Playwrightの既定引数はcomponent update/Translate等を無効にするため使用しない。
  // 実験用フラグでAPIを強制有効化せず、インストール済みChromeを独立プロファイルで起動する。
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chrome',
    headless: false,
    ignoreDefaultArgs: true,
    args: [`--user-data-dir=${profile}`, '--remote-debugging-pipe', '--no-first-run', '--no-default-browser-check'],
  })
  const page = context.pages()[0] ?? await context.newPage()
  await page.exposeFunction('recordProgress', (event) => {
    report.events.push(event)
    console.log(JSON.stringify(event))
  })
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  await page.evaluate(async (url) => {
    window.ProbeProvider = (await import(url)).BrowserTranslationProvider
  }, providerModule)
  report.environment = await page.evaluate(async () => ({
    userAgent: navigator.userAgent,
    secureContext: isSecureContext,
    translator: 'Translator' in globalThis,
    availability: 'Translator' in globalThis
      ? await Translator.availability({ sourceLanguage: 'en', targetLanguage: 'ja' })
      : 'unsupported',
  }))
  console.log(JSON.stringify(report.environment))
  if (report.environment.translator && report.environment.availability !== 'unavailable') {
    await page.evaluate((testCases) => {
      const status = document.querySelector('#status')
      document.querySelector('#start').addEventListener('click', async () => {
        const results = []
        let translator
        const started = performance.now()
        try {
          status.textContent = 'モデル準備中'
          translator = await Translator.create({
            sourceLanguage: 'en',
            targetLanguage: 'ja',
            monitor(monitor) {
              monitor.addEventListener('downloadprogress', (event) => {
                status.textContent = `モデル取得: ${Math.round(event.loaded * 100)}%`
                void window.recordProgress({ type: 'download', loaded: event.loaded })
              })
            },
          })
          const initializationMs = Math.round(performance.now() - started)
          for (const testCase of testCases) {
            for (const mode of testCase.source.includes('[icon:') ? ['raw', 'placeholder', 'provider'] : ['raw', 'provider']) {
              const tokens = []
              const input = mode !== 'placeholder'
                ? testCase.source
                : testCase.source.replace(/\[icon:[^\]\r\n]+\]/gu, (token) => {
                    tokens.push(token)
                    return `zxqicon${tokens.length}qxz`
                  })
              const start = performance.now()
              const rawOutput = mode === 'provider'
                ? await new window.ProbeProvider().translate(input, 'en', 'ja')
                : await translator.translate(input)
              let restored = rawOutput
              let placeholdersIntact = true
              for (const [index, token] of tokens.entries()) {
                const marker = `zxqicon${index + 1}qxz`
                if (restored.split(marker).length - 1 !== 1)
                  placeholdersIntact = false
                restored = restored.replaceAll(marker, token)
              }
              const icons = text => (text.match(/\[icon:[^\]\r\n]+\]/gu) ?? []).sort()
              const result = {
                id: testCase.id,
                mode,
                input,
                rawOutput,
                restored,
                elapsedMs: Math.round(performance.now() - start),
                placeholdersIntact,
                tagsIntact: JSON.stringify(icons(testCase.source)) === JSON.stringify(icons(restored)),
                // 数字・否定・条件・意味上のタグ位置は人が確認する。自動合格にはしない。
                semanticReview: 'pending',
              }
              results.push(result)
              status.textContent = JSON.stringify(results, null, 2)
              await window.recordProgress({ type: 'translation', ...result })
            }
          }
          window.probeResult = { initializationMs, results }
        }
        catch (error) {
          window.probeResult = { results, error: `${error.name}: ${error.message}` }
          status.textContent = window.probeResult.error
        }
        finally {
          translator?.destroy()
        }
      }, { once: true })
    }, cases)
    await page.locator('#start').click()
    await page.waitForFunction(() => window.probeResult !== undefined, undefined, { timeout: 120000 })
    report.result = await page.evaluate(() => window.probeResult)
  }
}
catch (error) {
  report.error = `${error.name}: ${error.message}`
  process.exitCode = 1
}
finally {
  await context?.close()
  await new Promise(resolve => server.close(resolve))
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`)
  if (report.result?.error)
    process.exitCode = 1
  console.log(`Report: ${output}`)
  // モデル取得・再実行の調査用に専用プロファイルを残し、場所を結果へ記録する。
}
