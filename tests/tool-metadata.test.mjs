import assert from 'node:assert/strict'
import test from 'node:test'
import { getTool, historyContent, parseRecentModes, toolGroups, toolModeByExtension } from '../src/core/tool-metadata.ts'

test('tool metadata defines each mode once and drives file inference', () => {
  const modes = toolGroups.flatMap(group => group.tools.map(tool => tool.mode))
  assert.equal(new Set(modes).size, modes.length)
  assert.equal(getTool('timestamp').inputTitle, '时间戳或日期')
  assert.equal(getTool('http').extension, 'txt')
  assert.equal(toolModeByExtension.yml, 'yaml')
  assert.equal(toolModeByExtension.sql, 'sql')
})

test('JWT, HTTP, response parser, and Ping history retain content in session memory', () => {
  for (const mode of ['jwt', 'http', 'response', 'ping']) {
    assert.deepEqual(historyContent(mode, 'request body', 'response body'), { input: 'request body', output: 'response body', redacted: false })
  }
  assert.deepEqual(historyContent('json', '{"ok":true}', '{\n  "ok": true\n}'), {
    input: '{"ok":true}', output: '{\n  "ok": true\n}', redacted: false,
  })
})

test('recent tools restore only unique known modes, capped at four', () => {
  assert.deepEqual(parseRecentModes('["sql","json","sql","unknown","uuid","http","ping"]'), ['sql', 'json', 'uuid', 'http'])
  assert.deepEqual(parseRecentModes('{bad json'), [])
})
