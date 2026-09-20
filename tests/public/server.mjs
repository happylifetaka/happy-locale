import { realpathSync } from 'node:fs'
import { readFile, realpath, stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, resolve, sep } from 'node:path'

// Loopback-only test server: serve built files, never Nuxt dev modules or SPA fallbacks.
const root = realpathSync('.output/public')
const base = '/happy-locale-public/'
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.gz': 'application/gzip',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
}
createServer(async (request, response) => {
  try {
    const path = decodeURIComponent(new URL(request.url, 'http://127.0.0.1:3101').pathname)
    if (!['GET', 'HEAD'].includes(request.method) || !path.startsWith(base)) {
      response.writeHead(404).end()
      return
    }
    let file = await realpath(resolve(root, path.slice(base.length)))
    if (file !== root && !file.startsWith(`${root}${sep}`)) {
      response.writeHead(404).end()
      return
    }
    if ((await stat(file)).isDirectory())
      file = await realpath(resolve(file, 'index.html'))
    if (!file.startsWith(`${root}${sep}`)) {
      response.writeHead(404).end()
      return
    }
    const bytes = await readFile(file)
    response.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'Content-Length': bytes.length, 'Cache-Control': 'no-store' })
    response.end(request.method === 'HEAD' ? undefined : bytes)
  }
  catch {
    response.writeHead(404).end()
  }
}).listen(3101, '127.0.0.1')
