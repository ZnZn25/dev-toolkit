<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch, type ComponentPublicInstance } from 'vue'
import { isTauri } from '@tauri-apps/api/core'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { open as openReadFile, SeekMode, stat, type FileHandle } from '@tauri-apps/plugin-fs'
import { filterLogLines, parseLogLine, type ParsedLogLine } from '../core/logs'

type LogEntry = ParsedLogLine & { id: number }
const INITIAL_TAIL_BYTES = 512 * 1024
const MAX_READ_BYTES_PER_PASS = 512 * 1024
const MAX_ENTRIES = 3000
const ROW_HEIGHT = 30
const OVERSCAN = 10

const desktopAvailable = isTauri()
const filePath = ref('')
const fileName = ref('')
const entries = ref<LogEntry[]>([])
const keyword = ref('')
const threadFilter = ref('')
const fromTime = ref('')
const toTime = ref('')
const following = ref(false)
const autoFollow = ref(true)
const busy = ref(false)
const errorMessage = ref('')
const notice = ref('')
const pendingLine = ref('')
const selectedEntry = ref<LogEntry>()
const viewport = ref<HTMLElement>()
const viewportHeight = ref(500)
const scrollTop = ref(0)
let fileHandle: FileHandle | undefined
let pollTimer: ReturnType<typeof setInterval> | undefined
let offset = 0
let skipLeadingPartialLine = false
let previousMeta: ParsedLogLine | undefined
let nextEntryId = 1
let decoder = new TextDecoder('utf-8')
let reading = false
let readAgain = false
const droppedEntries = ref(0)

const filters = computed(() => ({
  keyword: keyword.value,
  thread: threadFilter.value,
  fromMs: fromTime.value ? Date.parse(fromTime.value) : null,
  toMs: toTime.value ? Date.parse(toTime.value) : null,
}))
const filteredEntries = computed(() => filterLogLines(entries.value, filters.value))
const visibleCount = computed(() => Math.ceil(viewportHeight.value / ROW_HEIGHT) + OVERSCAN * 2)
const firstVisibleIndex = computed(() => Math.max(0, Math.floor(scrollTop.value / ROW_HEIGHT) - OVERSCAN))
const visibleEntries = computed(() => filteredEntries.value.slice(firstVisibleIndex.value, firstVisibleIndex.value + visibleCount.value))
const bottomSpacer = computed(() => Math.max(0, filteredEntries.value.length - firstVisibleIndex.value - visibleEntries.value.length) * ROW_HEIGHT)
const selectedDetails = computed(() => selectedEntry.value)

function setViewportHeight() {
  if (viewport.value) viewportHeight.value = viewport.value.clientHeight
}

function onScroll() {
  const element = viewport.value
  if (!element) return
  scrollTop.value = element.scrollTop
  autoFollow.value = element.scrollHeight - element.scrollTop - element.clientHeight < ROW_HEIGHT * 2
}

function pushEntry(parsed: ParsedLogLine) {
  const entry = { ...parsed, id: nextEntryId++ }
  entries.value.push(entry)
  if (entries.value.length > MAX_ENTRIES) {
    entries.value.splice(0, entries.value.length - MAX_ENTRIES)
    droppedEntries.value += 1
  }
  if (parsed.timestamp !== null || parsed.level !== 'OTHER' || parsed.thread) previousMeta = parsed
}

function consumeText(text: string) {
  const combined = pendingLine.value + text
  const lines = combined.split('\n')
  pendingLine.value = lines.pop() ?? ''
  for (const raw of lines) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    const parsed = parseLogLine(line)
    const isContinuation = parsed.timestamp === null && parsed.level === 'OTHER' && !parsed.thread
    pushEntry(isContinuation && previousMeta
      ? { ...parsed, timestamp: previousMeta.timestamp, timestampMs: previousMeta.timestampMs, level: previousMeta.level, thread: previousMeta.thread }
      : parsed)
  }
}

function addMarker(message: string) {
  pushEntry({ timestamp: null, timestampMs: null, level: 'OTHER', thread: '', message })
}

async function readAvailable() {
  if (!fileHandle) return
  if (reading) { readAgain = true; return }
  reading = true
  try {
    {
      readAgain = false
      const handle = fileHandle
      if (!handle) return
      const info = await handle.stat()
      if (info.size < offset) {
        offset = 0
        pendingLine.value = ''
        previousMeta = undefined
        decoder = new TextDecoder('utf-8')
        await handle.seek(0, SeekMode.Start)
        addMarker('日志文件被截断，已从头继续读取')
      }
      const endOffset = Math.min(info.size, offset + MAX_READ_BYTES_PER_PASS)
      await handle.seek(offset, SeekMode.Start)
      const buffer = new Uint8Array(64 * 1024)
      while (offset < endOffset) {
        const count = await handle.read(buffer.subarray(0, Math.min(buffer.length, endOffset - offset)))
        if (count === null || count === 0) break
        offset += count
        let text = decoder.decode(buffer.subarray(0, count), { stream: true })
        if (skipLeadingPartialLine) {
          const newline = text.indexOf('\n')
          if (newline === -1) continue
          text = text.slice(newline + 1)
          skipLeadingPartialLine = false
        }
        consumeText(text)
      }
      if (offset < info.size) readAgain = true
    }
    await nextTick()
    if (autoFollow.value && viewport.value) viewport.value.scrollTop = viewport.value.scrollHeight
  } catch (error) {
    errorMessage.value = `读取日志失败：${(error as Error).message}`
  } finally {
    reading = false
    if (readAgain && fileHandle) {
      readAgain = false
      setTimeout(() => void readAvailable(), 25)
    }
  }
}

async function openAtTail(path: string, addRotationMarker = false) {
  const next = await openReadFile(path, { read: true })
  const info = await next.stat()
  const start = Math.max(0, info.size - INITIAL_TAIL_BYTES)
  if (start > 0) await next.seek(start, SeekMode.Start)
  const previous = fileHandle
  fileHandle = next
  offset = start
  pendingLine.value = ''
  decoder = new TextDecoder('utf-8')
  skipLeadingPartialLine = start > 0
  previousMeta = undefined
  if (addRotationMarker) addMarker('检测到日志轮转，已切换到新文件')
  await previous?.close().catch(() => undefined)
  await readAvailable()
}

async function pollFile() {
  const path = filePath.value
  const handle = fileHandle
  if (!following.value || !path || !handle) return
  try {
    const [pathInfo, handleInfo] = await Promise.all([stat(path), handle.stat()])
    const pathBirth = pathInfo.birthtime?.getTime()
    const openedBirth = handleInfo.birthtime?.getTime()
    if (pathBirth !== undefined && openedBirth !== undefined && pathBirth !== openedBirth) {
      await openAtTail(path, true)
      return
    }
    if (pathInfo.size < offset) {
      offset = 0
      pendingLine.value = ''
      previousMeta = undefined
      decoder = new TextDecoder('utf-8')
      await handle.seek(0, SeekMode.Start)
      addMarker('日志文件被截断，已从头继续读取')
    }
    await readAvailable()
  } catch (error) {
    // Log rotation can briefly remove the selected path before the replacement file appears.
    if (!fileHandle || !filePath.value) return
    const message = (error as Error).message
    if (/not found|找不到|系统找不到|no such file/i.test(message)) notice.value = '等待日志轮转后的新文件…'
    else errorMessage.value = `跟踪日志失败：${message}`
  }
}

async function chooseFile() {
  if (!desktopAvailable || busy.value) return
  try {
    const selected = await openDialog({ multiple: false, directory: false, filters: [{ name: 'Spring Boot 日志', extensions: ['log', 'txt'] }] })
    if (typeof selected !== 'string') return
    busy.value = true
    errorMessage.value = ''
    notice.value = ''
    following.value = false
    if (pollTimer) clearInterval(pollTimer)
    pollTimer = undefined
    await fileHandle?.close().catch(() => undefined)
    fileHandle = undefined
    entries.value = []
    pendingLine.value = ''
    previousMeta = undefined
    nextEntryId = 1
    droppedEntries.value = 0
    filePath.value = selected
    fileName.value = selected.split(/[\\/]/).at(-1) || selected
    await openAtTail(selected)
    following.value = true
    notice.value = '实时跟踪中 · 约每秒检查一次文件变化'
    pollTimer = setInterval(() => { void pollFile() }, 650)
    autoFollow.value = true
  } catch (error) {
    errorMessage.value = `打开日志失败：${(error as Error).message}`
  } finally { busy.value = false }
}

function toggleFollowing() {
  following.value = !following.value
  if (following.value) {
    notice.value = '实时跟踪中 · 约每秒检查一次文件变化'
    if (!pollTimer) pollTimer = setInterval(() => { void pollFile() }, 650)
    void pollFile()
  } else {
    if (pollTimer) clearInterval(pollTimer)
    pollTimer = undefined
    notice.value = '已暂停跟踪；当前日志仍可筛选查看'
  }
}

function clearLogs() {
  entries.value = []
  pendingLine.value = ''
  previousMeta = undefined
  selectedEntry.value = undefined
  droppedEntries.value = 0
  if (viewport.value) viewport.value.scrollTop = 0
  autoFollow.value = true
}

function followLatest() {
  autoFollow.value = true
  if (viewport.value) viewport.value.scrollTop = viewport.value.scrollHeight
}

watch([keyword, threadFilter, fromTime, toTime], () => {
  scrollTop.value = 0
  if (viewport.value) viewport.value.scrollTop = 0
  selectedEntry.value = undefined
})

let resizeObserver: ResizeObserver | undefined
onBeforeUnmount(() => {
  if (pollTimer) clearInterval(pollTimer)
  resizeObserver?.disconnect()
  void fileHandle?.close()
})

function bindViewport(element: Element | ComponentPublicInstance | null) {
  if (!(element instanceof HTMLElement)) return
  viewport.value = element
  setViewportHeight()
  resizeObserver?.disconnect()
  resizeObserver = new ResizeObserver(setViewportHeight)
  resizeObserver.observe(element)
}
</script>

<template>
  <section class="system-tool-page live-log-viewer">
    <header class="system-tool-heading">
      <div><span class="system-tool-eyebrow">LOCAL · LIVE TAIL</span><h1>实时日志查看器</h1><p>打开本地 Spring Boot 日志；日志内容不会联网或写入操作历史。</p></div>
      <div class="log-file-actions">
        <button class="button button-primary" :disabled="!desktopAvailable || busy" @click="chooseFile">{{ busy ? '打开中…' : fileName ? '切换日志文件' : '打开本地日志' }}</button>
        <Transition name="fade-fast"><button v-if="filePath" class="button" type="button" @click="toggleFollowing">{{ following ? '暂停跟踪' : '继续跟踪' }}</button></Transition>
        <Transition name="fade-fast"><button v-if="entries.length" class="button" type="button" @click="clearLogs">清空视图</button></Transition>
      </div>
    </header>

    <p v-if="!desktopAvailable" class="system-tool-notice">实时文件跟踪需要 Tauri 桌面版；Web 预览无法持续读取本地日志文件。</p>
    <Transition name="pane-content" mode="out-in"><div v-if="desktopAvailable && filePath" key="log-session" class="log-session">
      <div class="log-source-bar"><span class="log-live-dot" :class="{ paused: !following }"></span><strong :title="filePath">{{ fileName }}</strong><span>{{ notice }}</span><span class="log-source-spacer"></span><span>{{ filteredEntries.length.toLocaleString() }} / {{ entries.length.toLocaleString() }} 行</span></div>
      <Transition name="pane-content"><p v-if="errorMessage" class="system-tool-error" role="alert">{{ errorMessage }}</p></Transition>
      <div class="log-filters">
        <label>关键字 <input v-model="keyword" type="search" placeholder="搜索日志文本" /></label>
        <label>线程 <input v-model="threadFilter" type="search" placeholder="例如 main" /></label>
        <label>开始时间 <input v-model="fromTime" type="datetime-local" /></label>
        <label>结束时间 <input v-model="toTime" type="datetime-local" /></label>
        <button class="button" type="button" @click="keyword = ''; threadFilter = ''; fromTime = ''; toTime = ''">清除筛选</button>
      </div>
      <Transition name="pane-content"><div v-if="droppedEntries" class="log-cap-note">日志视图最多保留 {{ MAX_ENTRIES.toLocaleString() }} 行；较早内容已从内存中移除。</div></Transition>
      <div class="log-list-heading"><span>时间 / 级别</span><span>线程</span><span>日志内容</span><Transition name="fade-fast"><button v-if="!autoFollow" type="button" @click="followLatest">回到最新</button></Transition></div>
      <div :ref="bindViewport" class="log-list-viewport" @scroll="onScroll">
        <div :style="{ height: `${firstVisibleIndex * ROW_HEIGHT}px` }"></div>
        <button v-for="entry in visibleEntries" :key="entry.id" class="log-row" :class="[`level-${entry.level.toLowerCase()}`, { selected: selectedEntry?.id === entry.id }]" type="button" @click="selectedEntry = entry">
          <span class="log-row-time"><time>{{ entry.timestamp || '—' }}</time><b>{{ entry.level }}</b></span>
          <span class="log-row-thread">{{ entry.thread || '—' }}</span>
          <span class="log-row-message">{{ entry.message }}</span>
        </button>
        <div :style="{ height: `${bottomSpacer}px` }"></div>
      </div>
      <Transition name="pane-content"><section v-if="selectedDetails" class="log-selected-detail"><strong>{{ selectedDetails.level }} · {{ selectedDetails.thread || '无线程信息' }}</strong><pre>{{ selectedDetails.message }}</pre></section></Transition>
    </div><div v-else-if="desktopAvailable" key="log-empty" class="system-tool-empty"><strong>选择一个 Spring Boot 日志文件开始</strong><span>支持 .log 与 .txt；首次打开最多载入最近 512 KiB，之后增量读取新增内容。</span></div></Transition>
  </section>
</template>

<style scoped>
.system-tool-page { display: flex; flex-direction: column; gap: 12px; min-width: 0; min-height: 0; padding: clamp(14px, 2.5vw, 26px); overflow: hidden; background: var(--editor-bg); }
.system-tool-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex: 0 0 auto; }
.system-tool-heading h1 { margin: 4px 0; color: var(--text); font-size: 17px; font-weight: 650; }
.system-tool-heading p, .system-tool-eyebrow, .system-tool-notice { margin: 0; color: var(--muted); font-size: 10px; }
.system-tool-eyebrow { color: var(--accent); font-size: 9px; font-weight: 700; letter-spacing: .08em; }
.log-file-actions { display: flex; flex: 0 0 auto; gap: 5px; }
.log-file-actions .button { height: 29px; font-size: 10px; }
.system-tool-notice { padding: 10px 12px; border: 1px solid var(--line); border-radius: 7px; background: var(--panel); }
.system-tool-error { margin: 0; padding: 8px 10px; border: 1px solid color-mix(in srgb, var(--red) 45%, var(--line)); border-radius: 6px; color: var(--red); background: var(--panel); font-size: 10px; }
.system-tool-empty { display: flex; flex: 1 1 auto; flex-direction: column; align-items: center; justify-content: center; gap: 7px; min-height: 120px; color: var(--text); text-align: center; }
.system-tool-empty strong { font-size: 12px; }
.system-tool-empty span { max-width: 460px; color: var(--muted); font-size: 10px; line-height: 1.6; }
.log-session { display: flex; flex: 1 1 auto; flex-direction: column; gap: 12px; min-height: 0; overflow: hidden; }
.log-source-bar { display: flex; align-items: center; gap: 7px; min-width: 0; min-height: 29px; padding: 0 9px; border: 1px solid var(--line-soft); border-radius: 6px; color: var(--muted); background: var(--panel); font-size: 9px; }
.log-source-bar strong { max-width: 240px; overflow: hidden; color: var(--text); text-overflow: ellipsis; white-space: nowrap; }
.log-source-spacer { flex: 1; }
.log-live-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--green); box-shadow: 0 0 8px color-mix(in srgb, var(--green) 55%, transparent); }
.log-live-dot.paused { background: var(--faint); box-shadow: none; }
.log-filters { display: flex; align-items: end; gap: 7px; flex-wrap: wrap; flex: 0 0 auto; }
.log-filters label { display: flex; align-items: center; gap: 5px; color: var(--muted); font-size: 9px; }
.log-filters input { width: 142px; height: 27px; padding: 0 7px; border: 1px solid var(--line); border-radius: 5px; outline: 0; color: var(--text); background: var(--panel); font: inherit; font-size: 10px; }
.log-filters label:nth-child(n+3) input { width: 155px; }
.log-filters input:focus { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-wash); }
.log-filters .button { height: 27px; font-size: 9px; }
.log-cap-note { color: var(--muted); font-size: 9px; }
.log-list-heading, .log-row { display: grid; grid-template-columns: minmax(175px, 245px) minmax(75px, 150px) minmax(0, 1fr); align-items: center; gap: 10px; }
.log-list-heading { grid-template-columns: minmax(175px, 245px) minmax(75px, 150px) minmax(0, 1fr) auto; min-height: 27px; padding: 0 9px; border-bottom: 1px solid var(--line); color: var(--muted); font-size: 9px; }
.log-list-heading button { justify-self: end; border: 0; color: var(--accent); background: transparent; font: inherit; cursor: pointer; }
.log-list-viewport { flex: 1 1 auto; min-height: 140px; overflow: auto; overscroll-behavior: contain; border: 1px solid var(--line-soft); border-radius: 6px; background: var(--bg); scrollbar-gutter: stable; }
.log-row { width: 100%; height: 30px; padding: 0 9px; border: 0; border-bottom: 1px solid var(--line-soft); color: var(--text); background: transparent; text-align: left; cursor: pointer; }
.log-row:hover, .log-row.selected { background: var(--panel-hover); }
.log-row-time { display: flex; align-items: center; gap: 6px; min-width: 0; }
.log-row time, .log-row-thread, .log-row-message { overflow: hidden; color: var(--muted); font: 10px/1.3 "Cascadia Code", Consolas, monospace; text-overflow: ellipsis; white-space: nowrap; }
.log-row-time b { padding: 2px 4px; border-radius: 3px; font: 700 8px/1 Inter, sans-serif; }
.level-error .log-row-time b { color: var(--red); background: color-mix(in srgb, var(--red) 12%, transparent); }
.level-warn .log-row-time b { color: var(--yellow); background: color-mix(in srgb, var(--yellow) 12%, transparent); }
.level-info .log-row-time b { color: var(--accent); background: var(--accent-wash); }
.level-other .log-row-time b { color: var(--faint); background: var(--panel); }
.level-error .log-row-message { color: color-mix(in srgb, var(--red) 84%, var(--text)); }
.level-warn .log-row-message { color: color-mix(in srgb, var(--yellow) 84%, var(--text)); }
.log-selected-detail { flex: 0 0 auto; max-height: 150px; padding: 8px 10px; overflow: auto; border: 1px solid var(--line); border-radius: 6px; background: var(--panel); }
.log-selected-detail strong { color: var(--text); font-size: 10px; }
.log-selected-detail pre { margin: 6px 0 0; color: var(--muted); font: 10px/1.5 "Cascadia Code", Consolas, monospace; white-space: pre-wrap; overflow-wrap: anywhere; }
@media (max-width: 980px) { .log-filters label:nth-child(n+3) { display: none; } .log-list-heading, .log-row { grid-template-columns: minmax(135px, 190px) minmax(60px, 95px) minmax(0, 1fr); gap: 6px; } }
@media (prefers-reduced-motion: reduce) { .log-live-dot { box-shadow: none; } }
</style>
