export type FormatAction = 'format-json' | 'compact-json' | 'validate-json' | 'escape-json' | 'unescape-json' | 'format-sql'
export type FormatOptions = { indent?: '2' | '4' | 'tab'; dialect?: 'postgresql' | 'mysql' | 'transactsql'; keywordCase?: 'preserve' | 'upper' | 'lower' }

type WorkerResponse = { id: number; ok: true; result?: string } | { id: number; ok: false; error: string; line?: number; column?: number }

export class FormatterWorker {
  private readonly worker = new Worker(new URL('./format.worker.ts', import.meta.url), { type: 'module' })
  private nextId = 1
  private readonly pending = new Map<number, { resolve: (value: string | undefined) => void; reject: (reason: Error & { line?: number; column?: number }) => void }>()

  constructor() {
    this.worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
      const pending = this.pending.get(event.data.id)
      if (!pending) return
      this.pending.delete(event.data.id)
      if (event.data.ok) pending.resolve(event.data.result)
      else {
        const error = Object.assign(new Error(event.data.error), { line: event.data.line, column: event.data.column })
        pending.reject(error)
      }
    })
    this.worker.addEventListener('error', () => {
      for (const pending of this.pending.values()) pending.reject(new Error('格式化工作线程异常退出'))
      this.pending.clear()
    })
  }

  run(action: FormatAction, text: string, options?: FormatOptions): Promise<string | undefined> {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.worker.postMessage({ id, action, text, options })
    })
  }

  dispose(): void {
    this.worker.terminate()
    for (const pending of this.pending.values()) pending.reject(new Error('格式化工作线程已关闭'))
    this.pending.clear()
  }
}
