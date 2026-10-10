export type LogLevel = 'ERROR' | 'WARN' | 'INFO' | 'OTHER'

export type ParsedLogLine = {
  timestamp: string | null
  timestampMs: number | null
  level: LogLevel
  thread: string
  message: string
}

export type LogFilters = {
  keyword: string
  thread: string
  fromMs: number | null
  toMs: number | null
}

const timestampPrefix = /^(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:[.,]\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})?)/

function timestampValue(source: string): number | null {
  let normalized = source.replace(',', '.')
  normalized = normalized.replace(/\.(\d{3})\d+/, '.$1')
  normalized = normalized.replace(/([+-]\d{2})(\d{2})$/, '$1:$2')
  if (normalized.includes(' ') && !normalized.includes('T')) normalized = normalized.replace(' ', 'T')
  const value = Date.parse(normalized)
  return Number.isFinite(value) ? value : null
}

export function parseLogLine(message: string): ParsedLogLine {
  const timestampText = message.match(timestampPrefix)?.[1] ?? null
  const levelText = message.match(/\b(ERROR|WARN(?:ING)?|INFO)\b/i)?.[1]?.toUpperCase()
  const threadText = message.match(/---\s+\[([^\]\r\n]+)\]/)?.[1]?.trim()
    ?? message.match(/\[([^\]\r\n]+)\]/)?.[1]?.trim()
    ?? ''
  return {
    timestamp: timestampText,
    timestampMs: timestampText ? timestampValue(timestampText) : null,
    level: levelText === 'ERROR' ? 'ERROR' : levelText === 'WARN' || levelText === 'WARNING' ? 'WARN' : levelText === 'INFO' ? 'INFO' : 'OTHER',
    thread: threadText,
    message,
  }
}

export function filterLogLines<T extends ParsedLogLine>(lines: readonly T[], filters: LogFilters): T[] {
  const keyword = filters.keyword.trim().toLocaleLowerCase()
  const thread = filters.thread.trim().toLocaleLowerCase()
  return lines.filter((line) => {
    if (keyword && !line.message.toLocaleLowerCase().includes(keyword)) return false
    if (thread && !line.thread.toLocaleLowerCase().includes(thread)) return false
    if (filters.fromMs !== null && (line.timestampMs === null || line.timestampMs < filters.fromMs)) return false
    if (filters.toMs !== null && (line.timestampMs === null || line.timestampMs > filters.toMs)) return false
    return true
  })
}
