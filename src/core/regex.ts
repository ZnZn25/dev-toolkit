export function testRegex(pattern: string, flags: string, input: string): string {
  let expression: RegExp
  try { expression = new RegExp(pattern, flags.includes('g') ? flags : `${flags}g`) }
  catch (error) { throw new Error(`正则表达式无效：${(error as Error).message}`) }
  const matches: Array<{ index: number; match: string; groups: string[] }> = []
  for (let match = expression.exec(input); match; match = expression.exec(input)) {
    matches.push({ index: match.index, match: match[0], groups: match.slice(1) })
    if (matches.length >= 1000) break
    if (match[0] === '') {
      const codePoint = input.codePointAt(expression.lastIndex)
      expression.lastIndex += expression.unicode && codePoint !== undefined && codePoint > 0xffff ? 2 : 1
    }
  }
  const truncated = matches.length === 1000 && expression.exec(input) !== null
  return JSON.stringify({ count: matches.length, truncated, matches }, null, 2)
}

type WorkerResponse = { ok: true; result: string } | { ok: false; error: string }

export function testRegexInWorker(pattern: string, flags: string, input: string): Promise<string> {
  const worker = new Worker(new URL('./regex.worker.ts', import.meta.url), { type: 'module' })
  return new Promise((resolve, reject) => {
    // ponytail: cap regex evaluation at one second to keep pathological backtracking from hanging the app; use a linear-time engine if more complex patterns need guaranteed runtime.
    const timer = setTimeout(() => finish(new Error('正则执行超时（1 秒）；请简化模式或缩短输入')), 1000)
    let settled = false
    function finish(error?: Error, result?: string) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      worker.terminate()
      if (error) reject(error)
      else resolve(result ?? '')
    }
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      if (event.data.ok) finish(undefined, event.data.result)
      else finish(new Error(event.data.error))
    }
    worker.onerror = (event) => finish(new Error(event.message || '正则工作线程异常'))
    try { worker.postMessage({ pattern, flags, input }) }
    catch (error) { finish(error as Error) }
  })
}
