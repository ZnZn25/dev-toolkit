export function parseLocalPort(value: string): number {
  const source = value.trim()
  if (!/^\d+$/.test(source)) throw new Error('端口号必须是 1–65535 的整数')
  const port = Number(source)
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('端口号必须是 1–65535 的整数')
  return port
}
