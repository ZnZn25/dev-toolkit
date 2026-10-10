import { spawn } from 'node:child_process'
import { join } from 'node:path'

const maxRequestBytes = 4096
const maxOutputBytes = 256 * 1024

function sendJson(response, status, payload) {
  if (response.destroyed || response.writableEnded) return
  const body = JSON.stringify(payload)
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
  }).end(body)
}

function isLoopbackRequest(request) {
  const remote = request.socket.remoteAddress
  if (remote && remote !== '127.0.0.1' && remote !== '::1' && remote !== '::ffff:127.0.0.1') return false
  const origin = request.headers.origin
  if (!origin) return true
  try {
    const parsed = new URL(origin)
    const host = request.headers.host?.toLowerCase()
    return parsed.protocol === 'http:' && (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') && parsed.host.toLowerCase() === host
  } catch { return false }
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    let tooLarge = false
    request.on('data', (chunk) => {
      size += chunk.length
      if (size > maxRequestBytes) tooLarge = true
      else if (!tooLarge) chunks.push(chunk)
    })
    request.on('end', () => {
      if (tooLarge) { reject(Object.assign(new Error('Ping 请求内容过大'), { status: 413 })); return }
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) }
      catch { reject(Object.assign(new Error('Ping 请求格式无效'), { status: 400 })) }
    })
    request.on('error', reject)
  })
}

async function runPingRequest(request, response) {
  if (!isLoopbackRequest(request)) { sendJson(response, 403, { error: '仅允许本机访问 Ping 服务' }); return }
  if (request.method !== 'POST') { sendJson(response, 405, { error: '仅支持 POST', allow: 'POST' }); return }
  if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) {
    sendJson(response, 415, { error: '请求必须使用 application/json' })
    return
  }

  let payload
  try { payload = await readJson(request) }
  catch (error) {
    const issue = error instanceof Error ? error : new Error('Ping 请求格式无效')
    sendJson(response, issue.status ?? 400, { error: issue.message })
    return
  }

  const target = typeof payload?.target === 'string' ? payload.target.trim() : ''
  const count = payload?.count
  const continuous = payload?.continuous === true
  if (!target || target.length > 253 || !/^[A-Za-z0-9:][A-Za-z0-9.:%_-]*$/.test(target)) {
    sendJson(response, 400, { error: '请输入有效的主机名或 IP 地址（不支持空格和命令参数）' })
    return
  }
  if (!continuous && (!Number.isInteger(count) || count < 1 || count > 100)) {
    sendJson(response, 400, { error: 'Ping 次数应为 1–100 的整数' })
    return
  }

  const executable = process.platform === 'win32'
    ? process.env.SystemRoot ? join(process.env.SystemRoot, 'System32', 'ping.exe') : 'ping.exe'
    : 'ping'
  const args = process.platform === 'win32'
    ? continuous ? ['-t', target] : ['-n', String(count), '-w', '1000', target]
    : continuous ? ['-i', '1', target] : ['-c', String(count), '-W', '1', target]
  let child
  try { child = spawn(executable, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }) }
  catch (error) { sendJson(response, 500, { error: `无法启动本机 ping：${error.message}` }); return }

  const decoder = new TextDecoder(process.platform === 'win32' ? 'gbk' : 'utf-8')
  let outputBytes = 0
  let disconnected = false
  let truncated = false
  let headersSent = false
  const streams = [child.stdout, child.stderr].filter(Boolean)

  function writeOutput(chunk) {
    if (disconnected || response.destroyed || response.writableEnded) return
    const remaining = maxOutputBytes - outputBytes
    const kept = chunk.subarray(0, Math.max(0, remaining))
    outputBytes += kept.length
    const text = decoder.decode(kept, { stream: true })
    if (text) response.write(text)
    if (kept.length < chunk.length && !truncated) {
      truncated = true
      response.write('\n[输出已达到 256 KiB 上限，Ping 已停止]\n')
      child.kill()
    }
  }

  response.once('close', () => {
    if (!response.writableEnded) {
      disconnected = true
      child.kill()
    }
  })
  child.once('spawn', () => {
    headersSent = true
    response.writeHead(200, {
      'Cache-Control': 'no-store, no-transform',
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Accel-Buffering': 'no',
      'X-Content-Type-Options': 'nosniff',
    })
    response.flushHeaders()
    for (const stream of streams) stream.on('data', writeOutput)
  })
  child.once('error', (error) => {
    if (disconnected) return
    if (!headersSent) sendJson(response, 500, { error: `无法启动本机 ping：${error.message}` })
    else response.end(`\n无法继续读取 Ping 输出：${error.message}\n`)
  })
  child.once('close', () => {
    if (disconnected || response.destroyed || response.writableEnded) return
    const tail = decoder.decode()
    if (tail) response.write(tail)
    response.end()
  })
}

export function handlePingRequest(request, response) {
  let pathname
  try { pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname }
  catch { return false }
  if (pathname !== '/__local/ping') return false
  void runPingRequest(request, response)
  return true
}

export function createPingMiddleware() {
  return (request, response, next) => {
    if (!handlePingRequest(request, response)) next()
  }
}
