import { testRegex } from './regex'

type Request = { pattern: string; flags: string; input: string }
type Response = { ok: true; result: string } | { ok: false; error: string }

const workerScope = self as unknown as DedicatedWorkerGlobalScope
workerScope.addEventListener('message', (event: MessageEvent<Request>) => {
  try {
    workerScope.postMessage({ ok: true, result: testRegex(event.data.pattern, event.data.flags, event.data.input) } satisfies Response)
  } catch (error) {
    workerScope.postMessage({ ok: false, error: (error as Error).message || '正则测试失败' } satisfies Response)
  }
})
