import { parseTree, printParseErrorCode, type Node as JsonNode, type ParseError } from 'jsonc-parser'
import { format as sqlFormat } from 'sql-formatter'

export type IndentStyle = '2' | '4' | 'tab'
export type SqlDialect = 'postgresql' | 'mysql' | 'transactsql'
export type KeywordCase = 'preserve' | 'upper' | 'lower'

export class FormatError extends Error {
  line?: number
  column?: number

  constructor(message: string, line?: number, column?: number) {
    super(message)
    this.name = 'FormatError'
    this.line = line
    this.column = column
  }
}

function indentUnit(style: IndentStyle): string {
  return style === 'tab' ? '\t' : ' '.repeat(Number(style))
}

function parseJson(text: string): JsonNode {
  const errors: ParseError[] = []
  const tree = parseTree(text, errors, { allowTrailingComma: false, disallowComments: true })
  if (errors.length) {
    const issue = errors[0]!
    const before = text.slice(0, issue.offset)
    const lines = before.split(/\r\n|\r|\n/)
    const reason = printParseErrorCode(issue.error).replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()
    throw new FormatError(`JSON ${reason}`, lines.length, (lines.at(-1)?.length ?? 0) + 1)
  }
  if (!tree) throw new FormatError('JSON 内容为空', 1, 1)
  return tree
}

function printJson(node: JsonNode, source: string, unit: string, depth: number, compact: boolean): string {
  const children = node.children ?? []
  const separator = compact ? ',' : ',\n'
  const pad = (level: number) => (compact ? '' : unit.repeat(level))

  if (node.type === 'object') {
    if (!children.length) return '{}'
    const properties = children.map((property) => {
      const [key, value] = property.children ?? []
      if (!key || !value) throw new FormatError('对象成员不完整')
      const keyText = source.slice(key.offset, key.offset + key.length)
      return `${pad(depth + 1)}${keyText}:${compact ? '' : ' '}${printJson(value, source, unit, depth + 1, compact)}`
    })
    return `{${compact ? '' : '\n'}${properties.join(separator)}${compact ? '' : `\n${pad(depth)}`}}`
  }
  if (node.type === 'array') {
    if (!children.length) return '[]'
    const values = children.map((child) => `${pad(depth + 1)}${printJson(child, source, unit, depth + 1, compact)}`)
    return `[${compact ? '' : '\n'}${values.join(separator)}${compact ? '' : `\n${pad(depth)}`}]`
  }

  return source.slice(node.offset, node.offset + node.length)
}

export function formatJson(text: string, style: IndentStyle = '2'): string {
  return printJson(parseJson(text), text, indentUnit(style), 0, false)
}

export function compactJson(text: string): string {
  return printJson(parseJson(text), text, '', 0, true)
}

export function validateJson(text: string): void {
  parseJson(text)
}

export function escapeJsonString(text: string): string {
  return JSON.stringify(text)
}

export function unescapeJsonString(text: string): string {
  const node = parseJson(text)
  if (node.type !== 'string' || typeof node.value !== 'string') throw new FormatError('需要一个 JSON 字符串，例如 "hello\\nworld"')
  return node.value
}

type SqlSettings = { dialect: SqlDialect; keywordCase: KeywordCase; indent: IndentStyle }

function isWordStart(char: string): boolean {
  return /[\p{L}_]/u.test(char)
}

function isWordPart(char: string): boolean {
  return /[\p{L}\p{N}_$]/u.test(char)
}

function scanQuoted(sql: string, start: number, quote: string, doubledQuote: boolean, escapeBackslash: boolean): number {
  for (let index = start + 1; index < sql.length; index += 1) {
    if (escapeBackslash && sql[index] === '\\') { index += 1; continue }
    if (sql[index] !== quote) continue
    if (doubledQuote && sql[index + 1] === quote) {
      index += 1
      continue
    }
    return index + 1
  }
  throw new FormatError(`字符串或引用标识符未闭合（位置 ${start + 1}）`)
}

/**
 * Produces a token signature that ignores whitespace and unquoted identifier
 * casing while retaining operators, quoted values, comments, numbers, and
 * punctuation. This catches formatter rewrites that could change SQL meaning.
 * ponytail: this is a lexical guard, not a full PostgreSQL parser; use a dialect
 * parser if grammar-aware checks become necessary.
 */
function sqlTokenSignature(sql: string, dialect: SqlDialect): string[] {
  const tokens: string[] = []
  const operatorChars = '+-*/<>=~!@#%^&|`?:'
  for (let index = 0; index < sql.length;) {
    const char = sql[index]!
    if (/\s/.test(char)) { index += 1; continue }

    if (sql.startsWith('--', index)) {
      const end = sql.indexOf('\n', index)
      const stop = end < 0 ? sql.length : end
      tokens.push(`comment:${sql.slice(index, stop).replace(/\r$/, '')}`)
      index = stop
      continue
    }
    if (sql.startsWith('/*', index)) {
      let depth = 1
      let cursor = index + 2
      while (cursor < sql.length && depth) {
        if (sql.startsWith('/*', cursor)) { depth += 1; cursor += 2 }
        else if (sql.startsWith('*/', cursor)) { depth -= 1; cursor += 2 }
        else cursor += 1
      }
      if (depth) throw new FormatError(`块注释未闭合（位置 ${index + 1}）`)
      tokens.push(`comment:${sql.slice(index, cursor)}`)
      index = cursor
      continue
    }

    if (char === '$') {
      const dollar = sql.slice(index).match(/^\$([\p{L}_][\p{L}\p{N}_]*)?\$/u)?.[0]
      if (dollar) {
        const end = sql.indexOf(dollar, index + dollar.length)
        if (end < 0) throw new FormatError(`PostgreSQL dollar-quoted 字符串未闭合（位置 ${index + 1}）`)
        const stop = end + dollar.length
        tokens.push(`quoted:${sql.slice(index, stop)}`)
        index = stop
        continue
      }
      if (/^\$\d+/.test(sql.slice(index))) {
        const parameter = sql.slice(index).match(/^\$\d+/)![0]
        tokens.push(`literal:${parameter}`)
        index += parameter.length
        continue
      }
    }

    if (char === '[') {
      let cursor = index + 1
      for (; cursor < sql.length; cursor += 1) {
        if (sql[cursor] === ']' && sql[cursor + 1] === ']') { cursor += 1; continue }
        if (sql[cursor] === ']') break
      }
      if (cursor >= sql.length) throw new FormatError(`方括号标识符未闭合（位置 ${index + 1}）`)
      tokens.push(`quoted:${sql.slice(index, cursor + 1)}`)
      index = cursor + 1
      continue
    }

    if (char === '"' || char === '`' || char === "'") {
      const stop = scanQuoted(sql, index, char, true, dialect === 'mysql' && char !== '"')
      tokens.push(`quoted:${sql.slice(index, stop)}`)
      index = stop
      continue
    }

    if (isWordStart(char)) {
      let stop = index + 1
      while (stop < sql.length && isWordPart(sql[stop]!)) stop += 1
      const word = sql.slice(index, stop)
      if (/^[uU]$/.test(word) && sql[stop] === '&' && (sql[stop + 1] === '"' || sql[stop + 1] === "'")) {
        const quote = sql[stop + 1]!
        const stringEnd = scanQuoted(sql, stop + 1, quote, true, false)
        tokens.push(`quoted:${sql.slice(index, stringEnd)}`)
        index = stringEnd
        continue
      }
      if (/^[eEnNbBxX]$/.test(word) && sql[stop] === "'") {
        const stringEnd = scanQuoted(sql, stop, "'", true, word.toLowerCase() === 'e')
        tokens.push(`quoted:${sql.slice(index, stringEnd)}`)
        index = stringEnd
        continue
      }
      tokens.push(`word:${word.toUpperCase()}`)
      index = stop
      continue
    }

    if (/[0-9]/.test(char)) {
      const number = sql.slice(index).match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/)?.[0] ?? char
      tokens.push(`literal:${number}`)
      index += number.length
      continue
    }

    if (operatorChars.includes(char)) {
      let stop = index + 1
      while (stop < sql.length && operatorChars.includes(sql[stop]!)) stop += 1
      tokens.push(`operator:${sql.slice(index, stop)}`)
      index = stop
      continue
    }

    tokens.push(`punctuation:${char}`)
    index += 1
  }
  return tokens
}

export function formatSql(text: string, settings: SqlSettings): string {
  try {
    if (!text.trim()) return ''
    const result = sqlFormat(text, {
      language: settings.dialect,
      keywordCase: settings.keywordCase,
      identifierCase: 'preserve',
      dataTypeCase: 'preserve',
      functionCase: 'preserve',
      tabWidth: settings.indent === 'tab' ? 1 : Number(settings.indent),
      useTabs: settings.indent === 'tab',
      linesBetweenQueries: 1,
    })
    const before = sqlTokenSignature(text, settings.dialect)
    const after = sqlTokenSignature(result, settings.dialect)
    if (before.length !== after.length || before.some((token, index) => token !== after[index])) {
      throw new FormatError('格式化结果未能通过 SQL 词元一致性检查；已保留原文。')
    }
    return result
  } catch (error) {
    if (error instanceof FormatError) throw error
    throw new FormatError(error instanceof Error ? error.message : 'SQL 格式化失败')
  }
}
