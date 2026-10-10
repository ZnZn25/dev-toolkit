<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { RUNNER, RunnerSimulation, type RunnerEvent } from '../core/runner-game.ts'
import { RUNNER_EVOLUTIONS, evolutionForLevel } from '../core/runner-evolution.ts'
import { loadRunnerAudioSettings, RunnerAudioManager } from '../core/runner-audio.ts'
import { renderRunner } from '../core/runner-renderer.ts'
import { loadRunnerBestScore, loadRunnerEvolutionRecord, saveRunnerBestScore, saveRunnerEvolutionRecord } from '../core/runner-record.ts'

const props = defineProps<{ active: boolean; theme: 'dark' | 'light'; effects: 'full' | 'reduced' | 'off' }>()
const STEP = 1 / 60
const MAX_FRAME_SECONDS = 0.1

const savedEvolution = loadRunnerEvolutionRecord()
const simulation = new RunnerSimulation(loadRunnerBestScore(), Math.random, savedEvolution)
const ui = reactive({
  status: simulation.state.status,
  score: simulation.state.score,
  bestScore: simulation.state.bestScore,
  health: simulation.state.health,
  maxHealth: simulation.state.maxHealth,
  coins: simulation.state.coinsCollected,
  lifetimeCoins: simulation.state.lifetimeCoins,
  evolutionLevel: simulation.state.evolutionLevel,
  highestEvolutionLevel: simulation.state.highestEvolutionLevel,
  evolutionRemaining: simulation.state.evolutionRemaining,
  shield: simulation.state.activePowerUps.shield,
  slowRemaining: simulation.state.activePowerUps.slowRemaining,
  magnetRemaining: simulation.state.activePowerUps.magnetRemaining,
  dashRemaining: simulation.state.activePowerUps.dashRemaining,
  elapsed: simulation.state.elapsed,
  speed: simulation.state.speed,
})
const audioSettings = reactive(loadRunnerAudioSettings())
const audio = new RunnerAudioManager(audioSettings)
const audioPanelOpen = ref(false)
const fullscreen = ref(false)
const gameRoot = ref<HTMLElement>()
const stage = ref<HTMLDivElement>()
const canvas = ref<HTMLCanvasElement>()
const elapsedLabel = computed(() => {
  const seconds = Math.floor(ui.elapsed)
  return Math.floor(seconds / 60).toString().padStart(2, '0') + ':' + (seconds % 60).toString().padStart(2, '0')
})
const statusLabel = computed(() => ({ ready: '准备就绪', running: '奔跑中', paused: '已暂停', 'game-over': '本局结束' })[ui.status])
const currentEvolution = computed(() => evolutionForLevel(ui.evolutionLevel))
const evolutionAccent = computed(() => currentEvolution.value.glow === 'transparent' ? currentEvolution.value.trim : currentEvolution.value.glow)
const nextEvolution = computed(() => RUNNER_EVOLUTIONS[ui.evolutionLevel] ?? null)
const evolutionProgress = computed(() => {
  if (!nextEvolution.value) return 1
  const currentThreshold = currentEvolution.value.requiredCoins
  return Math.max(0, Math.min(1, (ui.coins - currentThreshold) / (nextEvolution.value.requiredCoins - currentThreshold)))
})
const coinsToNextEvolution = computed(() => nextEvolution.value ? Math.max(0, nextEvolution.value.requiredCoins - ui.coins) : 0)
const activeEffects = computed(() => [
  { key: 'shield', icon: '🛡', label: '护盾', remaining: ui.shield ? '可抵挡一次' : '', progress: ui.shield ? 1 : 0 },
  { key: 'slow', icon: '❄', label: '减速', remaining: ui.slowRemaining, progress: ui.slowRemaining / 5 },
  { key: 'magnet', icon: '🧲', label: '磁铁', remaining: ui.magnetRemaining, progress: ui.magnetRemaining / 8 },
  { key: 'dash', icon: '⚡', label: '冲刺', remaining: ui.dashRemaining, progress: ui.dashRemaining / 4 },
].filter(effect => Boolean(effect.remaining)))

let animationFrame = 0
let lastFrameTime = 0
let accumulator = 0
let resizeObserver: ResizeObserver | undefined
let saveTimer: number | undefined
let savedBestScore = simulation.state.bestScore
let savedLifetimeCoins = simulation.state.lifetimeCoins
let savedHighestEvolutionLevel = simulation.state.highestEvolutionLevel
let spaceHeld = false
let ctrlHeld = false

function syncUi(): void {
  ui.status = simulation.state.status
  ui.score = simulation.state.score
  ui.bestScore = simulation.state.bestScore
  ui.health = simulation.state.health
  ui.maxHealth = simulation.state.maxHealth
  ui.coins = simulation.state.coinsCollected
  ui.lifetimeCoins = simulation.state.lifetimeCoins
  ui.evolutionLevel = simulation.state.evolutionLevel
  ui.highestEvolutionLevel = simulation.state.highestEvolutionLevel
  ui.evolutionRemaining = simulation.state.evolutionRemaining
  ui.shield = simulation.state.activePowerUps.shield
  ui.slowRemaining = simulation.state.activePowerUps.slowRemaining
  ui.magnetRemaining = simulation.state.activePowerUps.magnetRemaining
  ui.dashRemaining = simulation.state.activePowerUps.dashRemaining
  ui.elapsed = simulation.state.elapsed
  ui.speed = simulation.state.worldSpeed
}

function syncAudioState(): void {
  audio.setState(props.active ? simulation.state.status : 'inactive', simulation.state.speed)
}

function flushRecords(): void {
  if (saveTimer !== undefined) window.clearTimeout(saveTimer)
  saveTimer = undefined
  if (simulation.state.bestScore > savedBestScore) {
    savedBestScore = simulation.state.bestScore
    saveRunnerBestScore(savedBestScore)
  }
  if (simulation.state.lifetimeCoins > savedLifetimeCoins || simulation.state.highestEvolutionLevel > savedHighestEvolutionLevel) {
    savedLifetimeCoins = simulation.state.lifetimeCoins
    savedHighestEvolutionLevel = simulation.state.highestEvolutionLevel
    saveRunnerEvolutionRecord({ lifetimeCoins: savedLifetimeCoins, highestEvolutionLevel: savedHighestEvolutionLevel })
  }
}

function scheduleRecordSave(): void {
  if (simulation.state.bestScore <= savedBestScore && simulation.state.lifetimeCoins <= savedLifetimeCoins && simulation.state.highestEvolutionLevel <= savedHighestEvolutionLevel) return
  if (saveTimer !== undefined) window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(flushRecords, 500)
}

function resizeCanvas(): void {
  const target = canvas.value
  const bounds = stage.value?.getBoundingClientRect()
  if (!target || !bounds || bounds.width <= 0 || bounds.height <= 0) return
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  target.width = Math.round(bounds.width * dpr)
  target.height = Math.round(bounds.height * dpr)
  const scale = bounds.height / RUNNER.height
  simulation.setViewWidth(bounds.width / scale)
  const context = target.getContext('2d')
  if (!context) return
  context.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0)
  renderRunner(context, simulation.state, props.effects)
}

function render(): void {
  const target = canvas.value
  const bounds = stage.value?.getBoundingClientRect()
  const context = target?.getContext('2d')
  if (!target || !bounds || !context || bounds.height <= 0) return
  const scale = bounds.height / RUNNER.height
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  context.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0)
  renderRunner(context, simulation.state, props.effects)
}

function hasAnimation(): boolean {
  return props.active && (simulation.state.status === 'running' || simulation.state.impactRemaining > 0)
}

function frame(timestamp: number): void {
  animationFrame = 0
  const elapsed = lastFrameTime ? Math.min(MAX_FRAME_SECONDS, Math.max(0, (timestamp - lastFrameTime) / 1000)) : 0
  lastFrameTime = timestamp

  if (simulation.state.status === 'running') {
    accumulator = Math.min(accumulator + elapsed, MAX_FRAME_SECONDS)
    while (accumulator >= STEP) {
      handleEvents(simulation.step(STEP))
      accumulator -= STEP
    }
    syncUi()
    syncAudioState()
    scheduleRecordSave()
  }
  else if (simulation.state.status === 'game-over' && simulation.state.impactRemaining > 0) {
    simulation.step(elapsed)
  }

  render()
  if (hasAnimation()) animationFrame = requestAnimationFrame(frame)
  else lastFrameTime = 0
}

function startAnimation(): void {
  if (!props.active || animationFrame || !hasAnimation()) return
  lastFrameTime = 0
  animationFrame = requestAnimationFrame(frame)
}

function stopAnimation(): void {
  if (animationFrame) cancelAnimationFrame(animationFrame)
  animationFrame = 0
  lastFrameTime = 0
  accumulator = 0
}

function handleEvents(events: RunnerEvent[]): void {
  for (const event of events) audio.play(event)
  if (events.includes('coin')) scheduleRecordSave()
}

function refresh(): void {
  syncUi()
  syncAudioState()
  render()
}

function begin(): void {
  void audio.unlock()
  simulation.start()
  simulation.setSlideHeld(ctrlHeld)
  refresh()
  startAnimation()
  nextTick(() => stage.value?.focus({ preventScroll: true }))
}

function restart(): void {
  void audio.unlock()
  spaceHeld = false
  ctrlHeld = false
  simulation.restart(true)
  refresh()
  startAnimation()
  nextTick(() => stage.value?.focus({ preventScroll: true }))
}

function togglePause(): void {
  spaceHeld = false
  ctrlHeld = false
  simulation.setGlideHeld(false)
  simulation.setSlideHeld(false)
  if (simulation.state.status === 'running') {
    simulation.pause()
    stopAnimation()
  }
  else if (simulation.state.status === 'paused') {
    simulation.resume()
    startAnimation()
  }
  refresh()
  nextTick(() => stage.value?.focus({ preventScroll: true }))
}

function onStageKeydown(event: KeyboardEvent): void {
  if (event.code === 'ControlLeft' || event.code === 'ControlRight' || event.key === 'Control') {
    event.preventDefault()
    if (!event.repeat) {
      ctrlHeld = true
      simulation.setSlideHeld(true)
      refresh()
    }
    return
  }
  if (event.ctrlKey && ['p', 'r'].includes(event.key.toLowerCase())) {
    event.preventDefault()
    return
  }

  if (event.code === 'Space' || event.key === ' ') {
    event.preventDefault()
    if (event.repeat || spaceHeld) return
    spaceHeld = true
    if (simulation.state.status === 'ready') begin()
    else if (simulation.state.status === 'paused') togglePause()
    else if (simulation.state.status === 'running') {
      simulation.setGlideHeld(true)
      const jumpEvent = simulation.jump()
      if (!jumpEvent) return
      audio.play(jumpEvent)
      refresh()
      startAnimation()
    }
    else if (simulation.state.status === 'game-over') restart()
    return
  }

  if (event.repeat) return
  const key = event.key.toLowerCase()
  if (key === 'p' || key === 'escape') {
    event.preventDefault()
    if (simulation.state.status === 'running' || simulation.state.status === 'paused') togglePause()
  }
  else if (key === 'r') {
    event.preventDefault()
    restart()
  }
}

function onWindowKeyup(event: KeyboardEvent): void {
  if (event.code === 'ControlLeft' || event.code === 'ControlRight' || event.key === 'Control') {
    ctrlHeld = false
    simulation.setSlideHeld(false)
  }
  if (event.code === 'Space' || event.key === ' ') {
    spaceHeld = false
    simulation.setGlideHeld(false)
  }
}

function onStagePointerDown(event: PointerEvent): void {
  if ((event.target as Element).closest('button')) return
  void audio.unlock()
  stage.value?.focus({ preventScroll: true })
}

function onWindowBlur(): void {
  spaceHeld = false
  ctrlHeld = false
  simulation.setGlideHeld(false)
  simulation.setSlideHeld(false)
  if (simulation.state.status === 'running') {
    simulation.pause()
    stopAnimation()
    audio.setState('paused')
    refresh()
  }
}

function onVisibilityChange(): void {
  if (document.visibilityState === 'hidden') onWindowBlur()
}

function onPageHide(): void {
  flushRecords()
  audio.setState('inactive')
}

function onPageShow(): void { syncAudioState() }

function toggleSound(): void {
  audio.setSfxEnabled(!audioSettings.sfxEnabled)
  if (audioSettings.sfxEnabled) void audio.unlock()
}

function toggleMusic(): void {
  audio.setBgmEnabled(!audioSettings.bgmEnabled)
  if (audioSettings.bgmEnabled) void audio.unlock()
}

function toggleMute(): void {
  audio.setMuted(!audioSettings.muted)
  if (!audioSettings.muted) void audio.unlock()
}

function toggleAudioPanel(): void {
  audioPanelOpen.value = !audioPanelOpen.value
  void audio.unlock()
}

function changeVolume(channel: 'bgm' | 'sfx', event: Event): void {
  const value = Number((event.target as HTMLInputElement).value)
  audio.setVolume(channel, value)
}

async function toggleFullscreen(): Promise<void> {
  try {
    if (document.fullscreenElement === gameRoot.value) await document.exitFullscreen()
    else await gameRoot.value?.requestFullscreen()
  }
  catch { /* Fullscreen is optional when the host does not expose the browser API. */ }
}

function onFullscreenChange(): void {
  fullscreen.value = document.fullscreenElement === gameRoot.value
  resizeCanvas()
}

watch(() => props.active, (active) => {
  if (!active) {
    spaceHeld = false
    ctrlHeld = false
    simulation.setGlideHeld(false)
    simulation.setSlideHeld(false)
    simulation.pause()
    stopAnimation()
    stage.value?.blur()
    refresh()
    return
  }
  refresh()
  nextTick(() => stage.value?.focus({ preventScroll: true }))
  startAnimation()
}, { flush: 'sync' })

onMounted(() => {
  resizeObserver = new ResizeObserver(resizeCanvas)
  if (stage.value) resizeObserver.observe(stage.value)
  window.addEventListener('blur', onWindowBlur)
  window.addEventListener('keyup', onWindowKeyup)
  window.addEventListener('pagehide', onPageHide)
  document.addEventListener('visibilitychange', onVisibilityChange)
  document.addEventListener('fullscreenchange', onFullscreenChange)
  window.addEventListener('pageshow', onPageShow)
  syncAudioState()
  resizeCanvas()
})

onBeforeUnmount(() => {
  simulation.setGlideHeld(false)
  simulation.setSlideHeld(false)
  stopAnimation()
  resizeObserver?.disconnect()
  window.removeEventListener('blur', onWindowBlur)
  window.removeEventListener('keyup', onWindowKeyup)
  window.removeEventListener('pagehide', onPageHide)
  document.removeEventListener('visibilitychange', onVisibilityChange)
  document.removeEventListener('fullscreenchange', onFullscreenChange)
  window.removeEventListener('pageshow', onPageShow)
  if (saveTimer !== undefined) window.clearTimeout(saveTimer)
  flushRecords()
  audio.dispose()
})
</script>

<template>
  <section ref="gameRoot" class="runner-game" :class="{ 'theme-light': theme === 'light' }" aria-label="杨远航快跑游戏">
    <header class="runner-header">
      <div class="runner-title"><strong>杨远航快跑</strong><span>杨远航今天也要全力冲刺！</span></div>
      <div class="runner-scoreboard" aria-label="本局游戏数据">
        <div class="runner-stat"><span>当前得分</span><strong>{{ ui.score.toLocaleString() }}</strong></div>
        <div class="runner-stat runner-coin-stat"><span>本局金币</span><strong>◉ {{ ui.coins }}</strong></div>
        <div class="runner-stat runner-life-stat" :aria-label="`生命值 ${ui.health}/${ui.maxHealth}`"><span>生命</span><strong class="runner-hearts" aria-hidden="true"><i v-for="index in ui.maxHealth" :key="index" :class="{ 'is-empty': index > ui.health }">♥</i></strong></div>
        <div class="runner-stat"><span>最高纪录</span><strong>{{ ui.bestScore.toLocaleString() }}</strong></div>
        <div class="runner-stat runner-stat-optional"><span>速度</span><strong>{{ Math.round(ui.speed) }}</strong></div>
        <div class="runner-stat runner-stat-optional"><span>存活时间</span><strong>{{ elapsedLabel }}</strong></div>
      </div>
      <div class="runner-actions">
        <div class="runner-volume-wrap">
          <button class="runner-icon-button" :class="{ 'is-muted': audioSettings.muted || (!audioSettings.bgmEnabled && !audioSettings.sfxEnabled) }" type="button" aria-label="音频设置" title="音频设置" :aria-expanded="audioPanelOpen" @click="toggleAudioPanel">{{ audioSettings.muted ? '🔇' : '♫' }}</button>
          <div v-if="audioPanelOpen" class="runner-audio-popover">
            <div class="runner-audio-toggles">
              <button type="button" :aria-pressed="audioSettings.bgmEnabled" @click="toggleMusic">BGM {{ audioSettings.bgmEnabled ? '开' : '关' }}</button>
              <button type="button" :aria-pressed="audioSettings.sfxEnabled" @click="toggleSound">音效 {{ audioSettings.sfxEnabled ? '开' : '关' }}</button>
              <button type="button" :aria-pressed="audioSettings.muted" @click="toggleMute">{{ audioSettings.muted ? '取消静音' : '静音' }}</button>
            </div>
            <label><span>背景音乐 <b>{{ Math.round(audioSettings.bgmVolume * 100) }}%</b></span><input type="range" min="0" max="1" step="0.01" :value="audioSettings.bgmVolume" @input="changeVolume('bgm', $event)"></label>
            <label><span>游戏音效 <b>{{ Math.round(audioSettings.sfxVolume * 100) }}%</b></span><input type="range" min="0" max="1" step="0.01" :value="audioSettings.sfxVolume" @input="changeVolume('sfx', $event)"></label>
          </div>
        </div>
        <button class="runner-icon-button" type="button" :aria-label="fullscreen ? '退出全屏' : '进入全屏'" :title="fullscreen ? '退出全屏' : '进入全屏'" @click="toggleFullscreen">{{ fullscreen ? '⤢' : '⛶' }}</button>
      </div>
    </header>

    <div class="runner-stage-wrap">
      <div ref="stage" class="runner-stage" tabindex="0" role="application" aria-label="游戏区域。空格跳跃并可在下落时滑翔，Ctrl 下铲，P 暂停，R 重新开始，Esc 暂停" @keydown="onStageKeydown" @pointerdown="onStagePointerDown">
        <canvas ref="canvas" class="runner-canvas" aria-hidden="true"></canvas>
        <div class="runner-evolution-panel" :class="{ 'is-evolving': ui.evolutionRemaining > 0 }" :style="{ '--evolution-color': evolutionAccent }" aria-live="polite">
          <div class="runner-evolution-heading"><strong>{{ currentEvolution.title }} Lv.{{ ui.evolutionLevel }}</strong><span v-if="ui.evolutionRemaining > 0">进化成功！</span></div>
          <div class="runner-evolution-track"><i :style="{ width: `${evolutionProgress * 100}%` }"></i></div>
          <small v-if="nextEvolution">本局金币 {{ ui.coins }} / {{ nextEvolution.requiredCoins }} · 距进化 {{ coinsToNextEvolution }}</small>
          <small v-else>已达到终极形态 · 累计金币 {{ ui.lifetimeCoins }} · 历史最高 Lv.{{ ui.highestEvolutionLevel }}</small>
        </div>
        <div v-if="activeEffects.length" class="runner-active-effects" aria-label="已激活道具">
          <div v-for="effect in activeEffects" :key="effect.key" class="runner-effect-chip" :class="'effect-' + effect.key">
            <span class="runner-effect-icon" aria-hidden="true">{{ effect.icon }}</span>
            <span class="runner-effect-detail"><span><strong>{{ effect.label }}</strong><small>{{ typeof effect.remaining === 'string' ? effect.remaining : `${effect.remaining.toFixed(1)} 秒` }}</small></span><i><b :style="{ width: `${Math.max(0, Math.min(1, effect.progress)) * 100}%` }"></b></i></span>
          </div>
        </div>
        <div v-if="ui.status === 'ready'" class="runner-overlay">
          <div class="runner-card"><span class="runner-card-mark" aria-hidden="true">跑</span><h1>杨远航快跑</h1><p>按空格键开始奔跑！</p><small>空中下落时按住空格可滑翔，按住 Ctrl 可下铲。</small><button class="runner-primary-button" type="button" @click="begin">开始奔跑</button></div>
        </div>
        <div v-else-if="ui.status === 'paused'" class="runner-overlay">
          <div class="runner-card"><span class="runner-card-mark" aria-hidden="true">Ⅱ</span><h2>休息一下</h2><p>杨远航正在原地喝口水。</p><small>按 P 或空格继续奔跑</small><button class="runner-primary-button" type="button" @click="togglePause">继续奔跑</button></div>
        </div>
        <div v-else-if="ui.status === 'game-over'" class="runner-overlay">
          <div class="runner-card"><span class="runner-card-mark" aria-hidden="true">✦</span><h2>杨远航撞上障碍物啦！</h2><p>本次得分：<strong>{{ ui.score.toLocaleString() }}</strong></p><small>按 R 或空格键重新开始</small><button class="runner-primary-button" type="button" @click="restart">再跑一次</button></div>
        </div>
      </div>
      <div class="runner-footer"><span><i class="runner-status-dot" :class="'is-' + ui.status"></i>{{ statusLabel }}</span><span>空格跳跃/滑翔 <b>·</b> Ctrl 下铲 <b>·</b> P 暂停 <b>·</b> R 重开</span></div>
    </div>
  </section>
</template>

<style scoped>
.runner-game { display: grid; grid-template-rows: auto minmax(0, 1fr); gap: 10px; width: 100%; height: 100%; min-width: 0; min-height: 0; padding: 13px 16px 11px; color: var(--text); background: var(--bg); }
.runner-header { position: relative; z-index: 2; display: flex; align-items: center; gap: 18px; min-width: 0; padding: 1px 3px; }
.runner-title { display: flex; flex-direction: column; gap: 3px; min-width: 160px; }
.runner-title strong { color: var(--text); font-size: 16px; font-weight: 750; letter-spacing: .02em; }
.runner-title span { color: var(--muted); font-size: 10px; }
.runner-scoreboard { display: flex; align-items: center; gap: 8px; margin-left: auto; }
.runner-stat { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; min-width: 70px; padding: 5px 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--panel); }
.runner-stat span { color: var(--muted); font-size: 9px; white-space: nowrap; }
.runner-stat strong { color: var(--text); font-size: 13px; font-variant-numeric: tabular-nums; }
.runner-stat:nth-child(1) strong { color: var(--accent); }
.runner-stat:nth-child(4) strong { color: var(--green); }
.runner-coin-stat strong { color: #d99525; }
.runner-hearts { display: flex; gap: 2px; color: #ec6879; line-height: 1; }
.runner-life-stat .runner-hearts { color: #ec6879; }
.runner-hearts i { font-size: 12px; font-style: normal; }
.runner-hearts i.is-empty { color: var(--faint); opacity: .55; }
.runner-actions { display: flex; align-items: center; gap: 5px; }
.runner-icon-button { display: grid; place-items: center; width: 31px; height: 31px; border: 1px solid var(--line); border-radius: 7px; color: var(--muted); background: var(--panel); font-size: 15px; cursor: pointer; }
.runner-icon-button:hover { border-color: var(--accent); color: var(--accent); }
.runner-icon-button.is-muted { opacity: .55; }
.runner-volume-wrap { position: relative; }
.runner-audio-popover { position: absolute; z-index: 5; top: 38px; right: 0; display: flex; flex-direction: column; gap: 12px; width: 205px; padding: 12px; border: 1px solid var(--line); border-radius: 10px; background: var(--panel); box-shadow: 0 10px 30px #0003; }
.runner-audio-toggles { display: flex; align-items: center; justify-content: space-between; gap: 4px; }
.runner-audio-toggles button { padding: 5px 7px; border: 1px solid var(--line); border-radius: 6px; color: var(--muted); background: var(--bg); font-size: 9px; cursor: pointer; }
.runner-audio-toggles button[aria-pressed="true"] { border-color: var(--accent); color: var(--accent); }
.runner-audio-popover label { display: flex; flex-direction: column; gap: 6px; color: var(--text); font-size: 10px; }
.runner-audio-popover label span { display: flex; justify-content: space-between; }
.runner-audio-popover label b { color: var(--muted); font-variant-numeric: tabular-nums; }
.runner-audio-popover input { width: 100%; margin: 0; accent-color: var(--accent); }
.runner-stage-wrap { display: grid; grid-template-rows: minmax(0, 1fr) 23px; min-width: 0; min-height: 0; overflow: hidden; }
.runner-stage { position: relative; min-width: 0; min-height: 0; overflow: hidden; border: 1px solid color-mix(in srgb, var(--accent) 20%, var(--line)); border-radius: 15px; outline: none; background: #b7e9ef; box-shadow: inset 0 1px 0 #ffffff35, 0 9px 28px #0002; }
.runner-stage:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.runner-canvas { display: block; width: 100%; height: 100%; }
.runner-evolution-panel { position: absolute; z-index: 1; top: 11px; right: 11px; display: flex; flex-direction: column; gap: 5px; width: min(248px, 43%); padding: 8px 10px; border: 1px solid color-mix(in srgb, var(--evolution-color) 55%, #ffffff); border-radius: 10px; color: #293844; background: #ffffffd9; box-shadow: 0 3px 14px #253c4a1c; backdrop-filter: blur(5px); pointer-events: none; }
.runner-evolution-panel.is-evolving { box-shadow: 0 0 20px color-mix(in srgb, var(--evolution-color) 68%, transparent); animation: runner-evolution-pulse .42s ease-in-out infinite alternate; }
.runner-evolution-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.runner-evolution-heading strong { color: color-mix(in srgb, var(--evolution-color) 72%, #253542); font-size: 10px; }
.runner-evolution-heading span { color: #8052ac; font-size: 9px; font-weight: 800; }
.runner-evolution-panel small { overflow: hidden; color: #687985; font-size: 8px; text-overflow: ellipsis; white-space: nowrap; }
.runner-evolution-track { height: 4px; overflow: hidden; border-radius: 99px; background: #dfe5e8; }
.runner-evolution-track i { display: block; height: 100%; border-radius: inherit; background: var(--evolution-color); transition: width .2s linear; }
@keyframes runner-evolution-pulse { to { transform: scale(1.025); } }
.runner-active-effects { position: absolute; z-index: 1; top: 11px; left: 11px; display: flex; flex-direction: column; gap: 5px; width: min(170px, 42%); pointer-events: none; }
.runner-effect-chip { display: flex; align-items: center; gap: 7px; min-width: 0; padding: 6px 8px; border: 1px solid #ffffffd9; border-radius: 9px; color: #293844; background: #ffffffd9; box-shadow: 0 3px 11px #253c4a20; backdrop-filter: blur(5px); }
.runner-effect-icon { display: grid; flex: 0 0 23px; place-items: center; width: 23px; height: 23px; border-radius: 7px; color: #fff; background: #d5a43f; font-size: 12px; }
.effect-slow .runner-effect-icon { background: #5daee8; }
.effect-magnet .runner-effect-icon { background: #e76566; }
.effect-dash .runner-effect-icon { background: #e5a743; }
.runner-effect-detail { display: flex; flex: 1; flex-direction: column; gap: 4px; min-width: 0; }
.runner-effect-detail > span { display: flex; align-items: center; justify-content: space-between; gap: 4px; }
.runner-effect-detail strong { font-size: 9px; }
.runner-effect-detail small { color: #687985; font-size: 8px; white-space: nowrap; }
.runner-effect-detail i { display: block; height: 3px; overflow: hidden; border-radius: 3px; background: #dfe5e8; }
.runner-effect-detail b { display: block; height: 100%; border-radius: inherit; background: #d5a43f; transition: width .12s linear; }
.effect-slow .runner-effect-detail b { background: #5daee8; }
.effect-magnet .runner-effect-detail b { background: #e76566; }
.effect-dash .runner-effect-detail b { background: #e5a743; }
.runner-overlay { position: absolute; inset: 0; display: grid; place-items: center; padding: 18px; background: rgba(25, 43, 49, .13); backdrop-filter: blur(2px); }
.runner-card { display: flex; flex-direction: column; align-items: center; min-width: min(320px, 100%); padding: 19px 24px 21px; border: 1px solid rgba(255,255,255,.84); border-radius: 16px; color: #243241; background: rgba(255,255,255,.91); box-shadow: 0 16px 44px rgba(38, 61, 73, .2); text-align: center; }
.runner-card-mark { display: grid; place-items: center; width: 39px; height: 39px; margin-bottom: 8px; border-radius: 13px; color: #fff; background: #5a9b79; font-size: 19px; font-weight: 800; transform: rotate(-5deg); }
.runner-card h1, .runner-card h2 { margin: 0; color: #253542; font-size: 21px; font-weight: 760; }
.runner-card p { margin: 8px 0 0; color: #426179; font-size: 13px; font-weight: 650; }
.runner-card p strong { color: #477f64; font-size: 17px; }
.runner-card small { margin-top: 6px; color: #728492; font-size: 10px; }
.runner-primary-button { min-width: 132px; min-height: 35px; margin-top: 16px; padding: 0 15px; border: 0; border-radius: 8px; color: #fff; background: linear-gradient(135deg, #559b78, #428366); box-shadow: 0 5px 13px #4283663d; font-size: 11px; font-weight: 700; cursor: pointer; }
.runner-primary-button:hover { background: linear-gradient(135deg, #4b8e6c, #387657); transform: translateY(-1px); }
.runner-primary-button:focus-visible { outline: 3px solid #2f6f59; outline-offset: 3px; }
.runner-footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 0 3px; color: var(--muted); font-size: 9px; white-space: nowrap; }
.runner-footer > span:first-child { display: inline-flex; align-items: center; gap: 6px; }
.runner-footer b { padding: 0 3px; color: var(--faint); }
.runner-status-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--faint); }
.runner-status-dot.is-running { background: var(--green); box-shadow: 0 0 7px color-mix(in srgb, var(--green) 70%, transparent); }
.runner-status-dot.is-paused { background: #e4b451; }
.runner-status-dot.is-game-over { background: var(--red); }
.runner-game:fullscreen { width: 100vw; height: 100vh; padding: 24px; background: var(--bg); }
.runner-game:fullscreen .runner-header { min-height: 48px; }
.runner-game:fullscreen .runner-stage { border-radius: 20px; }
.theme-light .runner-card { border-color: #ffffff; }

@media (max-width: 970px) {
  .runner-game { padding-inline: 10px; }
  .runner-header { gap: 9px; }
  .runner-title { min-width: 130px; }
  .runner-title strong { font-size: 14px; }
  .runner-stat { min-width: 59px; padding-inline: 7px; }
  .runner-stat-optional { display: none; }
  .runner-active-effects { width: min(150px, 48%); }
  .runner-evolution-panel { width: min(220px, 48%); }
}
@media (max-height: 610px) {
  .runner-game { gap: 6px; padding-block: 7px; }
  .runner-stat { padding-block: 3px; }
  .runner-stage-wrap { grid-template-rows: minmax(0, 1fr) 19px; }
}
@media (prefers-reduced-motion: reduce) {
  .runner-evolution-panel.is-evolving { animation: none; }
}
</style>
