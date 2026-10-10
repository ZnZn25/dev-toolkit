export type UuidFormat = 'standard' | 'uppercase' | 'compact' | 'urn' | 'braces'

export const MAX_UUID_COUNT = 10_000

export function formatUuid(uuid: string, format: UuidFormat): string {
  switch (format) {
    case 'uppercase': return uuid.toUpperCase()
    case 'compact': return uuid.replaceAll('-', '')
    case 'urn': return `urn:uuid:${uuid}`
    case 'braces': return `{${uuid}}`
    default: return uuid
  }
}

export function generateUuidBatch(count: number, format: UuidFormat): string[] {
  if (!Number.isSafeInteger(count) || count < 1 || count > MAX_UUID_COUNT) {
    throw new RangeError(`生成数量必须是 1 到 ${MAX_UUID_COUNT} 之间的整数`)
  }
  return Array.from({ length: count }, () => formatUuid(crypto.randomUUID(), format))
}
