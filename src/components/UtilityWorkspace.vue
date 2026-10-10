<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { Channel, invoke, isTauri } from '@tauri-apps/api/core'
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import CodeEditor from './CodeEditor.vue'
import { getTool, type ToolMode } from '../core/tool-metadata'
import {
  compareText, convertJsonYaml, convertRadix, dateToTimestamp, timestampToDate, decodeBase64, decodeJwt, decodeUrl, dedupeAndSort,
  encodeBase64, encodeUrl, formatXml, formatYaml, hashText, nextCronRuns, parseHttpResponse, replaceText, sendHttpRequest,
} from '../core/utilities'
import { testRegexInWorker } from '../core/regex'

type UtilityMode = Exclude<ToolMode, 'json' | 'sql' | 'uuid' | 'yangyuanhang-run'>
type PingOutput = { chunk: string; done: boolean }
const props = defineProps<{
  mode: UtilityMode
  modelValue: string
  resultValue: string
  theme: 'dark' | 'light'
  fontSize: number
  indentStyle: '2' | '4' | 'tab'
  focusPane: 'input' | 'output' | null
}>()
const emit = defineEmits<{ 'update:modelValue': [value: string]; 'update:resultValue': [value: string]; 'update:focusPane': [value: 'input' | 'output' | null] }>()

const compareTextValue = ref('')
const timestampDirection = ref<'to-date' | 'to-timestamp'>('to-date')
const timestampUnit = ref<'seconds' | 'milliseconds'>('milliseconds')
const codecDirection = ref<'encode' | 'decode'>('encode')
const regexPattern = ref('')
const regexFlags = ref('g')
const hashAlgorithm = ref<'SHA-1' | 'SHA-256' | 'SHA-384' | 'SHA-512'>('SHA-256')
const sortDirection = ref<'ascending' | 'descending'>('ascending')
const caseSensitive = ref(false)
const cronExpression = ref('*/5 * * * *')
const pingTarget = ref('127.0.0.1')
const pingCount = ref(4)
const pingContinuous = ref(false)
const fromRadix = ref(10)
const toRadix = ref(16)
const httpMethod = ref('GET')
const httpUrl = ref('https://')
const httpHeaders = ref('')
const jsonYamlDirection = ref<'json-to-yaml' | 'yaml-to-json'>('json-to-yaml')
const replaceSearch = ref('')
const replacement = ref('')
const replaceCaseSensitive = ref(false)
const replacementCount = ref<number | null>(null)
let pingStopRequested = false
let pingController: AbortController | undefined
const maxPingOutputCharacters = 256 * 1024
watch([replaceSearch, replacement, replaceCaseSensitive, () => props.modelValue], () => { replacementCount.value = null })

function appendPingOutput(output: string, chunk: string): string {
  const combined = output + chunk
  if (combined.length <= maxPingOutputCharacters) return combined
  const marker = '\n[较早的 Ping 输出已省略]\n'
  // ponytail: cap retained long-Ping output at 256 KiB; a virtualized log is the upgrade path.
  return marker + combined.slice(-(maxPingOutputCharacters - marker.length))
}

async function runWebPing(target: string, count: number, continuous: boolean, initialOutput: string): Promise<string> {
  const controller = new AbortController()
  pingController = controller
  let output = initialOutput
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  try {
    const response = await fetch('/__local/ping', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target, count, continuous }),
      signal: controller.signal,
    })
    if (!response.ok) {
      const body = await response.text()
      let message = `Ping 请求失败（${response.status}）`
      try { message = (JSON.parse(body) as { error?: string }).error || message } catch { /* keep status message */ }
      throw new Error(message)
    }
    if (!response.body) throw new Error('当前浏览器不支持读取 Ping 输出流')
    reader = response.body.getReader()
    const decoder = new TextDecoder()
    while (!pingStopRequested) {
      const { value, done } = await reader.read()
      if (done) break
      if (value) {
        output = appendPingOutput(output, decoder.decode(value, { stream: true }))
        emit('update:resultValue', output)
      }
    }
    const remaining = decoder.decode()
    if (remaining && !pingStopRequested) {
      output = appendPingOutput(output, remaining)
      emit('update:resultValue', output)
    }
    return output
  } catch (error) {
    if (pingStopRequested) return output
    throw error
  } finally {
    reader?.releaseLock()
    if (pingController === controller) pingController = undefined
  }
}

async function runPing(): Promise<string> {
  const target = pingTarget.value.trim()
  const continuous = pingContinuous.value
  const count = continuous ? 1 : Number(pingCount.value)
  if (!target) throw new Error('请输入要 Ping 的主机名或 IP 地址')
  if (!continuous && (!Number.isInteger(count) || count < 1 || count > 100)) throw new Error('Ping 次数应为 1–100 的整数')

  pingStopRequested = false
  const initialOutput = continuous ? `正在持续 Ping ${target}，可通过停止按钮结束。\n` : ''
  emit('update:resultValue', initialOutput)
  if (!isTauri()) return runWebPing(target, count, continuous, initialOutput)

  let output = initialOutput
  const channel = new Channel<PingOutput>()
  let finish!: (value: string) => void
  const completed = new Promise<string>((resolve) => { finish = resolve })
  channel.onmessage = (message) => {
    if (message.chunk && !pingStopRequested) {
      output = appendPingOutput(output, message.chunk)
      emit('update:resultValue', output)
    }
    if (message.done) finish(output)
  }
  await invoke<void>('start_ping', { target, count, continuous, onOutput: channel })
  return completed
}

function stopPing() {
  pingStopRequested = true
  pingController?.abort()
  if (isTauri()) void invoke('stop_ping').catch(() => undefined)
}

onBeforeUnmount(stopPing)

async function run(): Promise<string> {
  const value = props.modelValue
  switch (props.mode) {
    case 'timestamp': return timestampDirection.value === 'to-date'
      ? timestampToDate(value, timestampUnit.value)
      : dateToTimestamp(value, timestampUnit.value)
    case 'base64': return codecDirection.value === 'encode' ? encodeBase64(value) : decodeBase64(value)
    case 'url': return codecDirection.value === 'encode' ? encodeUrl(value) : decodeUrl(value)
    case 'diff': return compareText(value, compareTextValue.value)
    case 'regex': return testRegexInWorker(regexPattern.value, regexFlags.value, value)
    case 'hash': return hashText(value, hashAlgorithm.value)
    case 'jwt': return decodeJwt(value)
    case 'dedupe': return dedupeAndSort(value, sortDirection.value, caseSensitive.value)
    case 'xml': return formatXml(value)
    case 'yaml': return formatYaml(value)
    case 'cron': return `本地时区 · 下次运行时间\n${nextCronRuns(cronExpression.value).map((date, index) => `${index + 1}. ${date}`).join('\n')}`
    case 'radix': return convertRadix(value, fromRadix.value, toRadix.value)
    case 'http': return sendHttpRequest({ method: httpMethod.value, url: httpUrl.value, headers: httpHeaders.value, body: value }, isTauri() ? tauriFetch : fetch)
    case 'ping': return runPing()
    case 'replace': {
      const result = replaceText(value, replaceSearch.value, replacement.value, replaceCaseSensitive.value)
      replacementCount.value = result.count
      return result.text
    }
    case 'json-yaml': return convertJsonYaml(value, jsonYamlDirection.value, props.indentStyle)
    case 'response': return parseHttpResponse(value, props.indentStyle)
  }
}

function outputExtension(): string {
  return props.mode === 'json-yaml' ? jsonYamlDirection.value === 'json-to-yaml' ? 'yaml' : 'json' : getTool(props.mode).extension
}

function historyInput(): string {
  const input = props.modelValue
  switch (props.mode) {
    case 'timestamp': return `方向：${timestampDirection.value}；单位：${timestampUnit.value}\n${input}`
    case 'base64': case 'url': return `方向：${codecDirection.value}\n${input}`
    case 'diff': return `原文：\n${input}\n\n新文：\n${compareTextValue.value}`
    case 'regex': return `正则：/${regexPattern.value}/${regexFlags.value}\n${input}`
    case 'hash': return `算法：${hashAlgorithm.value}\n${input}`
    case 'dedupe': return `排序：${sortDirection.value}；区分大小写：${caseSensitive.value ? '是' : '否'}\n${input}`
    case 'cron': return cronExpression.value
    case 'radix': return `进制：${fromRadix.value} → ${toRadix.value}\n${input}`
    case 'http': return `${httpMethod.value} ${httpUrl.value}\n请求头：\n${httpHeaders.value}\n请求正文：\n${input}`
    case 'ping': return `目标：${pingTarget.value}；${pingContinuous.value ? '长 Ping' : `次数：${pingCount.value}`}`
    case 'replace': return `查找：${replaceSearch.value}\n替换为：${replacement.value}\n输入：\n${input}`
    case 'json-yaml': return `方向：${jsonYamlDirection.value}\n${input}`
    default: return input
  }
}

defineExpose({ run, stop: stopPing, outputExtension, historyInput })
</script>

<template>
  <article class="editor-panel input-panel utility-input-panel">
    <div class="panel-heading">
      <div class="panel-title"><span class="panel-dot source-dot"></span><strong>{{ getTool(mode).inputTitle }}</strong><span class="panel-tag">{{ mode.toUpperCase() }}</span></div>
      <div class="panel-tools"><span class="hint">{{ mode === 'http' ? isTauri() ? '桌面端仅在发送时联网' : '浏览器预览受 CORS 限制' : mode === 'ping' ? '仅在开始 Ping 时联网' : '本地处理' }}</span><button class="panel-action" :title="focusPane === 'input' ? '退出最大化' : '最大化编辑区'" @click="emit('update:focusPane', focusPane === 'input' ? null : 'input')">{{ focusPane === 'input' ? '⤢' : '⛶' }}</button></div>
    </div>
    <Transition name="pane-content" mode="out-in"><div :key="mode" class="utility-config">
      <template v-if="mode === 'timestamp'">
        <select v-model="timestampDirection" aria-label="时间戳转换方向"><option value="to-date">时间戳 → 日期</option><option value="to-timestamp">日期 → 时间戳</option></select>
        <select v-model="timestampUnit" aria-label="时间戳单位"><option value="milliseconds">毫秒</option><option value="seconds">秒</option></select>
      </template>
      <template v-else-if="mode === 'base64' || mode === 'url'">
        <select v-model="codecDirection" aria-label="编解码方向"><option value="encode">编码</option><option value="decode">解码</option></select>
        <span class="hint">{{ mode === 'base64' ? 'UTF-8 文本' : '完整文本组件' }}</span>
      </template>
      <template v-else-if="mode === 'regex'">
        <label>正则 <input v-model="regexPattern" type="text" placeholder="例如：\\b\w+\\b" /></label>
        <label>Flags <input v-model="regexFlags" class="short-field" type="text" placeholder="gim" /></label>
      </template>
      <template v-else-if="mode === 'hash'">
        <label>算法 <select v-model="hashAlgorithm"><option>SHA-1</option><option>SHA-256</option><option>SHA-384</option><option>SHA-512</option></select></label>
      </template>
      <template v-else-if="mode === 'dedupe'">
        <label>排序 <select v-model="sortDirection"><option value="ascending">升序</option><option value="descending">降序</option></select></label>
        <label class="check-setting"><input v-model="caseSensitive" type="checkbox" />区分大小写</label>
      </template>
      <template v-else-if="mode === 'cron'">
        <label>Cron <input v-model="cronExpression" type="text" placeholder="分 时 日 月 周" /></label>
        <span class="hint">标准 5 段 · 本地时区</span>
      </template>
      <template v-else-if="mode === 'radix'">
        <label>从 <select v-model.number="fromRadix"><option :value="2">2 进制</option><option :value="8">8 进制</option><option :value="10">10 进制</option><option :value="16">16 进制</option></select></label>
        <label>到 <select v-model.number="toRadix"><option :value="2">2 进制</option><option :value="8">8 进制</option><option :value="10">10 进制</option><option :value="16">16 进制</option></select></label>
      </template>
      <template v-else-if="mode === 'http'">
        <select v-model="httpMethod" aria-label="HTTP 方法"><option>GET</option><option>POST</option><option>PUT</option><option>PATCH</option><option>DELETE</option><option>HEAD</option><option>OPTIONS</option></select>
        <input v-model="httpUrl" class="url-field" type="url" aria-label="请求 URL" placeholder="https://example.com/api" />
      </template>
      <template v-else-if="mode === 'ping'">
        <label>目标 <input v-model="pingTarget" class="ping-target" type="text" autocomplete="off" spellcheck="false" placeholder="主机名或 IP 地址" /></label>
        <label>次数 <input v-model.number="pingCount" class="short-field" type="number" min="1" max="100" :disabled="pingContinuous" /></label>
        <label class="check-setting"><input v-model="pingContinuous" type="checkbox" />长 Ping</label>
        <span class="hint">持续发送，点击“停止 Ping”结束</span>
      </template>
      <template v-else-if="mode === 'replace'">
        <label>查找 <input v-model="replaceSearch" type="text" placeholder="要查找的文本" /></label>
        <label>替换为 <input v-model="replacement" type="text" placeholder="替换内容" /></label>
        <label class="check-setting"><input v-model="replaceCaseSensitive" type="checkbox" />区分大小写</label>
        <span v-if="replacementCount !== null" class="hint">已替换 {{ replacementCount.toLocaleString() }} 处</span>
      </template>
      <template v-else-if="mode === 'json-yaml'">
        <select v-model="jsonYamlDirection" aria-label="JSON YAML 转换方向"><option value="json-to-yaml">JSON → YAML</option><option value="yaml-to-json">YAML → JSON</option></select>
        <span class="hint">只转换 JSON 兼容的数据类型</span>
      </template>
      <template v-else-if="mode === 'diff'">
        <span class="hint">逐行比较 · 修改、删除与新增</span>
      </template>
      <template v-else-if="mode === 'xml' || mode === 'yaml'">
        <span class="hint">校验并规范缩进；解析完全在本机完成</span>
      </template>
      <template v-else-if="mode === 'jwt'">
        <span class="hint">仅解析 Header / Payload，不验证签名或声明</span>
      </template>
      <template v-else-if="mode === 'response'">
        <span class="hint">本地解析状态行、响应头与 JSON / XML / YAML 正文</span>
      </template>
    </div></Transition>
    <Transition name="pane-content"><label v-if="mode === 'http'" class="utility-multiline-setting">请求头（每行 `名称: 值`）<textarea v-model="httpHeaders" placeholder="Content-Type: application/json"></textarea></label></Transition>
    <Transition name="pane-content" mode="out-in"><div v-if="mode === 'diff'" key="diff-inputs" class="utility-diff-source">
      <div class="utility-subheading">原文</div>
      <CodeEditor :model-value="modelValue" language="plaintext" :theme="theme" :font-size="fontSize" :indent-style="indentStyle" @update:model-value="emit('update:modelValue', $event)" />
      <div class="utility-subheading">新文</div>
      <CodeEditor v-model="compareTextValue" language="plaintext" :theme="theme" :font-size="fontSize" :indent-style="indentStyle" />
    </div>
    <CodeEditor v-else key="utility-input" :model-value="modelValue" language="plaintext" :theme="theme" :font-size="fontSize" :indent-style="indentStyle" @update:model-value="emit('update:modelValue', $event)" />
    </Transition>
  </article>
  <div class="split-rail"><span></span><span class="rail-grip">•••</span><span></span></div>
  <article class="editor-panel output-panel">
    <div class="panel-heading">
      <div class="panel-title"><span class="panel-dot result-dot"></span><strong>{{ mode === 'diff' ? 'Diff 结果' : mode === 'http' ? '响应' : mode === 'ping' ? 'Ping 结果' : mode === 'response' ? '解析结果' : '处理结果' }}</strong><span class="panel-tag result-tag">OUTPUT</span></div>
      <div class="panel-tools"><span class="hint">只读预览</span><button class="panel-action" :title="focusPane === 'output' ? '退出最大化' : '最大化编辑区'" @click="emit('update:focusPane', focusPane === 'output' ? null : 'output')">{{ focusPane === 'output' ? '⤢' : '⛶' }}</button></div>
    </div>
    <div class="output-content">
      <CodeEditor :model-value="resultValue" language="plaintext" :theme="theme" :font-size="fontSize" :indent-style="indentStyle" read-only />
      <Transition name="empty-state"><div v-if="!resultValue" class="empty-state"><div class="empty-mark">⌘</div><strong>结果会显示在这里</strong><span>{{ mode === 'ping' ? '输入主机名或 IP 地址后开始 Ping' : '点击工具栏中的“执行”' }}</span></div></Transition>
    </div>
  </article>
</template>

<style scoped>
.utility-config { display: flex; align-items: center; gap: 8px; min-width: 0; min-height: 39px; padding: 5px 12px; border-bottom: 1px solid var(--line-soft); background: var(--panel); overflow-x: auto; }
.utility-config label { display: inline-flex; align-items: center; gap: 6px; flex: 0 0 auto; color: var(--muted); font-size: 10px; white-space: nowrap; }
.utility-config select, .utility-config input:not([type="checkbox"]) { min-width: 96px; height: 27px; padding: 0 7px; border: 1px solid var(--line); border-radius: 5px; color: var(--text); background: var(--panel-raised); font: inherit; font-size: 10px; }
.utility-config input.short-field { width: 62px; min-width: 62px; }
.utility-config input.ping-target { width: clamp(140px, 22vw, 280px); }
.utility-config .url-field { flex: 1 1 180px; min-width: 130px !important; }
.utility-config .check-setting { gap: 5px; }
.utility-config input[type="checkbox"] { accent-color: var(--accent); }
.utility-multiline-setting { display: flex; align-items: center; gap: 8px; min-height: 44px; padding: 6px 12px; border-bottom: 1px solid var(--line-soft); color: var(--muted); background: var(--panel); font-size: 10px; }
.utility-multiline-setting textarea { flex: 1; min-width: 0; height: 30px; resize: vertical; padding: 6px 8px; border: 1px solid var(--line); border-radius: 5px; color: var(--text); background: var(--panel-raised); font: 10px/1.4 "Cascadia Code", Consolas, monospace; }
.utility-diff-source { display: grid; grid-template-rows: 22px minmax(0, 1fr) 22px minmax(0, 1fr); min-height: 0; overflow: hidden; }
.utility-subheading { display: flex; align-items: center; padding: 0 12px; border-bottom: 1px solid var(--line-soft); color: var(--muted); background: var(--panel); font-size: 9px; }
.utility-diff-source :deep(.editor-host) { min-height: 0; }
.utility-input-panel { grid-template-rows: 42px auto minmax(0, 1fr); }
.utility-input-panel:has(.utility-multiline-setting) { grid-template-rows: 42px auto 44px minmax(0, 1fr); }
.utility-input-panel:has(.utility-diff-source) { grid-template-rows: 42px auto minmax(0, 1fr); }
</style>
