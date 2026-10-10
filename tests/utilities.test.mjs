import assert from 'node:assert/strict'
import test from 'node:test'
import {
  compareText, convertJsonYaml, convertRadix, dateToTimestamp, decodeBase64, decodeJwt, decodeUrl, dedupeAndSort,
  encodeBase64, encodeUrl, formatYaml, hashText, nextCronRuns, parseHttpResponse, replaceText, sendHttpRequest, testRegex, timestampToDate,
} from '../src/core/utilities.ts'

test('timestamps convert seconds, milliseconds and ISO dates without losing negative values', () => {
  assert.equal(timestampToDate('0', 'seconds'), '1970-01-01T00:00:00.000Z')
  assert.equal(timestampToDate('-1000', 'milliseconds'), '1969-12-31T23:59:59.000Z')
  assert.equal(dateToTimestamp('1970-01-01T00:00:01.500Z', 'seconds'), '1')
  assert.throws(() => timestampToDate('1.5', 'seconds'), /整数/)
})

test('Base64 and URL transformations preserve Unicode and reject invalid text', () => {
  assert.equal(decodeBase64(encodeBase64('本地工具 🔧')), '本地工具 🔧')
  assert.throws(() => decodeBase64('%%%'), /无效/)
  assert.equal(decodeUrl(encodeUrl('a b/你好')), 'a b/你好')
  assert.throws(() => decodeUrl('%E0%A4%A'), /无效/)
})

test('line Diff, dedupe sorting, and arbitrary-size radix conversion are stable', () => {
  assert.equal(compareText('a\nb', 'a\nc'), '--- 原文\n+++ 新文\n  a\n- b\n+ c')
  assert.equal(dedupeAndSort('item10\nitem2\nitem2\n', 'ascending', false), 'item2\nitem10')
  assert.equal(convertRadix('-FF', 16, 10), '-255')
  assert.equal(convertRadix('9007199254740993', 10, 16), '20000000000001')
  assert.throws(() => convertRadix('2', 2, 10), /不支持的字符/)
  assert.equal(JSON.parse(testRegex('(a)(b)', '', 'zab')).matches[0].groups.join(','), 'a,b')
  assert.throws(() => testRegex('(', 'g', 'text'), /正则表达式无效/)
})

test('JSON/YAML conversion preserves JSON-compatible values and rejects ambiguous or unsafe numbers', () => {
  const source = '{"name":"工具箱","values":[1,true,null]}'
  const yaml = convertJsonYaml(source, 'json-to-yaml')
  assert.deepEqual(JSON.parse(convertJsonYaml(yaml, 'yaml-to-json')), JSON.parse(source))
  assert.throws(() => convertJsonYaml('{"x":1,"x":2}', 'json-to-yaml'), /重复键/)
  assert.throws(() => convertJsonYaml('{"id":9007199254740993}', 'json-to-yaml'), /精度丢失/)
  assert.throws(() => convertJsonYaml('created: !!timestamp 2024-01-01', 'yaml-to-json'), /无效|JSON/)
})

test('literal replacement is global, supports case choice, and counts matches', () => {
  assert.deepEqual(replaceText('A.a a', 'a', '$&', false), { text: '$&.$& $&', count: 3 })
  assert.deepEqual(replaceText('a a', 'a', 'x', true), { text: 'x x', count: 2 })
  assert.throws(() => replaceText('text', '', 'x', false), /查找/)
})

test('HTTP response parser preserves status and headers while formatting recognized bodies', () => {
  const response = parseHttpResponse('HTTP/1.1 200 OK\r\nContent-Type: application/json; charset=utf-8\r\nX-Trace: local\r\n\r\n{"ok":true}')
  assert.equal(response, 'HTTP/1.1 200 OK\nContent-Type: application/json; charset=utf-8\nX-Trace: local\n\n{\n  "ok": true\n}')
  assert.equal(parseHttpResponse('{"ok":true}'), '{\n  "ok": true\n}')
  assert.equal(parseHttpResponse('{\n\n"ok":true\n}'), '{\n  "ok": true\n}')
  assert.throws(() => parseHttpResponse('HTTP/1.1 200 OK\nContent-Type: application/json\n\n{bad}'), /JSON/)
})

test('JWT parsing is explicitly decode-only and YAML formatting validates input', () => {
  const header = encodeBase64('{"alg":"none"}').replace(/=+$/, '').replaceAll('+', '-').replaceAll('/', '_')
  const payload = encodeBase64('{"sub":"user-1"}').replace(/=+$/, '').replaceAll('+', '-').replaceAll('/', '_')
  const jwt = JSON.parse(decodeJwt(`${header}.${payload}.signature`))
  assert.equal(jwt.payload.sub, 'user-1')
  assert.match(jwt.warning, /未验证签名/)
  assert.throws(() => decodeJwt('bad.token'), /三段/)
  assert.equal(formatYaml('name: Ada\nitems: [1, 2] # keep this comment'), 'name: Ada\nitems: [ 1, 2 ] # keep this comment\n')
  assert.throws(() => formatYaml('x: 1\nx: 2'), /Map keys must be unique/)
})

test('SHA digests use Web Crypto and five-field Cron returns local upcoming times', async () => {
  assert.equal(await hashText('abc', 'SHA-256'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  const runs = nextCronRuns('*/5 * * * *', new Date(2026, 0, 1, 0, 0, 10), 2)
  assert.equal(runs.length, 2)
  assert.throws(() => nextCronRuns('0 0 1 *'), /5 段/)
  assert.throws(() => nextCronRuns('80 * * * *'), /范围/)
})

test('HTTP debugger validates protocols and presents a mock response without requiring network access', async () => {
  await assert.rejects(sendHttpRequest({ method: 'GET', url: 'file:///tmp/data' }, async () => new Response()), /仅支持 HTTP/)
  const result = JSON.parse(await sendHttpRequest({ method: 'POST', url: 'https://example.test/api', headers: 'X-Test: yes', body: '{"ok":true}' }, async (_url, options) => {
    assert.equal(options.method, 'POST')
    assert.equal(options.headers.get('x-test'), 'yes')
    assert.equal(options.body, '{"ok":true}')
    return new Response('accepted', { status: 201, headers: { 'content-type': 'text/plain' } })
  }))
  assert.equal(result.status, 201)
  assert.equal(result.body, 'accepted')
})
