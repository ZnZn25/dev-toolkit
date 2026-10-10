<script setup lang="ts">
import packageJson from '../package.json'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { isTauri } from '@tauri-apps/api/core'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { open as openDialog, save as saveDialog, confirm } from '@tauri-apps/plugin-dialog'
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'
import CodeEditor from './components/CodeEditor.vue'
import UtilityWorkspace from './components/UtilityWorkspace.vue'
import { FormatterWorker, type FormatAction } from './core/format-worker-client'
import { getTool, historyContent, parseRecentModes, toolGroups, toolModeByExtension, type ToolInfo, type ToolMode } from './core/tool-metadata'
import { generateUuidBatch, type UuidFormat } from './core/uuid'

type Mode = ToolMode
type UtilityMode = Exclude<Mode, 'json' | 'sql' | 'uuid'>
type Theme = 'dark' | 'light'
type Pane = 'input' | 'output' | null
type EditorHandle = { focus: () => void; hasTextFocus: () => boolean }
type UtilityHandle = { run: () => Promise<string>; stop: () => void; outputExtension: () => string; historyInput: () => string }
type HistoryEntry = { id: number; createdAt: number; mode: Mode; operation: string; input: string; output: string; ok: boolean; redacted: boolean }
type AppSettings = { indent: '2' | '4' | 'tab'; keywordCase: 'preserve' | 'upper' | 'lower'; dialect: 'postgresql' | 'mysql' | 'transactsql'; theme: Theme; fontSize: number }

const appVersion = packageJson.version
const defaultSettings: AppSettings = { indent: '2', keywordCase: 'upper', dialect: 'postgresql', theme: 'dark', fontSize: 13 }
const loadSettings = (): AppSettings => {
  try {
    const saved = JSON.parse(localStorage.getItem('local-format-studio.settings') ?? '{}')
    return {
      indent: ['2', '4', 'tab'].includes(saved.indent) ? saved.indent : defaultSettings.indent,
      keywordCase: ['preserve', 'upper', 'lower'].includes(saved.keywordCase) ? saved.keywordCase : defaultSettings.keywordCase,
      dialect: ['postgresql', 'mysql', 'transactsql'].includes(saved.dialect) ? saved.dialect : defaultSettings.dialect,
      theme: ['dark', 'light'].includes(saved.theme) ? saved.theme : defaultSettings.theme,
      fontSize: [12, 13, 14, 15, 16].includes(saved.fontSize) ? saved.fontSize : defaultSettings.fontSize,
    }
  }
  catch { return defaultSettings }
}

const settings = ref<AppSettings>(loadSettings())
const mode = ref<Mode>('json')
const historyOpen = ref(false)
const historyEntries = ref<HistoryEntry[]>([])
const openHistoryEntries = ref<number[]>([])
const currentHistoryEntries = computed(() => historyEntries.value.filter(entry => entry.mode === mode.value))
const currentHistoryCount = computed(() => currentHistoryEntries.value.length)
const historyGroups = computed(() => {
  const groups = new Map<string, { label: string; entries: HistoryEntry[] }>()
  for (const entry of currentHistoryEntries.value) {
    const date = new Date(entry.createdAt)
    const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
    let group = groups.get(key)
    if (!group) {
      group = { label: date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }), entries: [] }
      groups.set(key, group)
    }
    group.entries.push(entry)
  }
  return [...groups.values()]
})
const toolSearch = ref('')
const toolSearchInput = ref<HTMLInputElement>()
const hasToolSearch = computed(() => Boolean(toolSearch.value.trim()))
const loadRecentModes = () => {
  try { return parseRecentModes(localStorage.getItem('local-format-studio.recent-modes')) }
  catch { return [] }
}
const recentModes = ref<Mode[]>(loadRecentModes())
const recentExpanded = ref(recentModes.value.length > 0)
const recentTools = computed(() => recentModes.value.map(getTool))
const filteredToolGroups = computed(() => {
  const query = toolSearch.value.trim().toLocaleLowerCase()
  const groups: { label: string; tools: ToolInfo[] }[] = toolGroups.map(group => ({
    label: group.label,
    tools: group.tools.filter(tool => !query || `${tool.label} ${tool.name} ${tool.mode} ${group.label}`.toLocaleLowerCase().includes(query)),
  }))
  return groups.filter(group => group.tools.length)
})
const utilityMode = computed(() => mode.value as UtilityMode)
const uuidFormat = ref<UuidFormat>('standard')
const uuidCount = ref<number | string>(10)
const sourceText = ref('')
const resultText = ref('')
const resultSearch = ref('')
const resultSearchCount = ref(0)
const resultSearchCapped = ref(false)
const resultLanguage = ref<'json' | 'sql' | 'plaintext'>('json')
const state = ref<'ready' | 'success' | 'error'>('ready')
const statusMessage = ref('就绪 · 内容仅在本机处理')
const errorLocation = ref<{ line?: number; column?: number }>()
const busy = ref(false)
const toast = ref('')
const focusPane = ref<Pane>(null)
const dragging = ref(false)
const inputEditor = ref<EditorHandle>()
const outputEditor = ref<EditorHandle>()
const utilityWorkspace = ref<UtilityHandle>()
const moreMenu = ref<HTMLElement>()
const settingsMenu = ref<HTMLElement>()
const historyMenu = ref<HTMLElement>()
const moreOpen = ref(false)
const settingsOpen = ref(false)
const nativeOpenInput = ref<HTMLInputElement>()
const worker = new FormatterWorker()
let toastTimer: ReturnType<typeof setTimeout> | undefined
let metricsTimer: ReturnType<typeof setTimeout> | undefined
let nextHistoryId = 1
let activeOperationId = 0
let stoppingPingOperationId: number | undefined
const metrics = ref({ lines: 1, bytes: 0 })
const activeText = computed(() => mode.value === 'uuid' ? resultText.value : sourceText.value)
const charCount = computed(() => activeText.value.length)

function notify(message: string) {
  toast.value = message
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toast.value = '' }, 2400)
}

function recordHistory(operationMode: Mode, operation: string, input: string, output: string, ok: boolean) {
  historyEntries.value.unshift({ id: nextHistoryId++, createdAt: Date.now(), mode: operationMode, operation, ...historyContent(operationMode, input, output), ok })
  let retainedCharacters = historyEntries.value.reduce((sum, entry) => sum + entry.input.length + entry.output.length, 0)
  // ponytail: trim older records above 1M characters and 50 entries; a single large latest record stays available, paging can raise this ceiling later.
  while (historyEntries.value.length > 50 || (historyEntries.value.length > 1 && retainedCharacters > 1_000_000)) {
    const removed = historyEntries.value.pop()!
    retainedCharacters -= removed.input.length + removed.output.length
  }
}

function markRecentMode(value: Mode) {
  recentModes.value = [value, ...recentModes.value.filter(mode => mode !== value)].slice(0, 4)
  recentExpanded.value = true
}

function historyTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function toggleHistoryEntry(id: number) {
  openHistoryEntries.value = openHistoryEntries.value.includes(id)
    ? openHistoryEntries.value.filter(value => value !== id)
    : [...openHistoryEntries.value, id]
}

function updateMetrics() {
  if (metricsTimer) clearTimeout(metricsTimer)
  metricsTimer = setTimeout(() => {
    const text = activeText.value
    metrics.value = { lines: (text.match(/\r\n|\r|\n/g)?.length ?? 0) + 1, bytes: new Blob([text]).size }
  }, 120)
}
watch([sourceText, resultText, mode], updateMetrics, { flush: 'post' })
watch(settings, (value) => {
  try { localStorage.setItem('local-format-studio.settings', JSON.stringify(value)) }
  catch { notify('无法保存设置，请检查本机存储空间') }
}, { deep: true })
watch(recentModes, (value) => {
  try { localStorage.setItem('local-format-studio.recent-modes', JSON.stringify(value)) }
  catch { /* Recent tool names are a convenience and can be omitted when storage is unavailable. */ }
})

function options() {
  return { indent: settings.value.indent, dialect: settings.value.dialect, keywordCase: settings.value.keywordCase }
}

function languageForMode(value: Mode): 'json' | 'sql' | 'plaintext' {
  return value === 'json' || value === 'sql' ? value : 'plaintext'
}

async function run(action: FormatAction, successText: string) {
  if (busy.value) return
  const operationMode = mode.value
  markRecentMode(operationMode)
  const operationId = ++activeOperationId
  const input = sourceText.value
  busy.value = true
  errorLocation.value = undefined
  state.value = 'ready'
  statusMessage.value = '正在处理…'
  try {
    const output = await worker.run(action, sourceText.value, options())
    recordHistory(operationMode, successText, input, output ?? successText, true)
    if (operationId === activeOperationId && mode.value === operationMode) {
      if (output !== undefined) {
        resultText.value = output
        resultLanguage.value = action === 'unescape-json' ? 'plaintext' : languageForMode(operationMode)
      }
      state.value = 'success'
      statusMessage.value = successText
    }
  } catch (error) {
    const issue = error as Error & { line?: number; column?: number }
    const message = issue.message || '处理失败'
    recordHistory(operationMode, `${successText}失败`, input, message, false)
    if (operationId === activeOperationId && mode.value === operationMode) {
      state.value = 'error'
      statusMessage.value = message
      errorLocation.value = { line: issue.line, column: issue.column }
    }
  } finally {
    if (operationId === activeOperationId) busy.value = false
  }
}

function format() {
  if (mode.value === 'ping' && busy.value) return stopUtility()
  if (mode.value === 'uuid') return generateUuids()
  if (mode.value !== 'json' && mode.value !== 'sql') return void runUtility()
  return mode.value === 'json'
    ? run('format-json', `JSON 已格式化 · ${settings.value.indent === 'tab' ? 'Tab' : `${settings.value.indent} 空格`}`)
    : run('format-sql', `SQL 已格式化 · ${settings.value.dialect.toUpperCase()}`)
}

async function runUtility() {
  if (busy.value || !utilityWorkspace.value) return
  const runningMode = mode.value
  markRecentMode(runningMode)
  const operationId = ++activeOperationId
  const input = getTool(runningMode).historyPolicy === 'content' ? utilityWorkspace.value.historyInput() : ''
  busy.value = true
  errorLocation.value = undefined
  state.value = 'ready'
  statusMessage.value = '正在处理…'
  try {
    const output = await utilityWorkspace.value.run()
    const message = runningMode === 'ping' && stoppingPingOperationId === operationId ? 'Ping 已停止' : `${getTool(runningMode).name} 已完成`
    recordHistory(runningMode, message, input, output, true)
    if (operationId === activeOperationId && mode.value === runningMode) {
      if (runningMode !== 'ping') resultText.value = output
      resultLanguage.value = 'plaintext'
      state.value = 'success'
      statusMessage.value = message
    }
  } catch (error) {
    const message = (error as Error).message || '处理失败'
    recordHistory(runningMode, `${getTool(runningMode).name} 失败`, input, message, false)
    if (operationId === activeOperationId && mode.value === runningMode) {
      state.value = 'error'
      statusMessage.value = message
    }
  } finally {
    if (operationId === activeOperationId || stoppingPingOperationId === operationId) {
      busy.value = false
      if (stoppingPingOperationId === operationId) stoppingPingOperationId = undefined
    }
  }
}

function stopUtility() {
  if (mode.value !== 'ping' || !busy.value) return
  stoppingPingOperationId = activeOperationId
  utilityWorkspace.value?.stop()
  statusMessage.value = '正在停止 Ping…'
}

function generateUuids() {
  const count = Number(uuidCount.value)
  const input = `格式：${uuidFormat.value}；数量：${uuidCount.value}`
  try {
    resultText.value = generateUuidBatch(count, uuidFormat.value).join('\n')
    resultLanguage.value = 'plaintext'
    state.value = 'success'
    errorLocation.value = undefined
    statusMessage.value = `已生成 ${count} 个 UUID`
    notify(`已生成 ${count} 个 UUID`)
    recordHistory('uuid', statusMessage.value, input, resultText.value, true)
  } catch (error) {
    state.value = 'error'
    statusMessage.value = (error as Error).message
    notify((error as Error).message)
    recordHistory('uuid', 'UUID 生成失败', input, statusMessage.value, false)
  }
}

function compact() { return run('compact-json', 'JSON 已压缩') }
function validate() { return run('validate-json', 'JSON 有效') }
function escapeString() { return run('escape-json', 'JSON 字符串已转义') }
function unescapeString() { return run('unescape-json', 'JSON 字符串已反转义') }

function clearError() {
  state.value = 'ready'
  errorLocation.value = undefined
}

async function clearContent() {
  const accepted = isTauri() ? await confirm('清空输入和结果？此操作不能撤销。', { title: '清空内容', kind: 'warning' }) : window.confirm('清空输入和结果？此操作不能撤销。')
  if (!accepted) return
  if (mode.value === 'ping' && busy.value) stopUtility()
  activeOperationId++
  busy.value = false
  sourceText.value = ''
  resultText.value = ''
  resultLanguage.value = languageForMode(mode.value)
  statusMessage.value = '内容已清空'
  clearError()
  notify('已清空')
}

async function clearHistory() {
  if (!historyEntries.value.length) return
  const accepted = isTauri()
    ? await confirm('清空本次会话的全部历史记录？此操作不能撤销。', { title: '清空历史记录', kind: 'warning' })
    : window.confirm('清空本次会话的全部历史记录？此操作不能撤销。')
  if (!accepted) return
  historyEntries.value = []
  openHistoryEntries.value = []
  notify('历史记录已清空')
}

function inferMode(path: string) {
  const extension = path.split(/[.\\/]/).at(-1)?.toLowerCase()
  const inferredMode = extension ? toolModeByExtension[extension] : undefined
  if (inferredMode) setMode(inferredMode)
  else if (mode.value === 'uuid') setMode('json')
}

async function loadPath(path: string) {
  try {
    sourceText.value = await readTextFile(path)
    resultText.value = ''
    inferMode(path)
    resultLanguage.value = languageForMode(mode.value)
    state.value = 'ready'
    statusMessage.value = `已打开 · ${path.split(/[\\/]/).at(-1)}`
    errorLocation.value = undefined
  } catch (error) {
    const issue = error as Error
    state.value = 'error'
    statusMessage.value = `读取失败：${issue.message}`
  }
}

async function openFile() {
  if (isTauri()) {
    try {
      const selected = await openDialog({ multiple: false, directory: false, filters: [{ name: '支持的文本文件', extensions: ['json', 'sql', 'xml', 'yaml', 'yml', 'txt', 'md', 'csv'] }] })
      if (typeof selected === 'string') await loadPath(selected)
    } catch (error) { notify(`打开失败：${(error as Error).message}`) }
  } else nativeOpenInput.value?.click()
}

async function openBrowserFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  try {
    sourceText.value = await file.text()
    resultText.value = ''
    inferMode(file.name)
    resultLanguage.value = languageForMode(mode.value)
    state.value = 'ready'
    statusMessage.value = `已打开 · ${file.name}`
  } catch (error) { notify(`读取失败：${(error as Error).message}`) }
  ;(event.target as HTMLInputElement).value = ''
}

async function openDroppedFile(file: File) {
  try {
    sourceText.value = await file.text()
    resultText.value = ''
    inferMode(file.name)
    resultLanguage.value = languageForMode(mode.value)
    state.value = 'ready'
    statusMessage.value = `已打开 · ${file.name}`
  } catch (error) { notify(`读取失败：${(error as Error).message}`) }
}

async function saveFile() {
  if (!resultText.value) { notify('没有可保存的结果'); return }
  const extension = mode.value === 'json-yaml' ? utilityWorkspace.value?.outputExtension() ?? getTool(mode.value).extension : getTool(mode.value).extension
  if (isTauri()) {
    try {
      const path = await saveDialog({ defaultPath: `formatted.${extension}`, filters: [{ name: extension.toUpperCase(), extensions: [extension] }] })
      if (!path) return
      await writeTextFile(path, resultText.value)
      notify(`已保存到 ${path.split(/[\\/]/).at(-1)}`)
      statusMessage.value = '结果已保存'
    } catch (error) { notify(`保存失败：${(error as Error).message}`) }
  } else {
    const link = document.createElement('a')
    link.href = URL.createObjectURL(new Blob([resultText.value], { type: 'text/plain;charset=utf-8' }))
    link.download = `formatted.${extension}`
    link.click()
    URL.revokeObjectURL(link.href)
    notify(`已下载 formatted.${extension}`)
  }
}

async function copyResult() {
  if (!resultText.value) { notify('没有可复制的结果'); return }
  try {
    await navigator.clipboard.writeText(resultText.value)
    notify('结果已复制')
  } catch { notify('复制失败，请检查系统剪贴板权限') }
}

async function cutResult() {
  if (!resultText.value) return
  try {
    await navigator.clipboard.writeText(resultText.value)
    resultText.value = ''
    state.value = 'ready'
    errorLocation.value = undefined
    statusMessage.value = '结果已剪切到剪贴板'
    notify('结果已剪切到剪贴板')
  } catch { notify('剪切失败，结果已保留；请检查系统剪贴板权限') }
}

function setMode(value: Mode) {
  closeMenus()
  if (mode.value !== value) {
    if (mode.value === 'ping' && busy.value) stopUtility()
    const waitingForPingStop = stoppingPingOperationId !== undefined
    activeOperationId++
    if (!waitingForPingStop) busy.value = false
    resultText.value = ''
    resultSearch.value = ''
    focusPane.value = null
    clearError()
  }
  markRecentMode(value)
  toolSearch.value = ''
  mode.value = value
  resultLanguage.value = languageForMode(value)
  statusMessage.value = `${getTool(value).name} 模式`
}

function toggleTheme() {
  settings.value.theme = settings.value.theme === 'dark' ? 'light' : 'dark'
}

function closeMenus(event?: PointerEvent) {
  const target = event?.target
  if (!target || !(target instanceof Node) || !moreMenu.value?.contains(target)) moreOpen.value = false
  if (!target || !(target instanceof Node) || !settingsMenu.value?.contains(target)) settingsOpen.value = false
  if (!target || !(target instanceof Node) || !historyMenu.value?.contains(target)) historyOpen.value = false
}

function toggleMenu(menu: 'more' | 'settings' | 'history') {
  if (menu === 'more') {
    moreOpen.value = !moreOpen.value
    settingsOpen.value = false
    historyOpen.value = false
  }
  else if (menu === 'settings') {
    settingsOpen.value = !settingsOpen.value
    moreOpen.value = false
    historyOpen.value = false
  }
  else {
    historyOpen.value = !historyOpen.value
    moreOpen.value = false
    settingsOpen.value = false
  }
}

function runMoreAction(action: () => void) {
  closeMenus()
  action()
}

async function handleDroppedPaths(paths: string[]) {
  const path = paths[0]
  if (path) await loadPath(path)
  dragging.value = false
}

function handleDomDrop(event: DragEvent) {
  event.preventDefault()
  dragging.value = false
  const file = event.dataTransfer?.files?.[0]
  if (file) void openDroppedFile(file)
}

function onGlobalKey(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    if (hasToolSearch.value) toolSearch.value = ''
    else closeMenus()
    return
  }
  if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'k') {
    const target = event.target instanceof Element ? event.target : undefined
    if (inputEditor.value?.hasTextFocus() || outputEditor.value?.hasTextFocus() || target?.closest('.monaco-editor') || target?.closest('input, textarea, select, [contenteditable="true"]') && target !== toolSearchInput.value) return
    event.preventDefault()
    toolSearchInput.value?.focus()
    return
  }
  if (!event.ctrlKey || event.altKey || event.shiftKey && event.key !== 'c') {
    if (event.ctrlKey && event.altKey && event.key.toLowerCase() === 'l') { event.preventDefault(); void format() }
    return
  }
  const outputEditorFocused = event.target instanceof Element && !!event.target.closest('.output-panel .monaco-editor')
  const focusedInEditor = inputEditor.value?.hasTextFocus() || outputEditor.value?.hasTextFocus() || outputEditorFocused
  switch (event.key.toLowerCase()) {
    case 'c':
      if (focusedInEditor) return
      event.preventDefault()
      void copyResult()
      break
    case 'o': event.preventDefault(); void openFile(); break
    case 's': event.preventDefault(); void saveFile(); break
    case 'l':
      if (focusedInEditor) return
      event.preventDefault()
      void clearContent()
      break
    case '1':
      if (focusedInEditor) return
      event.preventDefault()
      setMode('json')
      break
    case '2':
      if (focusedInEditor) return
      event.preventDefault()
      setMode('sql')
      break
  }
}

let unlistenDrop: (() => void) | undefined
onMounted(() => {
  window.addEventListener('keydown', onGlobalKey, true)
  document.addEventListener('pointerdown', closeMenus)
  if (isTauri()) {
    void getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type === 'enter' || event.payload.type === 'over') dragging.value = true
      else if (event.payload.type === 'leave') dragging.value = false
      else if (event.payload.type === 'drop') void handleDroppedPaths(event.payload.paths)
    }).then((unlisten) => { unlistenDrop = unlisten })
  }
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onGlobalKey, true)
  document.removeEventListener('pointerdown', closeMenus)
  if (toastTimer) clearTimeout(toastTimer)
  if (metricsTimer) clearTimeout(metricsTimer)
  unlistenDrop?.()
  worker.dispose()
})
</script>

<template>
  <main class="app-shell" :class="[`theme-${settings.theme}`, { 'is-dragging': dragging, 'focus-input': focusPane === 'input', 'focus-output': focusPane === 'output' }]"
    @dragenter.prevent="dragging = true" @dragover.prevent="dragging = true" @dragleave.prevent="dragging = false" @drop="handleDomDrop">
    <input ref="nativeOpenInput" class="visually-hidden" type="file" accept=".json,.sql,.xml,.yaml,.yml,.txt,.md,.csv" @change="openBrowserFile" />

    <header class="topbar">
      <div class="brand">
        <div class="brand-mark" aria-hidden="true"><span>{</span><i></i><span>}</span></div>
        <div class="brand-copy"><strong>实用工具箱</strong><span>JSON <b>·</b> SQL <b>·</b> TOOLS</span></div>
        <span class="local-badge"><i></i>LOCAL</span>
        <span class="version-badge" :title="`应用版本 ${appVersion}`">v{{ appVersion }}</span>
      </div>

      <div class="topbar-actions">
        <button class="icon-button theme-toggle" :title="`切换到${settings.theme === 'dark' ? '浅色' : '深色'}主题`" :aria-label="`切换到${settings.theme === 'dark' ? '浅色' : '深色'}主题`" @click="toggleTheme">
          <span class="theme-toggle-icon" aria-hidden="true">{{ settings.theme === 'dark' ? '☼' : '☾' }}</span><span>{{ settings.theme === 'dark' ? '浅色' : '深色' }}</span>
        </button>
        <div ref="settingsMenu" class="settings-wrap">
          <button class="icon-button settings-button" type="button" title="设置" aria-label="设置" aria-controls="settings-popover" :aria-expanded="settingsOpen" @click.stop="toggleMenu('settings')">⚙</button>
          <Transition name="popover"><div v-if="settingsOpen" id="settings-popover" class="settings-popover">
            <div class="popover-heading"><strong>偏好设置</strong><span>仅保存在本机</span></div>
            <label class="setting-row"><span>主题</span><select v-model="settings.theme"><option value="dark">深色</option><option value="light">浅色</option></select></label>
            <label class="setting-row"><span>缩进</span><select v-model="settings.indent"><option value="2">2 空格</option><option value="4">4 空格</option><option value="tab">Tab</option></select></label>
            <label class="setting-row"><span>SQL 方言</span><select v-model="settings.dialect"><option value="postgresql">PostgreSQL</option><option value="mysql">MySQL</option><option value="transactsql">SQL Server</option></select></label>
            <label class="setting-row"><span>关键字</span><select v-model="settings.keywordCase"><option value="upper">大写</option><option value="lower">小写</option><option value="preserve">保持原样</option></select></label>
            <label class="setting-row"><span>编辑器字号</span><select v-model.number="settings.fontSize"><option :value="12">12 px</option><option :value="13">13 px</option><option :value="14">14 px</option><option :value="15">15 px</option><option :value="16">16 px</option></select></label>
            <p class="settings-note">设置会本地保存；编辑内容不会自动保存。</p>
          </div></Transition>
        </div>
      </div>
    </header>

    <section class="toolbar" aria-label="编辑操作">
      <div class="toolbar-primary">
        <Transition name="toolbar-content"><div v-if="mode === 'json'" class="toolbar-mode-actions">
          <button class="button" :disabled="busy" @click="compact"><span class="button-glyph">⇢</span>压缩</button>
          <button class="button" :disabled="busy" @click="validate"><span class="button-glyph">✓</span>校验</button>
          <div ref="moreMenu" class="more-wrap"><button class="button" type="button" aria-controls="more-menu" :aria-expanded="moreOpen" @click.stop="toggleMenu('more')">更多 <span class="chevron">⌄</span></button><Transition name="popover"><div v-if="moreOpen" id="more-menu" class="more-menu">
            <button @click="runMoreAction(escapeString)">转义为 JSON 字符串</button><button @click="runMoreAction(unescapeString)">反转义 JSON 字符串</button>
          </div></Transition></div>
        </div></Transition>
        <div ref="historyMenu" class="history-menu-wrap">
          <button class="button history-menu-button" type="button" title="查看当前工具的历史记录" aria-controls="history-popover" :aria-expanded="historyOpen" @click.stop="toggleMenu('history')"><span class="button-glyph">◷</span>历史<span class="history-count">{{ currentHistoryCount }}</span><span class="chevron">⌄</span></button>
          <Transition name="popover"><div v-if="historyOpen" id="history-popover" class="history-popover">
            <div class="history-popover-heading">
              <div><strong>{{ getTool(mode).name }}历史</strong><span>正文仅保存在本次会话内存 · 最近 50 条 / 约 100 万字符</span></div>
              <button class="history-clear-button" :disabled="!historyEntries.length" @click="clearHistory">清空全部</button>
            </div>
            <div v-if="currentHistoryCount" class="history-dropdown-scroll">
              <section v-for="group in historyGroups" :key="group.label" class="history-day">
                <h2>{{ group.label }}<span>{{ group.entries.length }} 条</span></h2>
                <div v-for="entry in group.entries" :key="entry.id" class="history-entry" :class="{ expanded: openHistoryEntries.includes(entry.id) }">
                  <button class="history-entry-summary" type="button" :aria-expanded="openHistoryEntries.includes(entry.id)" :aria-controls="`history-entry-${entry.id}`" @click="toggleHistoryEntry(entry.id)">
                    <time>{{ historyTime(entry.createdAt) }}</time>
                    <strong>{{ getTool(entry.mode).name }}</strong>
                    <span class="history-operation">{{ entry.operation }}</span>
                    <span class="history-result-state" :class="entry.ok ? 'success' : 'error'">{{ entry.ok ? '成功' : '失败' }}</span>
                  </button>
                  <Transition name="history-content"><div v-show="openHistoryEntries.includes(entry.id)" :id="`history-entry-${entry.id}`" class="history-entry-content" role="region" :aria-label="`${getTool(entry.mode).name}历史详情`">
                    <p v-if="entry.redacted" class="history-redacted">此工具只保留操作时间与状态，敏感输入和处理结果不会写入历史。</p>
                    <template v-else>
                    <div><label>输入</label><pre>{{ entry.input || '（无文本内容）' }}</pre><small v-if="entry.input.length > 180">共 {{ entry.input.length.toLocaleString() }} 字符 · 可滚动查看</small></div>
                    <div><label>{{ entry.ok ? '结果' : '错误' }}</label><pre>{{ entry.output || '（无结果内容）' }}</pre><small v-if="entry.output.length > 180">共 {{ entry.output.length.toLocaleString() }} 字符 · 可滚动查看</small></div>
                    </template>
                  </div></Transition>
                </div>
              </section>
            </div>
            <div v-else class="history-empty-mini">当前工具还没有历史记录</div>
          </div></Transition>
        </div>
      </div>
      <button class="button button-primary toolbar-run-button" :disabled="busy && mode !== 'ping'" @click="mode === 'ping' && busy ? stopUtility() : format()"><span class="button-glyph">{{ mode === 'ping' && busy ? '■' : mode === 'uuid' ? '◎' : '✦' }}</span>{{ mode === 'ping' && busy ? '停止 Ping' : mode === 'uuid' ? '生成 UUID' : getTool(mode).core ? '格式化' : '执行' }}<span v-if="mode !== 'ping' || !busy" class="shortcut">Ctrl Alt L</span></button>
      <div class="toolbar-end">
        <div class="toolbar-secondary">
          <button class="button" :disabled="!resultText" title="复制结果（Ctrl+C）" @click="copyResult"><span class="button-glyph">▣</span>复制结果<kbd>Ctrl C</kbd></button>
          <button class="button" title="打开本地文件（Ctrl+O）" @click="openFile"><span class="button-glyph">↥</span>打开</button>
          <button class="button" :disabled="!resultText" title="保存结果（Ctrl+S）" @click="saveFile"><span class="button-glyph">↧</span>保存</button>
          <button class="button button-quiet" title="清空输入和结果（Ctrl+L）" @click="clearContent"><span class="button-glyph">⌫</span>清空</button>
        </div>
        <Transition name="fade-fast" mode="out-in">
          <span v-if="busy" key="busy" class="processing"><i></i>{{ mode === 'http' ? '请求中' : mode === 'ping' ? 'Ping 运行中' : '本地处理中' }}</span>
          <span v-else-if="mode === 'http' || mode === 'ping'" key="network" class="offline-label"><i></i>{{ mode === 'http' ? '发送时联网' : '开始时联网' }}</span>
          <span v-else key="offline" class="offline-label"><i></i>离线可用</span>
        </Transition>
      </div>
    </section>

    <section class="workbench">
      <nav class="feature-sidebar" aria-label="功能选择">
        <div class="tool-search" role="search"><span aria-hidden="true">⌕</span><input ref="toolSearchInput" v-model="toolSearch" type="search" aria-label="搜索工具" placeholder="搜索工具" /><kbd>Ctrl K</kbd><button v-if="toolSearch" type="button" aria-label="清除搜索" @click="toolSearch = ''; toolSearchInput?.focus()">×</button></div>
        <template v-if="!hasToolSearch">
          <button v-if="recentTools.length" class="feature-sidebar-label recent-heading" type="button" :aria-expanded="recentExpanded" @click="recentExpanded = !recentExpanded"><span>最近使用</span><span>{{ recentTools.length }}</span><span class="recent-chevron">{{ recentExpanded ? '⌃' : '⌄' }}</span></button>
          <Transition name="toolbar-content"><div v-if="recentExpanded && recentTools.length" class="tool-list recent-tool-list">
            <button v-for="tool in recentTools" :key="tool.mode" :class="{ active: mode === tool.mode }" :aria-current="mode === tool.mode ? 'page' : undefined" @click="setMode(tool.mode)"><span class="feature-icon">{{ tool.icon }}</span><span>{{ tool.label }}</span><kbd v-if="tool.shortcut">Ctrl+{{ tool.shortcut }}</kbd></button>
          </div></Transition>
        </template>
        <template v-for="group in filteredToolGroups" :key="group.label">
          <span class="feature-sidebar-label">{{ group.label }}</span>
          <div class="tool-list">
            <button v-for="tool in group.tools" :key="tool.mode" :class="{ active: mode === tool.mode }" :aria-current="mode === tool.mode ? 'page' : undefined" :title="tool.shortcut ? `${tool.name} · Ctrl+${tool.shortcut}` : tool.name" @click="setMode(tool.mode)"><span class="feature-icon">{{ tool.icon }}</span><span>{{ tool.label }}</span><kbd v-if="tool.shortcut">Ctrl+{{ tool.shortcut }}</kbd></button>
          </div>
        </template>
        <p v-if="hasToolSearch && !filteredToolGroups.length" class="tool-search-empty">没有匹配的工具</p>
      </nav>
      <Transition name="workspace" mode="out-in">
      <div v-if="getTool(mode).core" key="core-workspace" class="workbench-content" :class="[{ 'single-pane': focusPane }, focusPane ? `focus-${focusPane}` : '']">
      <article class="editor-panel input-panel">
        <div class="panel-heading input-panel-heading">
          <div class="input-panel-main">
            <div class="panel-title"><span class="panel-dot source-dot"></span><strong>{{ getTool(mode).inputTitle }}</strong><span class="panel-tag">{{ mode.toUpperCase() }}</span></div>
          </div>
          <div class="panel-tools"><button class="panel-action" :title="focusPane === 'input' ? '退出最大化' : '最大化编辑区'" @click="focusPane = focusPane === 'input' ? null : 'input'">{{ focusPane === 'input' ? '⤢' : '⛶' }}</button></div>
        </div>
        <Transition name="pane-content" mode="out-in">
        <div v-if="mode === 'uuid'" key="uuid-form" class="uuid-form">
          <div class="uuid-form-intro"><strong>批量生成 UUID v4</strong><span>使用本机密码学安全随机数，内容不会离开设备。</span></div>
          <label class="uuid-setting"><span>输出格式</span><select v-model="uuidFormat">
            <option value="standard">标准小写 · 带连字符</option>
            <option value="uppercase">大写 · 带连字符</option>
            <option value="compact">紧凑 · 无连字符</option>
            <option value="urn">URN 前缀</option>
            <option value="braces">花括号包裹</option>
          </select></label>
          <label class="uuid-setting"><span>生成数量</span><input v-model.number="uuidCount" type="number" min="1" max="10000" step="1" inputmode="numeric" /></label>
          <div class="uuid-presets"><span>常用数量</span><button v-for="count in [10, 30, 50]" :key="count" type="button" :class="{ active: Number(uuidCount) === count }" :aria-pressed="Number(uuidCount) === count" @click="uuidCount = count">{{ count }}</button></div>
          <p class="uuid-note">支持 1–10,000 个；生成后可在右侧复制、搜索或保存。</p>
        </div>
        <CodeEditor v-else key="source-editor" ref="inputEditor" v-model="sourceText" :language="mode === 'sql' ? 'sql' : 'json'" :theme="settings.theme" :font-size="settings.fontSize" :indent-style="settings.indent" />
        </Transition>
      </article>

      <div class="split-rail"><span></span><span class="rail-grip">•••</span><span></span></div>

      <article class="editor-panel output-panel">
        <div class="panel-heading">
          <div class="panel-title"><span class="panel-dot result-dot"></span><strong>{{ mode === 'uuid' ? '生成结果' : '格式化结果' }}</strong><span class="panel-tag result-tag">{{ resultText ? mode === 'uuid' ? 'UUID' : resultLanguage.toUpperCase() : 'OUTPUT' }}</span></div>
          <div class="panel-tools">
            <label class="output-search" aria-label="搜索格式化结果">
              <span class="search-icon" aria-hidden="true">⌕</span>
              <input v-model="resultSearch" type="text" placeholder="搜索结果" aria-label="搜索格式化结果" />
              <Transition name="fade-fast"><span v-if="resultSearch" class="search-count" :title="resultSearchCapped ? '结果过多，仅高亮前 5,000 处' : ''" aria-live="polite">{{ resultSearchCount.toLocaleString() }}{{ resultSearchCapped ? '+' : '' }} 处</span></Transition>
              <Transition name="fade-fast"><button v-if="resultSearch" class="search-clear" type="button" title="清空搜索" aria-label="清空搜索" @click="resultSearch = ''">×</button></Transition>
            </label>
            <span class="hint" :title="mode === 'uuid' && resultText ? 'Ctrl+X 剪切整份结果' : ''">{{ resultText ? '只读预览' : mode === 'uuid' ? '点击生成 UUID' : '运行格式化后显示' }}</span>
            <button class="panel-action" :title="focusPane === 'output' ? '退出最大化' : '最大化编辑区'" @click="focusPane = focusPane === 'output' ? null : 'output'">{{ focusPane === 'output' ? '⤢' : '⛶' }}</button>
          </div>
        </div>
        <div class="output-content">
          <CodeEditor ref="outputEditor" v-model="resultText" :language="resultLanguage" :theme="settings.theme" :font-size="settings.fontSize" :indent-style="settings.indent" :search-query="resultSearch" read-only @cut="cutResult" @search-count="resultSearchCount = $event.count; resultSearchCapped = $event.capped" />
          <Transition name="empty-state"><div v-if="!resultText" class="empty-state"><div class="empty-mark">⌘</div><strong>{{ mode === 'uuid' ? '生成结果会显示在这里' : '结果会显示在这里' }}</strong><span>按 <kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>L</kbd> {{ mode === 'uuid' ? '生成 UUID' : '开始格式化' }}</span></div></Transition>
        </div>
      </article>
      </div>
      <div v-else key="utility-workspace" class="workbench-content" :class="[{ 'single-pane': focusPane }, focusPane ? `focus-${focusPane}` : '']">
        <UtilityWorkspace ref="utilityWorkspace" :mode="utilityMode" v-model="sourceText" v-model:result-value="resultText" v-model:focus-pane="focusPane" :theme="settings.theme" :font-size="settings.fontSize" :indent-style="settings.indent" />
      </div>
      </Transition>

      <Transition name="drop"><div v-if="dragging" class="drop-overlay"><div class="drop-card"><span>↧</span><strong>松开以打开本地文件</strong><small>JSON、SQL、XML、YAML 或文本文件</small></div></div></Transition>
    </section>

    <footer class="statusbar">
      <div class="status-leading"><span class="status-mode">{{ mode.toUpperCase() }}</span><span class="status-divider"></span><span>{{ metrics.lines }} 行</span><span>{{ charCount.toLocaleString() }} 字符</span><span>{{ metrics.bytes.toLocaleString() }} B</span></div>
      <div class="status-message" :class="`status-${state}`"><span class="status-icon">{{ state === 'error' ? '!' : state === 'success' ? '✓' : '·' }}</span>{{ statusMessage }}<Transition name="fade-fast"><span v-if="errorLocation?.line" class="error-location">第 {{ errorLocation.line }} 行，第 {{ errorLocation.column }} 列</span></Transition></div>
      <div class="status-trailing"><span class="encoding">UTF-8</span><span>Windows</span></div>
    </footer>

    <transition name="toast"><div v-if="toast" class="toast-message"><span>✓</span>{{ toast }}</div></transition>
  </main>
</template>
