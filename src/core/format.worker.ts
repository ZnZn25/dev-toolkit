import { compactJson, escapeJsonString, formatJson, formatSql, unescapeJsonString, validateJson, type IndentStyle, type KeywordCase, type SqlDialect } from './formatters'

type Request = {
  id: number
  action: 'format-json' | 'compact-json' | 'validate-json' | 'escape-json' | 'unescape-json' | 'format-sql'
  text: string
  options?: { indent?: IndentStyle; dialect?: SqlDialect; keywordCase?: KeywordCase }
}

type Response = { id: number; ok: true; result?: string } | { id: number; ok: false; error: string; line?: number; column?: number }

const workerScope = self as unknown as DedicatedWorkerGlobalScope
workerScope.addEventListener('message', (event: MessageEvent<Request>) => {
  const request = event.data
  try {
    let result: string | undefined
    switch (request.action) {
      case 'format-json': result = formatJson(request.text, request.options?.indent ?? '2'); break
      case 'compact-json': result = compactJson(request.text); break
      case 'validate-json': validateJson(request.text); break
      case 'escape-json': result = escapeJsonString(request.text); break
      case 'unescape-json': result = unescapeJsonString(request.text); break
      case 'format-sql': result = formatSql(request.text, {
        dialect: request.options?.dialect ?? 'postgresql',
        keywordCase: request.options?.keywordCase ?? 'preserve',
        indent: request.options?.indent ?? '2',
      }); break
    }
    workerScope.postMessage({ id: request.id, ok: true, result } satisfies Response)
  } catch (error) {
    const issue = error as { message?: string; line?: number; column?: number }
    workerScope.postMessage({
      id: request.id,
      ok: false,
      error: issue.message ?? '格式化失败',
      line: issue.line,
      column: issue.column,
    } satisfies Response)
  }
})
