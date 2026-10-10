<script setup lang="ts">
import { computed, ref } from 'vue'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { confirm } from '@tauri-apps/plugin-dialog'
import { parseLocalPort } from '../core/ports'

type PortUsage = {
  protocol: 'TCP' | 'UDP'
  localAddress: string
  port: number
  state: string
  pid: number
  processName: string
  processPath: string | null
  processStartedAtTicks: string | null
}

const portText = ref('9095')
const rows = ref<PortUsage[]>([])
const selected = ref<PortUsage>()
const queried = ref(false)
const busy = ref(false)
const errorMessage = ref('')
const notice = ref('')
const desktopAvailable = isTauri()
const stateLabel = (state: string) => ({ Listen: '监听中', Established: '已建立', Bound: '已绑定', TimeWait: '等待关闭', CloseWait: '等待关闭' }[state] ?? state)
const selectedDetails = computed(() => selected.value)

async function queryPort() {
  if (!desktopAvailable || busy.value) return
  let port: number
  try { port = parseLocalPort(portText.value) }
  catch (error) { errorMessage.value = (error as Error).message; rows.value = []; queried.value = true; return }
  busy.value = true
  errorMessage.value = ''
  notice.value = ''
  selected.value = undefined
  try {
    rows.value = await invoke<PortUsage[]>('find_port_usage', { port })
    queried.value = true
  } catch (error) {
    rows.value = []
    queried.value = true
    errorMessage.value = (error as Error).message || '查询本机端口失败'
  } finally { busy.value = false }
}

async function copyPid(pid: number) {
  try {
    await navigator.clipboard.writeText(String(pid))
    notice.value = `PID ${pid} 已复制`
  } catch { errorMessage.value = '复制失败，请检查系统剪贴板权限' }
}

async function terminate(row: PortUsage) {
  if (busy.value || !row.processPath || !row.processStartedAtTicks) return
  const accepted = await confirm(
    `端口：${row.protocol} ${row.localAddress}:${row.port}\n进程：${row.processName}\nPID：${row.pid}\n路径：${row.processPath}\n\n结束进程可能导致未保存数据丢失，操作不可撤销。`,
    { title: '二次确认：结束本机进程', kind: 'warning' },
  )
  if (!accepted) return
  busy.value = true
  errorMessage.value = ''
  notice.value = ''
  try {
    await invoke('terminate_port_process', {
      pid: row.pid,
      processName: row.processName,
      processPath: row.processPath,
      processStartedAtTicks: row.processStartedAtTicks,
    })
    const successNotice = `${row.processName}（PID ${row.pid}）已结束`
    busy.value = false
    await queryPort()
    if (!errorMessage.value) notice.value = successNotice
  } catch (error) {
    errorMessage.value = (error as Error).message || '结束进程失败'
  } finally { busy.value = false }
}
</script>

<template>
  <section class="system-tool-page port-inspector">
    <header class="system-tool-heading">
      <div><span class="system-tool-eyebrow">LOCAL · WINDOWS</span><h1>端口占用检测器</h1><p>查询本机 TCP / UDP 端口与对应进程；不会向网络发送请求。</p></div>
    </header>

    <div class="port-query-row">
      <label for="local-port">本机端口</label>
      <input id="local-port" v-model="portText" type="text" inputmode="numeric" maxlength="5" placeholder="例如 9095" :disabled="!desktopAvailable || busy" @keydown.enter="queryPort" />
      <button class="button button-primary" :disabled="!desktopAvailable || busy" @click="queryPort">{{ busy ? '处理中…' : '查询端口' }}</button>
      <span class="hint">范围 1–65535</span>
    </div>

    <Transition name="pane-content"><p v-if="!desktopAvailable" class="system-tool-notice">端口进程查询需要 Windows 桌面版；Web 预览无法读取本机进程信息。</p></Transition>
    <Transition name="pane-content"><p v-if="errorMessage" class="system-tool-error" role="alert">{{ errorMessage }}</p></Transition>
    <Transition name="pane-content"><p v-if="!errorMessage && notice" class="system-tool-notice" role="status">{{ notice }}</p></Transition>

    <Transition name="pane-content"><div v-if="queried && !errorMessage && !rows.length" class="system-tool-empty">
      <strong>没有发现占用 {{ portText }} 的 TCP 或 UDP 端点</strong><span>如果服务刚刚启动，请稍后重新查询。</span>
    </div></Transition>
    <Transition name="pane-content"><div v-if="rows.length" class="port-results-wrap">
      <div class="port-results-heading"><strong>端点</strong><span>{{ rows.length }} 条 · 查询结果会随系统状态变化</span></div>
      <div class="port-results-list">
        <article v-for="(row, index) in rows" :key="`${row.protocol}-${row.localAddress}-${row.pid}-${row.state}-${index}`" class="port-result-card" :class="{ selected: selected === row }">
          <button class="port-result-main" type="button" :aria-expanded="selected === row" @click="selected = selected === row ? undefined : row">
            <span class="port-protocol" :class="row.protocol.toLowerCase()">{{ row.protocol }}</span>
            <span class="port-endpoint"><strong>{{ row.localAddress }}:{{ row.port }}</strong><small>{{ stateLabel(row.state) }}</small></span>
            <span class="port-owner"><strong>{{ row.processName }}</strong><small>PID {{ row.pid }}</small></span>
            <span class="port-expand">{{ selected === row ? '收起' : '详情' }}</span>
          </button>
          <div class="port-result-actions">
            <button class="button" type="button" @click="copyPid(row.pid)">复制 PID</button>
            <button class="button port-danger" type="button" :disabled="busy || !row.processPath || !row.processStartedAtTicks" :title="!row.processPath || !row.processStartedAtTicks ? '系统未提供足够的进程身份信息' : '结束该进程前会再次确认'" @click="terminate(row)">结束进程</button>
          </div>
        </article>
      </div>
      <Transition name="pane-content"><section v-if="selectedDetails" class="port-process-details" aria-live="polite">
        <div><span>进程</span><strong>{{ selectedDetails.processName }}</strong></div>
        <div><span>PID</span><strong>{{ selectedDetails.pid }}</strong></div>
        <div><span>端点</span><strong>{{ selectedDetails.protocol }} · {{ selectedDetails.localAddress }}:{{ selectedDetails.port }} · {{ stateLabel(selectedDetails.state) }}</strong></div>
        <div><span>程序路径</span><code>{{ selectedDetails.processPath || '系统未返回路径（可能受权限限制）' }}</code></div>
        <small>结束进程会先核对 PID、进程路径和启动时间，避免 PID 被复用时结束到其他进程。</small>
      </section></Transition>
    </div></Transition>
    <Transition name="pane-content"><div v-if="!queried && desktopAvailable" class="system-tool-empty"><strong>输入端口后查询</strong><span>支持 TCP 连接状态和 UDP 绑定端点。</span></div></Transition>
  </section>
</template>

<style scoped>
.system-tool-page { display: flex; flex-direction: column; gap: 18px; min-width: 0; min-height: 0; padding: clamp(16px, 3vw, 30px); overflow: auto; background: var(--editor-bg); }
.system-tool-heading h1 { margin: 5px 0 4px; color: var(--text); font-size: 18px; font-weight: 650; }
.system-tool-heading p, .system-tool-eyebrow, .system-tool-notice, .system-tool-empty span, .port-results-heading span { color: var(--muted); font-size: 11px; }
.system-tool-heading p { margin: 0; }
.system-tool-eyebrow { color: var(--accent); font-size: 9px; font-weight: 700; letter-spacing: .08em; }
.port-query-row { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; }
.port-query-row label { color: var(--muted); font-size: 11px; }
.port-query-row input { width: 140px; height: 32px; padding: 0 9px; border: 1px solid var(--line); border-radius: 6px; color: var(--text); background: var(--panel); font: inherit; }
.port-query-row input:focus { border-color: var(--accent); outline: 0; box-shadow: 0 0 0 2px var(--accent-wash); }
.port-query-row .hint { font-size: 10px; }
.system-tool-error, .system-tool-notice { margin: 0; padding: 10px 12px; border: 1px solid var(--line); border-radius: 7px; background: var(--panel); }
.system-tool-error { border-color: color-mix(in srgb, var(--red) 45%, var(--line)); color: var(--red); font-size: 11px; }
.system-tool-empty { display: flex; flex-direction: column; gap: 6px; padding: 22px; border: 1px dashed var(--line); border-radius: 9px; color: var(--text); background: var(--panel); font-size: 12px; }
.port-results-heading { display: flex; align-items: baseline; gap: 9px; color: var(--text); font-size: 12px; }
.port-results-list { display: flex; flex-direction: column; gap: 7px; }
.port-results-wrap { display: flex; flex-direction: column; gap: 12px; min-height: 0; }
.port-result-card { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; border: 1px solid var(--line); border-radius: 8px; background: var(--panel); transition: border-color .16s ease, background-color .18s ease; }
.port-result-card.selected { border-color: color-mix(in srgb, var(--accent) 50%, var(--line)); }
.port-result-main { display: grid; grid-template-columns: 48px minmax(140px, .8fr) minmax(150px, 1fr) 45px; align-items: center; gap: 10px; min-width: 0; padding: 11px 13px; border: 0; color: var(--text); background: transparent; text-align: left; cursor: pointer; }
.port-protocol { justify-self: start; padding: 4px 6px; border-radius: 4px; color: var(--accent); background: var(--accent-wash); font-size: 9px; font-weight: 700; }
.port-protocol.udp { color: var(--green); background: color-mix(in srgb, var(--green) 10%, transparent); }
.port-endpoint, .port-owner { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.port-endpoint strong, .port-owner strong { overflow: hidden; color: var(--text); font-size: 11px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.port-endpoint small, .port-owner small { color: var(--muted); font-size: 10px; }
.port-expand { color: var(--accent); font-size: 10px; }
.port-result-actions { display: flex; gap: 4px; padding: 0 8px; }
.port-result-actions .button { height: 27px; font-size: 10px; }
.port-danger { color: var(--red); }
.port-danger:hover:not(:disabled) { border-color: color-mix(in srgb, var(--red) 40%, var(--line)); color: var(--red); background: color-mix(in srgb, var(--red) 8%, transparent); }
.port-danger:disabled { opacity: .4; cursor: not-allowed; }
.port-process-details { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px 20px; padding: 15px; border: 1px solid var(--line); border-radius: 8px; background: var(--panel); }
.port-process-details > div { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.port-process-details span, .port-process-details small { color: var(--muted); font-size: 10px; }
.port-process-details strong, .port-process-details code { overflow-wrap: anywhere; color: var(--text); font-size: 11px; font-weight: 550; }
.port-process-details small { grid-column: 1 / -1; }
@media (max-width: 1050px) { .port-result-card { grid-template-columns: minmax(0, 1fr); } .port-result-actions { justify-content: flex-end; padding: 0 8px 8px; } }
@media (max-width: 790px) { .port-result-main { grid-template-columns: 42px minmax(0, 1fr) minmax(90px, .8fr) 38px; gap: 6px; padding: 10px 8px; } .port-process-details { grid-template-columns: minmax(0, 1fr); } .port-process-details small { grid-column: auto; } }
</style>
