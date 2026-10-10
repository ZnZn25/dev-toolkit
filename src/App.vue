<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { isTauri } from '@tauri-apps/api/core'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { open as openDialog, save as saveDialog, confirm } from '@tauri-apps/plugin-dialog'
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'
import CodeEditor from './components/CodeEditor.vue'
import { FormatterWorker, type FormatAction } from './core/format-worker-client'

type Mode = 'json' | 'sql'
type Theme = 'dark' | 'light'
type Pane = 'input' | 'output' | null
type EditorHandle = { focus: () => void; hasTextFocus: () => boolean }
type AppSettings = { indent: '2' | '4' | 'tab'; keywordCase: 'preserve' | 'upper' | 'lower'; dialect: 'postgresql' | 'mysql' | 'transactsql'; theme: Theme; fontSize: number }

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
const sourceText = ref('')
const resultText = ref('')
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
const nativeOpenInput = ref<HTMLInputElement>()
const worker = new FormatterWorker()
let toastTimer: ReturnType<typeof setTimeout> | undefined
let metricsTimer: ReturnType<typeof setTimeout> | undefined
const metrics = ref({ lines: 1, bytes: 0 })
const charCount = computed(() => sourceText.value.length)

function notify(message: string) {
  toast.value = message
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toast.value = '' }, 2400)
}

function updateMetrics() {
  if (metricsTimer) clearTimeout(metricsTimer)
  metricsTimer = setTimeout(() => {
    const text = sourceText.value
    metrics.value = { lines: (text.match(/\r\n|\r|\n/g)?.length ?? 0) + 1, bytes: new Blob([text]).size }
  }, 120)
}
watch(sourceText, updateMetrics, { flush: 'post' })
watch(settings, (value) => {
  try { localStorage.setItem('local-format-studio.settings', JSON.stringify(value)) }
  catch { notify('无法保存设置，请检查本机存储空间') }
}, { deep: true })

function options() {
  return { indent: settings.value.indent, dialect: settings.value.dialect, keywordCase: settings.value.keywordCase }
}

async function run(action: FormatAction, successText: string) {
  if (busy.value) return
  busy.value = true
  errorLocation.value = undefined
  state.value = 'ready'
  statusMessage.value = '正在处理…'
  try {
    const output = await worker.run(action, sourceText.value, options())
    if (output !== undefined) {
      resultText.value = output
      resultLanguage.value = action === 'unescape-json' ? 'plaintext' : mode.value
    }
    state.value = 'success'
    statusMessage.value = successText
  } catch (error) {
    const issue = error as Error & { line?: number; column?: number }
    state.value = 'error'
    statusMessage.value = issue.message || '处理失败'
    errorLocation.value = { line: issue.line, column: issue.column }
  } finally {
    busy.value = false
  }
}

function format() {
  return mode.value === 'json'
    ? run('format-json', `JSON 已格式化 · ${settings.value.indent === 'tab' ? 'Tab' : `${settings.value.indent} 空格`}`)
    : run('format-sql', `SQL 已格式化 · ${settings.value.dialect.toUpperCase()}`)
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
  sourceText.value = ''
  resultText.value = ''
  resultLanguage.value = mode.value
  statusMessage.value = '内容已清空'
  clearError()
  notify('已清空')
}

function inferMode(path: string) {
  const extension = path.split(/[.\\/]/).at(-1)?.toLowerCase()
  if (extension === 'sql') mode.value = 'sql'
  else if (extension === 'json') mode.value = 'json'
}

async function loadPath(path: string) {
  try {
    sourceText.value = await readTextFile(path)
    resultText.value = ''
    inferMode(path)
    resultLanguage.value = mode.value
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
      const selected = await openDialog({ multiple: false, directory: false, filters: [{ name: 'JSON / SQL', extensions: ['json', 'sql', 'txt'] }] })
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
    resultLanguage.value = mode.value
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
    resultLanguage.value = mode.value
    state.value = 'ready'
    statusMessage.value = `已打开 · ${file.name}`
  } catch (error) { notify(`读取失败：${(error as Error).message}`) }
}

async function saveFile() {
  if (!resultText.value) { notify('没有可保存的结果'); return }
  const extension = mode.value === 'json' ? 'json' : 'sql'
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

function setMode(value: Mode) {
  mode.value = value
  resultLanguage.value = value
  clearError()
  statusMessage.value = value === 'json' ? 'JSON 模式' : 'SQL 模式'
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
  if (!event.ctrlKey || event.altKey || event.shiftKey && event.key !== 'c') {
    if (event.ctrlKey && event.altKey && event.key.toLowerCase() === 'l') { event.preventDefault(); void format() }
    return
  }
  const focusedInEditor = inputEditor.value?.hasTextFocus() || outputEditor.value?.hasTextFocus()
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
  if (toastTimer) clearTimeout(toastTimer)
  if (metricsTimer) clearTimeout(metricsTimer)
  unlistenDrop?.()
  worker.dispose()
})
</script>

<template>
  <main class="app-shell" :class="[`theme-${settings.theme}`, { 'is-dragging': dragging, 'focus-input': focusPane === 'input', 'focus-output': focusPane === 'output' }]"
    @dragenter.prevent="dragging = true" @dragover.prevent="dragging = true" @dragleave.prevent="dragging = false" @drop="handleDomDrop">
    <input ref="nativeOpenInput" class="visually-hidden" type="file" accept=".json,.sql,.txt" @change="openBrowserFile" />

    <header class="topbar">
      <div class="brand">
        <div class="brand-mark" aria-hidden="true"><span>{</span><i></i><span>}</span></div>
        <div class="brand-copy"><strong>Format Studio</strong><span>JSON <b>·</b> SQL</span></div>
        <span class="local-badge"><i></i>LOCAL</span>
      </div>

      <nav class="mode-switch" aria-label="格式类型">
        <button :class="{ active: mode === 'json' }" @click="setMode('json')"><span class="mode-icon">{ }</span> JSON <kbd>Ctrl 1</kbd></button>
        <button :class="{ active: mode === 'sql' }" @click="setMode('sql')"><span class="mode-icon">▤</span> SQL <kbd>Ctrl 2</kbd></button>
      </nav>

      <details class="settings-wrap">
        <summary class="icon-button settings-button" title="设置" aria-label="设置">⚙</summary>
        <div class="settings-popover">
          <div class="popover-heading"><strong>偏好设置</strong><span>仅保存在本机</span></div>
          <label class="setting-row"><span>主题</span><select v-model="settings.theme"><option value="dark">深色</option><option value="light">浅色</option></select></label>
          <label class="setting-row"><span>缩进</span><select v-model="settings.indent"><option value="2">2 空格</option><option value="4">4 空格</option><option value="tab">Tab</option></select></label>
          <label class="setting-row"><span>SQL 方言</span><select v-model="settings.dialect"><option value="postgresql">PostgreSQL</option><option value="mysql">MySQL</option><option value="transactsql">SQL Server</option></select></label>
          <label class="setting-row"><span>关键字</span><select v-model="settings.keywordCase"><option value="upper">大写</option><option value="lower">小写</option><option value="preserve">保持原样</option></select></label>
          <label class="setting-row"><span>编辑器字号</span><select v-model.number="settings.fontSize"><option :value="12">12 px</option><option :value="13">13 px</option><option :value="14">14 px</option><option :value="15">15 px</option><option :value="16">16 px</option></select></label>
          <p class="settings-note">设置会本地保存；编辑内容不会自动保存。</p>
        </div>
      </details>
    </header>

    <section class="toolbar" aria-label="编辑操作">
      <div class="toolbar-primary">
        <button class="button button-primary" :disabled="busy" @click="format"><span class="button-glyph">✦</span>格式化<span class="shortcut">Ctrl Alt L</span></button>
        <template v-if="mode === 'json'">
          <button class="button" :disabled="busy" @click="compact"><span class="button-glyph">⇢</span>压缩</button>
          <button class="button" :disabled="busy" @click="validate"><span class="button-glyph">✓</span>校验</button>
          <details class="more-wrap"><summary class="button">更多 <span class="chevron">⌄</span></summary><div class="more-menu">
            <button @click="escapeString">转义为 JSON 字符串</button><button @click="unescapeString">反转义 JSON 字符串</button>
          </div></details>
        </template>
      </div>
      <div class="toolbar-divider"></div>
      <div class="toolbar-secondary">
        <button class="button" :disabled="!resultText" title="复制结果（Ctrl+C）" @click="copyResult"><span class="button-glyph">▣</span>复制结果<kbd>Ctrl C</kbd></button>
        <button class="button" title="打开本地文件（Ctrl+O）" @click="openFile"><span class="button-glyph">↥</span>打开</button>
        <button class="button" :disabled="!resultText" title="保存结果（Ctrl+S）" @click="saveFile"><span class="button-glyph">↧</span>保存</button>
        <button class="button button-quiet" title="清空输入和结果（Ctrl+L）" @click="clearContent"><span class="button-glyph">⌫</span>清空</button>
      </div>
      <div class="toolbar-spacer"></div>
      <span v-if="busy" class="processing"><i></i>本地处理中</span>
      <span v-else class="offline-label"><i></i>离线可用</span>
    </section>

    <section class="workbench" :class="{ 'single-pane': focusPane }">
      <article class="editor-panel input-panel" :class="{ 'panel-hidden': focusPane === 'output' }">
        <div class="panel-heading">
          <div class="panel-title"><span class="panel-dot source-dot"></span><strong>原始输入</strong><span class="panel-tag">{{ mode.toUpperCase() }}</span></div>
          <div class="panel-tools"><span class="hint">粘贴或拖入文件</span><button class="panel-action" :title="focusPane === 'input' ? '退出最大化' : '最大化编辑区'" @click="focusPane = focusPane === 'input' ? null : 'input'">{{ focusPane === 'input' ? '⤢' : '⛶' }}</button></div>
        </div>
        <CodeEditor ref="inputEditor" v-model="sourceText" :language="mode" :theme="settings.theme" :font-size="settings.fontSize" :indent-style="settings.indent" />
      </article>

      <div class="split-rail" :class="{ 'rail-hidden': focusPane }"><span></span><span class="rail-grip">•••</span><span></span></div>

      <article class="editor-panel output-panel" :class="{ 'panel-hidden': focusPane === 'input' }">
        <div class="panel-heading">
          <div class="panel-title"><span class="panel-dot result-dot"></span><strong>格式化结果</strong><span class="panel-tag result-tag">{{ resultText ? resultLanguage.toUpperCase() : 'OUTPUT' }}</span></div>
          <div class="panel-tools"><span class="hint">{{ resultText ? '只读预览' : '运行格式化后显示' }}</span><button class="panel-action" :title="focusPane === 'output' ? '退出最大化' : '最大化编辑区'" @click="focusPane = focusPane === 'output' ? null : 'output'">{{ focusPane === 'output' ? '⤢' : '⛶' }}</button></div>
        </div>
        <div class="output-content">
          <CodeEditor ref="outputEditor" v-model="resultText" :language="resultLanguage" :theme="settings.theme" :font-size="settings.fontSize" :indent-style="settings.indent" read-only />
          <div v-if="!resultText" class="empty-state"><div class="empty-mark">⌘</div><strong>结果会显示在这里</strong><span>按 <kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>L</kbd> 开始格式化</span></div>
        </div>
      </article>

      <div v-if="dragging" class="drop-overlay"><div class="drop-card"><span>↧</span><strong>松开以打开本地文件</strong><small>JSON、SQL 或文本文件</small></div></div>
    </section>

    <footer class="statusbar">
      <div class="status-leading"><span class="status-mode">{{ mode.toUpperCase() }}</span><span class="status-divider"></span><span>{{ metrics.lines }} 行</span><span>{{ charCount.toLocaleString() }} 字符</span><span>{{ metrics.bytes.toLocaleString() }} B</span></div>
      <div class="status-message" :class="`status-${state}`"><span class="status-icon">{{ state === 'error' ? '!' : state === 'success' ? '✓' : '·' }}</span>{{ statusMessage }}<span v-if="errorLocation?.line" class="error-location">第 {{ errorLocation.line }} 行，第 {{ errorLocation.column }} 列</span></div>
      <div class="status-trailing"><span class="encoding">UTF-8</span><span>Windows</span></div>
    </footer>

    <transition name="toast"><div v-if="toast" class="toast-message"><span>✓</span>{{ toast }}</div></transition>
  </main>
</template>
