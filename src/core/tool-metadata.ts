type ToolDefinition = {
  mode: string
  name: string
  label: string
  icon: string
  inputTitle: string
  extension: string
  fileExtensions: readonly string[]
  core: boolean
  historyPolicy: 'content' | 'metadata'
  shortcut?: string
}

type ToolGroup = { label: string; tools: readonly ToolDefinition[] }

export const toolGroups = [
  { label: '数据格式化', tools: [
    { mode: 'json', name: 'JSON', label: 'JSON', icon: '{ }', inputTitle: '原始输入', extension: 'json', fileExtensions: ['json'], core: true, historyPolicy: 'content', shortcut: '1' },
    { mode: 'sql', name: 'SQL', label: 'SQL', icon: '▤', inputTitle: '原始输入', extension: 'sql', fileExtensions: ['sql'], core: true, historyPolicy: 'content', shortcut: '2' },
    { mode: 'xml', name: 'XML', label: 'XML', icon: '</>', inputTitle: 'XML 源文', extension: 'xml', fileExtensions: ['xml'], core: false, historyPolicy: 'content' },
    { mode: 'yaml', name: 'YAML', label: 'YAML', icon: 'Y', inputTitle: 'YAML 源文', extension: 'yaml', fileExtensions: ['yaml', 'yml'], core: false, historyPolicy: 'content' },
  ] },
  { label: '编码与加密', tools: [
    { mode: 'base64', name: 'Base64', label: 'Base64', icon: '64', inputTitle: '待编解码文本', extension: 'txt', fileExtensions: [], core: false, historyPolicy: 'content' },
    { mode: 'url', name: 'URL 编解码', label: 'URL', icon: '↗', inputTitle: '待编解码文本', extension: 'txt', fileExtensions: [], core: false, historyPolicy: 'content' },
    { mode: 'hash', name: 'Hash', label: 'Hash', icon: '#', inputTitle: '待计算文本', extension: 'txt', fileExtensions: [], core: false, historyPolicy: 'content' },
    { mode: 'jwt', name: 'JWT 解析', label: 'JWT 解析', icon: 'JWT', inputTitle: 'JWT Token', extension: 'txt', fileExtensions: [], core: false, historyPolicy: 'content' },
  ] },
  { label: '开发辅助', tools: [
    { mode: 'uuid', name: 'UUID', label: 'UUID', icon: '#', inputTitle: '生成设置', extension: 'txt', fileExtensions: [], core: true, historyPolicy: 'content' },
    { mode: 'timestamp', name: '时间戳转换', label: '时间戳', icon: '◷', inputTitle: '时间戳或日期', extension: 'txt', fileExtensions: [], core: false, historyPolicy: 'content' },
    { mode: 'cron', name: 'Cron 表达式', label: 'Cron', icon: '◴', inputTitle: 'Cron 表达式', extension: 'txt', fileExtensions: [], core: false, historyPolicy: 'content' },
    { mode: 'regex', name: '正则测试', label: '正则', icon: '.*', inputTitle: '待测试文本', extension: 'txt', fileExtensions: [], core: false, historyPolicy: 'content' },
  ] },
  { label: '文本工具', tools: [
    { mode: 'diff', name: '文本 Diff', label: '文本 Diff', icon: '±', inputTitle: '原文', extension: 'txt', fileExtensions: [], core: false, historyPolicy: 'content' },
    { mode: 'dedupe', name: '文本去重与排序', label: '去重排序', icon: '≡', inputTitle: '待去重与排序行', extension: 'txt', fileExtensions: [], core: false, historyPolicy: 'content' },
    { mode: 'replace', name: '文本替换', label: '替换', icon: '⇄', inputTitle: '待查找与替换文本', extension: 'txt', fileExtensions: [], core: false, historyPolicy: 'content' },
  ] },
  { label: '数据转换', tools: [
    { mode: 'radix', name: '进制转换', label: '进制转换', icon: '₁₀', inputTitle: '待转换整数', extension: 'txt', fileExtensions: [], core: false, historyPolicy: 'content' },
    { mode: 'json-yaml', name: 'JSON ↔ YAML', label: 'JSON ↔ YAML', icon: '↔', inputTitle: 'JSON / YAML 源文', extension: 'json', fileExtensions: [], core: false, historyPolicy: 'content' },
  ] },
  { label: '接口调试', tools: [
    { mode: 'ping', name: 'Ping', label: 'Ping', icon: '↗', inputTitle: 'Ping 目标', extension: 'txt', fileExtensions: [], core: false, historyPolicy: 'content' },
    { mode: 'http', name: 'HTTP 请求', label: 'HTTP 请求', icon: '⇄', inputTitle: '请求 Body', extension: 'txt', fileExtensions: [], core: false, historyPolicy: 'content' },
    { mode: 'response', name: 'HTTP 响应解析', label: '响应解析', icon: '⇣', inputTitle: 'HTTP 原始响应或响应正文', extension: 'txt', fileExtensions: [], core: false, historyPolicy: 'content' },
  ] },
] as const satisfies readonly ToolGroup[]

export type ToolMode = typeof toolGroups[number]['tools'][number]['mode']
export type ToolInfo = ToolDefinition & { mode: ToolMode }
export type ToolGroupInfo = { label: string; tools: readonly ToolInfo[] }

export const toolByMode = Object.fromEntries(
  toolGroups.flatMap(group => group.tools.map(tool => [tool.mode, tool])),
) as unknown as Record<ToolMode, ToolInfo>

export const toolModeByExtension = Object.fromEntries(
  toolGroups.flatMap(group => group.tools.flatMap(tool => tool.fileExtensions.map(extension => [extension, tool.mode]))),
) as Partial<Record<string, ToolMode>>

export function getTool(mode: ToolMode): ToolInfo {
  return toolByMode[mode]
}

export function parseRecentModes(serialized: string | null): ToolMode[] {
  try {
    const candidate: unknown = JSON.parse(serialized ?? '[]')
    if (!Array.isArray(candidate)) return []
    const modes: ToolMode[] = []
    for (const value of candidate) {
      if (typeof value === 'string' && Object.hasOwn(toolByMode, value) && !modes.includes(value as ToolMode)) {
        modes.push(value as ToolMode)
        if (modes.length === 4) break
      }
    }
    return modes
  } catch { return [] }
}

export function historyContent(mode: ToolMode, input: string, output: string) {
  return getTool(mode).historyPolicy === 'metadata'
    ? { input: '', output: '', redacted: true }
    : { input, output, redacted: false }
}
