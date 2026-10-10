import assert from 'node:assert/strict'
import test from 'node:test'
import { compactJson, escapeJsonString, formatJson, formatSql, unescapeJsonString, validateJson } from '../src/core/formatters.ts'

test('JSON formatter keeps exact number lexemes, duplicate keys, Unicode, and escapes', () => {
  const input = String.raw`{"id":9007199254740993,"id":2,"unicode":"\u4e2d\u6587","literal":"a\nb","nested":[true,null,{}]}`
  const pretty = formatJson(input, '4')
  assert.match(pretty, /9007199254740993/)
  assert.equal((pretty.match(/"id"/g) ?? []).length, 2)
  assert.match(pretty, /\\u4e2d\\u6587/)
  assert.match(pretty, /"literal": "a\\nb"/)
  assert.deepEqual(JSON.parse(pretty), JSON.parse(input))
  assert.match(pretty, /^\{\r?\n {4}"id"/)
})

test('JSON compacting removes layout whitespace only', () => {
  const compact = compactJson(' { "text" : " keep  spaces ", "items" : [ 1, 2 ] } ')
  assert.equal(compact, '{"text":" keep  spaces ","items":[1,2]}')
  assert.equal(compactJson('{"empty":{},"list":[]}'), '{"empty":{},"list":[]}')
})

test('JSON validation is strict and reports a source location', () => {
  assert.doesNotThrow(() => validateJson('{"valid":[1,true,null]}'))
  for (const invalid of ['{"a":1,}', '{/*comment*/"a":1}', '{"a":]']) {
    assert.throws(() => formatJson(invalid), (error) => Number.isInteger(error.line) && Number.isInteger(error.column) && error.message.startsWith('JSON '))
  }
  assert.throws(() => validateJson('{\r\n  "ok": true,\r\n  "bad":,\r\n}'), (error) => error.line === 3 && error.column === 9)
})

test('large JSON payloads format without parsing values back through JavaScript numbers', () => {
  const input = JSON.stringify(Array.from({ length: 2_000 }, (_, id) => ({ id, text: `记录-${id}-🧪`, enabled: id % 2 === 0 })))
  const output = formatJson(input, '2')
  assert.equal(JSON.parse(output).length, 2_000)
  assert.match(output, /记录-1999-🧪/)
})

test('JSON string escape and unescape roundtrip Unicode and controls', () => {
  const source = '你好\n"\t😀'
  assert.equal(unescapeJsonString(escapeJsonString(source)), source)
  assert.throws(() => unescapeJsonString('42'), /需要一个 JSON 字符串/)
})

test('PostgreSQL formatting preserves comments, identifiers, parameters, casts and JSON operators', () => {
  const input = String.raw`select distinct on ("UserId") "UserId", payload->>'name' as "displayName", payload #>> '{meta,city}' as city
from "User" where payload @> '{"active":true}'::jsonb and score >= $1 -- keep this note
order by "UserId", created_at desc;`
  const output = formatSql(input, { dialect: 'postgresql', keywordCase: 'upper', indent: '2' })
  assert.match(output, /SELECT\s+DISTINCT\s+ON/i)
  assert.match(output, /"UserId"/)
  assert.match(output, /payload\s*->>\s*'name'/)
  assert.match(output, /#>>/)
  assert.match(output, /::jsonb/)
  assert.match(output, /\$1/)
  assert.match(output, /-- keep this note/)
  assert.match(output, /@>/)
})

test('PostgreSQL insert/update/delete, returning, conflict, and multiple statements format', () => {
  const input = `insert into events(id, body) values (1, '{"x":1}') on conflict (id) do update set body = excluded.body returning id;\nupdate events set body = $1 where id = $2;\ndelete from events where id = $3;`
  const output = formatSql(input, { dialect: 'postgresql', keywordCase: 'lower', indent: 'tab' })
  assert.match(output, /on conflict/i)
  assert.match(output, /returning/i)
  assert.match(output, /update events/i)
  assert.match(output, /delete from events/i)
  assert.match(output, /\$3/)
  assert.equal((output.match(/;/g) ?? []).length, 3)
})

test('PostgreSQL CREATE TABLE and ALTER TABLE keep DDL values and identifiers', () => {
  const input = `create table public.users (id bigint generated always as identity primary key, meta jsonb not null default '{}'::jsonb, "displayName" text);\nalter table public.users add column active boolean default true;`
  const output = formatSql(input, { dialect: 'postgresql', keywordCase: 'upper', indent: '4' })
  assert.match(output, /CREATE TABLE/i)
  assert.match(output, /ALTER TABLE/i)
  assert.match(output, /"displayName"/)
  assert.match(output, /'\{\}'::jsonb/)
  assert.match(output, /DEFAULT\s+TRUE/i)
  assert.equal((output.match(/;/g) ?? []).length, 2)
})

test('SQL string values and quoted identifiers remain unchanged', () => {
  const input = String.raw`select 'SELECT  -- literal  ' as "MiX", E'line\nnext' from "T" /* preserve  block */`
  const output = formatSql(input, { dialect: 'postgresql', keywordCase: 'upper', indent: '2' })
  assert.match(output, /'SELECT  -- literal  '/)
  assert.match(output, /E'line\\nnext'/)
  assert.match(output, /"MiX"/)
  assert.match(output, /\/\* preserve  block \*\//)
})

test('PostgreSQL Unicode escape strings and identifiers remain lexically attached to U&', () => {
  const input = String.raw`select U&"d\0061t" as U&"na\006de", U&'\0061' from records`
  const output = formatSql(input, { dialect: 'postgresql', keywordCase: 'upper', indent: '2' })
  assert.match(output, /U&"d\\0061t"/)
  assert.match(output, /U&"na\\006de"/)
  assert.match(output, /U&'\\0061'/)
})

test('MySQL and SQL Server dialects preserve their quoted identifiers and values', () => {
  const mysql = formatSql(String.raw`select ` + '`Order`' + String.raw`, name from orders where name='say \'yes\'' on duplicate key update ` + '`Order`' + String.raw` = 2`, { dialect: 'mysql', keywordCase: 'upper', indent: '2' })
  assert.match(mysql, /`Order`/)
  assert.match(mysql, /ON DUPLICATE KEY UPDATE/)

  const sqlServer = String.raw`select top (10) [Order], N'North' as [Region] from [Sales]`
  const formattedServer = formatSql(sqlServer, { dialect: 'transactsql', keywordCase: 'upper', indent: '2' })
  assert.match(formattedServer, /\[Order\]/)
  assert.match(formattedServer, /N'North'/)
  assert.match(formattedServer, /\[Sales\]/)
})
