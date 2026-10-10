import { spawn } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { access, realpath, stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { handlePingRequest } from './ping-http.mjs'

const host = '127.0.0.1'
const port = 8080
const url = `http://localhost:${port}/`
const distDir = resolve(fileURLToPath(new URL('../dist', import.meta.url)))
const types = new Map([
  ['.css', 'text/css; charset=utf-8'], ['.html', 'text/html; charset=utf-8'], ['.ico', 'image/x-icon'],
  ['.js', 'text/javascript; charset=utf-8'], ['.json', 'application/json; charset=utf-8'], ['.map', 'application/json; charset=utf-8'],
  ['.png', 'image/png'], ['.svg', 'image/svg+xml'], ['.ttf', 'font/ttf'], ['.txt', 'text/plain; charset=utf-8'],
  ['.wasm', 'application/wasm'], ['.woff', 'font/woff'], ['.woff2', 'font/woff2'],
])

try {
  await access(join(distDir, 'index.html'))
} catch {
  console.error('找不到 dist/index.html。请先运行 npm run build，或使用 start-web.cmd 自动构建。')
  process.exit(1)
}

const realDistDir = await realpath(distDir)
const distPrefix = `${realDistDir}${sep}`
const server = createServer(async (request, response) => {
  if (handlePingRequest(request, response)) return
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end('Method Not Allowed')
    return
  }

  let pathname
  try { pathname = decodeURIComponent(new URL(request.url ?? '/', `http://${host}:${port}`).pathname) }
  catch { response.writeHead(400).end('Bad Request'); return }
  if (pathname.includes('\0')) { response.writeHead(400).end('Bad Request'); return }

  const relativePath = (pathname === '/' ? 'index.html' : pathname).replace(/^[/\\]+/, '')
  let filePath = resolve(realDistDir, relativePath)
  if (filePath !== realDistDir && !filePath.startsWith(distPrefix)) {
    response.writeHead(403).end('Forbidden')
    return
  }

  try {
    filePath = await realpath(filePath)
    if (filePath !== realDistDir && !filePath.startsWith(distPrefix)) throw new Error('outside dist')
    if ((await stat(filePath)).isDirectory()) filePath = await realpath(join(filePath, 'index.html'))
  } catch {
    if (extname(relativePath)) { response.writeHead(404).end('Not Found'); return }
    filePath = join(realDistDir, 'index.html')
  }

  let fileInfo
  try {
    fileInfo = await stat(filePath)
    if (!fileInfo.isFile()) throw new Error('not a file')
  } catch { response.writeHead(404).end('Not Found'); return }

  const contentType = types.get(extname(filePath).toLowerCase()) ?? 'application/octet-stream'
  const immutableAsset = pathname.startsWith('/assets/')
  response.writeHead(200, {
    'Cache-Control': immutableAsset ? 'public, max-age=31536000, immutable' : 'no-cache',
    'Content-Length': fileInfo.size,
    'Content-Type': contentType,
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
  })
  if (request.method === 'HEAD') { response.end(); return }
  createReadStream(filePath).on('error', () => response.destroy()).pipe(response)
})

server.on('error', (error) => {
  console.error(`本地 Web 服务启动失败：${error.message}`)
  process.exitCode = 1
})
server.listen(port, host, () => {
  console.log(`实用工具箱 Web 版运行中：${url}`)
  console.log('仅监听本机 127.0.0.1。按 Ctrl+C 停止服务。')
  if (process.platform === 'win32') {
    const browser = spawn('cmd.exe', ['/d', '/s', '/c', `start "" "${url}"`], { detached: true, stdio: 'ignore', windowsHide: true })
    browser.unref()
  }
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)))
}
