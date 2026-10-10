import * as YAML from 'yaml'
import { parseTree, printParseErrorCode, type Node as JsonNode, type ParseError } from 'jsonc-parser'
import { formatJson, type IndentStyle } from './formatters.ts'
export { testRegex } from './regex.ts'

export type CronField = { min: number; max: number; values: Set<number> }

export function timestampToDate(value: string, unit: 'seconds' | 'milliseconds'): string {
  if (!/^-?\d+$/.test(value.trim())) throw new Error('请输入整数时间戳')
  const raw = BigInt(value.trim())
  const milliseconds = unit === 'seconds' ? raw * 1000n : raw
  if (milliseconds < -8_640_000_000_000_000n || milliseconds > 8_640_000_000_000_000n) throw new Error('时间戳超出日期范围')
  const date = new Date(Number(milliseconds))
  if (Number.isNaN(date.getTime())) throw new Error('无法解析该时间戳')
  return date.toISOString()
}

export function dateToTimestamp(value: string, unit: 'seconds' | 'milliseconds'): string {
  const milliseconds = Date.parse(value)
  if (!Number.isFinite(milliseconds)) throw new Error('请输入有效日期，建议使用 ISO 8601 格式')
  return unit === 'seconds' ? String(Math.floor(milliseconds / 1000)) : String(milliseconds)
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}

export function encodeBase64(value: string): string {
  return bytesToBase64(new TextEncoder().encode(value))
}

export function decodeBase64(value: string): string {
  let binary: string
  try { binary = atob(value.replace(/\s/g, '')) }
  catch { throw new Error('Base64 输入无效') }
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
  catch { throw new Error('Base64 内容不是有效的 UTF-8 文本') }
}

export function encodeUrl(value: string): string { return encodeURIComponent(value) }
export function decodeUrl(value: string): string {
  try { return decodeURIComponent(value) }
  catch { throw new Error('URL 编码无效：请检查百分号转义和 UTF-8 字节') }
}

export function compareText(before: string, after: string): string {
  const left = before ? before.split(/\r\n|\r|\n/) : []
  const right = after ? after.split(/\r\n|\r|\n/) : []
  // ponytail: LCS is capped at two million cells to keep memory and UI work bounded; use Myers diff if larger documents become a requirement.
  if ((left.length + 1) * (right.length + 1) > 2_000_000) throw new Error('文本过大，当前 Diff 最多支持约 2,000,000 个比较单元')
  const width = right.length + 1
  const lengths = new Uint32Array((left.length + 1) * width)
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      lengths[i * width + j] = left[i] === right[j]
        ? lengths[(i + 1) * width + j + 1]! + 1
        : Math.max(lengths[(i + 1) * width + j]!, lengths[i * width + j + 1]!)
    }
  }
  const lines = ['--- 原文', '+++ 新文']
  let i = 0
  let j = 0
  while (i < left.length || j < right.length) {
    if (i < left.length && j < right.length && left[i] === right[j]) {
      lines.push(`  ${left[i]}`)
      i += 1; j += 1
    } else if (i < left.length && (j === right.length || lengths[(i + 1) * width + j]! >= lengths[i * width + j + 1]!)) {
      lines.push(`- ${left[i]}`)
      i += 1
    } else {
      lines.push(`+ ${right[j]}`)
      j += 1
    }
  }
  return lines.join('\n')
}

export async function hashText(value: string, algorithm: 'SHA-1' | 'SHA-256' | 'SHA-384' | 'SHA-512'): Promise<string> {
  const digest = await crypto.subtle.digest(algorithm, new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function decodeBase64Url(segment: string): string {
  if (!/^[A-Za-z0-9_-]*$/.test(segment) || segment.length % 4 === 1) throw new Error('JWT 中包含无效的 Base64URL 段')
  const base64 = segment.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - segment.length % 4) % 4)
  let binary: string
  try { binary = atob(base64) }
  catch { throw new Error('JWT 中包含无效的 Base64URL 段') }
  return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)))
}

export function decodeJwt(token: string): string {
  const segments = token.trim().split('.')
  if (segments.length !== 3 || !segments[0] || !segments[1]) throw new Error('JWT 应包含 Header、Payload 和 Signature 三段')
  let header: unknown
  let payload: unknown
  try {
    header = JSON.parse(decodeBase64Url(segments[0]!))
    payload = JSON.parse(decodeBase64Url(segments[1]!))
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('JWT Header 或 Payload 不是有效 JSON')
    throw error
  }
  return JSON.stringify({ warning: '仅解析 Header 和 Payload；未验证签名、签发者或有效期。', header, payload }, null, 2)
}

export function dedupeAndSort(value: string, order: 'ascending' | 'descending', caseSensitive: boolean): string {
  const lines = value.split(/\r\n|\r|\n/)
  if (value.endsWith('\n') || value.endsWith('\r')) lines.pop()
  const seen = new Set<string>()
  const unique = lines.filter((line) => {
    const key = caseSensitive ? line : line.toLocaleLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  unique.sort((a, b) => {
    const comparison = a.localeCompare(b, undefined, { numeric: true, sensitivity: caseSensitive ? 'variant' : 'base' })
    return order === 'ascending' ? comparison : -comparison
  })
  return unique.join('\n')
}

export function replaceText(value: string, search: string, replacement: string, caseSensitive: boolean): { text: string; count: number } {
  if (!search) throw new Error('请输入要查找的文本')
  let count = 0
  const replace = () => { count += 1; return replacement }
  const text = caseSensitive
    ? value.replaceAll(search, replace)
    : value.replace(new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), replace)
  return { text, count }
}

function assertJsonTreeSafe(node: JsonNode, source: string): void {
  if (node.type === 'number') {
    const number = Number(source.slice(node.offset, node.offset + node.length))
    if (!Number.isFinite(number) || Number.isInteger(number) && !Number.isSafeInteger(number)) {
      throw new Error('JSON ↔ YAML 仅支持有限且安全范围内的数字，避免转换时精度丢失')
    }
  }
  if (node.type === 'object') {
    const keys = new Set<string>()
    for (const property of node.children ?? []) {
      const [key, value] = property.children ?? []
      if (key?.type !== 'string' || typeof key.value !== 'string' || !value) throw new Error('JSON 对象成员无效')
      if (keys.has(key.value)) throw new Error(`JSON 含有重复键“${key.value}”，无法保证转换结果一致`)
      keys.add(key.value)
      assertJsonTreeSafe(value, source)
    }
  } else {
    for (const child of node.children ?? []) assertJsonTreeSafe(child, source)
  }
}

function assertJsonCompatible(value: unknown, ancestors = new Set<object>()): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Number.isInteger(value) && !Number.isSafeInteger(value)) {
      throw new Error('YAML 含有 JSON 无法安全表示的数字')
    }
    return
  }
  if (typeof value !== 'object') throw new Error('YAML 含有 JSON 不支持的数据类型')
  if (ancestors.has(value)) throw new Error('YAML 别名形成循环，无法转换为 JSON')
  ancestors.add(value)
  if (Array.isArray(value)) value.forEach((item) => assertJsonCompatible(item, ancestors))
  else {
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new Error('YAML 含有 JSON 不支持的数据类型')
    for (const item of Object.values(value)) assertJsonCompatible(item, ancestors)
  }
  ancestors.delete(value)
}

export function convertJsonYaml(value: string, direction: 'json-to-yaml' | 'yaml-to-json', indent: IndentStyle = '2'): string {
  const jsonIndent = indent === 'tab' ? '\t' : Number(indent)
  const yamlIndent = indent === 'tab' ? 2 : Number(indent)
  if (direction === 'json-to-yaml') {
    const errors: ParseError[] = []
    const tree = parseTree(value, errors, { allowTrailingComma: false, disallowComments: true })
    if (errors.length || !tree) {
      const issue = errors[0]
      const reason = issue ? printParseErrorCode(issue.error).replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase() : '内容为空'
      throw new Error(`JSON ${reason}`)
    }
    assertJsonTreeSafe(tree, value)
    return YAML.stringify(JSON.parse(value), { schema: 'json', indent: yamlIndent, lineWidth: 0 })
  }

  const document = YAML.parseDocument(value, { schema: 'json', uniqueKeys: true, prettyErrors: true })
  if (document.errors.length) throw new Error(`YAML 无效：${document.errors[0]!.message}`)
  if (!document.contents) throw new Error('YAML 内容为空')
  const parsed = document.toJS()
  assertJsonCompatible(parsed)
  return JSON.stringify(parsed, null, jsonIndent)
}

export function formatYaml(value: string): string {
  const document = YAML.parseDocument(value, { uniqueKeys: true, prettyErrors: true })
  if (document.errors.length) throw new Error(document.errors[0]!.message)
  return YAML.stringify(document, { indent: 2, lineWidth: 0 })
}

function serializeXmlNode(node: Node, depth: number): string {
  const pad = '  '.repeat(depth)
  if (node.nodeType === Node.TEXT_NODE) return node.nodeValue?.trim() ? `${pad}${new XMLSerializer().serializeToString(node)}` : ''
  if (node.nodeType !== Node.ELEMENT_NODE) return `${pad}${new XMLSerializer().serializeToString(node)}`

  const element = node as Element
  const significantChildren = [...element.childNodes].filter((child) => child.nodeType !== Node.TEXT_NODE || !!child.nodeValue?.trim())
  if (!significantChildren.length) {
    const empty = element.cloneNode(false) as Element
    const serialized = new XMLSerializer().serializeToString(empty)
    const open = serialized.slice(0, serialized.indexOf('>') + 1).replace(/\/>$/, '>')
    return `${pad}${open.slice(0, -1)}/>`
  }
  if (significantChildren.some((child) => child.nodeType === Node.TEXT_NODE)) return `${pad}${new XMLSerializer().serializeToString(element)}`
  const serialized = new XMLSerializer().serializeToString(element.cloneNode(false))
  const open = serialized.slice(0, serialized.indexOf('>') + 1).replace(/\/>$/, '>')
  return `${pad}${open}\n${significantChildren.map((child) => serializeXmlNode(child, depth + 1)).join('\n')}\n${pad}</${element.tagName}>`
}

export function formatXml(value: string): string {
  const document = new DOMParser().parseFromString(value, 'application/xml')
  const error = document.getElementsByTagNameNS('http://www.mozilla.org/newlayout/xml/parsererror.xml', 'parsererror').item(0) ?? document.querySelector('parsererror')
  if (error) throw new Error(`XML 无效：${error.textContent?.trim() || '解析失败'}`)
  const declaration = value.match(/^\uFEFF?\s*(<\?xml\b[\s\S]*?\?>)/i)?.[1]
  const content = [...document.childNodes].map((node) => serializeXmlNode(node, 0)).filter(Boolean).join('\n')
  return declaration ? `${declaration}\n${content}` : content
}

export function parseHttpResponse(value: string, indent: IndentStyle = '2'): string {
  const boundary = value.search(/\r?\n\r?\n/)
  let body = value
  let statusLine: string | undefined
  let headers: string[] = []
  if (boundary >= 0) {
    const lines = value.slice(0, boundary).split(/\r?\n/)
    const hasStatus = /^HTTP\/\d(?:\.\d)?\s+\d{3}(?:\s|$)/i.test(lines[0] ?? '')
    const candidateHeaders = hasStatus ? lines.slice(1) : lines
    const looksLikeHeaderBlock = hasStatus || candidateHeaders.length > 0 && candidateHeaders.every((line) => /^\s|^[^:]+:/.test(line))
    if (looksLikeHeaderBlock) {
      if (candidateHeaders.some((line) => !/^\s/.test(line) && !/^[^:]+:/.test(line))) throw new Error('HTTP 响应头格式无效')
      statusLine = hasStatus ? lines[0] : undefined
      headers = candidateHeaders
      body = value.slice(boundary).replace(/^\r?\n\r?\n/, '')
    }
  }
  const contentTypeHeader = headers.find((line) => /^content-type\s*:/i.test(line))
  const contentType = contentTypeHeader?.slice(contentTypeHeader.indexOf(':') + 1).split(';')[0]?.trim().toLowerCase() ?? ''
  let formattedBody = body
  const trimmed = body.trimStart()
  if (contentType.includes('json') || !contentType && /^[{[]/.test(trimmed)) formattedBody = formatJson(body, indent)
  else if (contentType.includes('xml') || !contentType && /^</.test(trimmed)) formattedBody = formatXml(body)
  else if (/ya?ml/i.test(contentType)) formattedBody = formatYaml(body)

  if (!statusLine && !headers.length) {
    if (formattedBody === body) throw new Error('请粘贴完整 HTTP 响应，或 JSON、XML、YAML 响应正文')
    return formattedBody
  }
  const responseHead = [statusLine, ...headers].filter((line): line is string => !!line).join('\n')
  return `${responseHead}\n\n${formattedBody}`
}

export function parseCronField(source: string, min: number, max: number, dayOfWeek = false): CronField {
  const values = new Set<number>()
  for (const part of source.split(',')) {
    const [base, stepText] = part.split('/')
    if (!base || (part.match(/\//g)?.length ?? 0) > 1) throw new Error(`Cron 字段格式无效：${part}`)
    const step = stepText === undefined ? 1 : Number(stepText)
    if (!Number.isInteger(step) || step < 1) throw new Error(`Cron 步长无效：${part}`)
    let start: number
    let end: number
    if (base === '*') { start = min; end = max }
    else if (/^\d+$/.test(base)) {
      start = Number(base)
      end = stepText === undefined ? start : max
    } else {
      const range = base.match(/^(\d+)-(\d+)$/)
      if (!range) throw new Error(`Cron 字段格式无效：${part}`)
      start = Number(range[1]); end = Number(range[2])
    }
    if (start < min || end > max || start > end) throw new Error(`Cron 值应在 ${min}–${max} 范围内：${part}`)
    for (let value = start; value <= end; value += step) values.add(dayOfWeek && value === 7 ? 0 : value)
  }
  return { min, max, values }
}

export function nextCronRuns(expression: string, now = new Date(), count = 5): string[] {
  const parts = expression.trim().split(/\s+/)
  if (parts.length !== 5) throw new Error('目前支持标准 5 段 Cron：分 时 日 月 周')
  const minute = parseCronField(parts[0]!, 0, 59)
  const hour = parseCronField(parts[1]!, 0, 23)
  const day = parseCronField(parts[2]!, 1, 31)
  const month = parseCronField(parts[3]!, 1, 12)
  const week = parseCronField(parts[4]!, 0, 7, true)
  const dayWildcard = parts[2] === '*'
  const weekWildcard = parts[4] === '*'
  const results: string[] = []
  const cursor = new Date(now)
  cursor.setSeconds(0, 0)
  cursor.setMinutes(cursor.getMinutes() + 1)
  // ponytail: scan at most one local calendar year minute by minute; use a cron library if advanced syntax or larger horizons are needed.
  for (let checked = 0; checked < 527_040 && results.length < count; checked += 1, cursor.setMinutes(cursor.getMinutes() + 1)) {
    const dayMatch = day.values.has(cursor.getDate())
    const weekMatch = week.values.has(cursor.getDay())
    if (minute.values.has(cursor.getMinutes()) && hour.values.has(cursor.getHours()) && month.values.has(cursor.getMonth() + 1) && (dayWildcard || weekWildcard ? dayMatch && weekMatch : dayMatch || weekMatch)) {
      results.push(cursor.toLocaleString())
    }
  }
  if (!results.length) throw new Error('未来一年内未找到匹配时间')
  return results
}

function digitValue(char: string): number {
  const code = char.toLowerCase().charCodeAt(0)
  return code >= 48 && code <= 57 ? code - 48 : code >= 97 && code <= 122 ? code - 87 : -1
}

export function convertRadix(value: string, from: number, to: number): string {
  if (![2, 8, 10, 16].includes(from) || ![2, 8, 10, 16].includes(to)) throw new Error('仅支持 2、8、10、16 进制')
  const source = value.trim()
  const negative = source.startsWith('-')
  const digits = source.replace(/^[+-]/, '')
  if (!digits) throw new Error('请输入要转换的整数')
  let number = 0n
  for (const char of digits) {
    const digit = digitValue(char)
    if (digit < 0 || digit >= from) throw new Error(`输入含有 ${from} 进制不支持的字符：${char}`)
    number = number * BigInt(from) + BigInt(digit)
  }
  if (negative) number = -number
  return number.toString(to).toUpperCase()
}

export function parseRequestHeaders(value: string): Headers {
  const headers = new Headers()
  for (const line of value.split(/\r?\n/)) {
    if (!line.trim()) continue
    const separator = line.indexOf(':')
    if (separator < 1) throw new Error(`请求头应使用“名称: 值”格式：${line}`)
    headers.append(line.slice(0, separator).trim(), line.slice(separator + 1).trim())
  }
  return headers
}

export async function sendHttpRequest(options: {
  method: string; url: string; headers?: string; body?: string; timeoutMs?: number
}, fetcher: typeof fetch = fetch): Promise<string> {
  let url: URL
  try { url = new URL(options.url) }
  catch { throw new Error('请输入有效的完整 URL（包含 http:// 或 https://）') }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('请求 URL 仅支持 HTTP 和 HTTPS')
  const method = options.method.toUpperCase()
  if (!/^[A-Z]+$/.test(method)) throw new Error('HTTP 方法无效')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 30_000)
  try {
    const response = await fetcher(url, {
      method,
      headers: parseRequestHeaders(options.headers ?? ''),
      body: method === 'GET' || method === 'HEAD' ? undefined : options.body,
      signal: controller.signal,
    })
    const body = await response.text()
    return JSON.stringify({
      status: response.status,
      statusText: response.statusText,
      url: response.url || url.href,
      headers: Object.fromEntries(response.headers.entries()),
      body,
    }, null, 2)
  } catch (error) {
    if (controller.signal.aborted) throw new Error('请求超时（30 秒）')
    throw new Error(`请求失败：${(error as Error).message}`)
  } finally { clearTimeout(timer) }
}
