import { createServer } from 'vite'

const host = '127.0.0.1'
const ports = [8299, 8399, 8499]

let viteServer
for (const port of ports) {
  const candidate = await createServer({ server: { host, port, strictPort: true } })
  try {
    await candidate.listen()
    viteServer = candidate
    break
  } catch (error) {
    await candidate.close().catch(() => {})
    if (!(error instanceof Error) || !error.message.includes(`Port ${port} is already in use`)) throw error
  }
}

if (!viteServer) {
  console.error(`网页开发服务端口 ${ports.join('、')} 均被占用，请关闭占用程序后重试。`)
  process.exit(1)
}

console.log(`网页开发服务已绑定 127.0.0.1（优先顺序：${ports.join(' → ')}）。`)
viteServer.printUrls()

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    void viteServer.close().then(() => process.exit(0), (error) => {
      console.error(`停止网页开发服务失败：${error.message}`)
      process.exit(1)
    })
  })
}
