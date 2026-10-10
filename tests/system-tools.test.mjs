import assert from 'node:assert/strict'
import test from 'node:test'
import { filterLogLines, parseLogLine } from '../src/core/logs.ts'
import { parseLocalPort } from '../src/core/ports.ts'

test('Spring Boot log lines expose level, timestamp, and thread for filtering', () => {
  const info = parseLogLine('2026-10-10T09:30:15.125+08:00  INFO 421 --- [main] app.Start : ready')
  assert.equal(info.level, 'INFO')
  assert.equal(info.thread, 'main')
  assert.equal(info.timestampMs, Date.parse('2026-10-10T01:30:15.125Z'))

  const warning = parseLogLine('2026-10-10 09:31:00,400 WARN 421 --- [worker-2] app.Job : retry')
  assert.equal(warning.level, 'WARN')
  assert.equal(warning.thread, 'worker-2')
  assert.equal(warning.timestampMs, Date.parse('2026-10-10T09:31:00.400'))
  assert.equal(parseLogLine('\u001b[36m2026-10-10 09:31:00 INFO 421 --- [worker-2] app.Job : ready').thread, 'worker-2')
  assert.equal(parseLogLine('stack trace continuation').level, 'OTHER')
})

test('log filters combine keyword, thread, and local time boundaries', () => {
  const entries = [
    parseLogLine('2026-10-10T09:00:00Z ERROR [http-worker] connection refused'),
    parseLogLine('2026-10-10T09:05:00Z INFO [main] startup complete'),
  ]
  assert.deepEqual(filterLogLines(entries, { keyword: 'refused', thread: 'worker', fromMs: Date.parse('2026-10-10T08:59:00Z'), toMs: Date.parse('2026-10-10T09:01:00Z') }), [entries[0]])
  assert.deepEqual(filterLogLines(entries, { keyword: '', thread: 'worker', fromMs: null, toMs: null }), [entries[0]])
})

test('local port validation accepts only decimal ports in range', () => {
  assert.equal(parseLocalPort('9095'), 9095)
  assert.equal(parseLocalPort(' 00080 '), 80)
  for (const value of ['0', '65536', '-1', '80.5', 'abc', '']) assert.throws(() => parseLocalPort(value), /1–65535/)
})
