import type { RunnerEvent } from './runner-game.ts'

export type RunnerAudioSettings = {
  bgmEnabled: boolean
  sfxEnabled: boolean
  bgmVolume: number
  sfxVolume: number
  muted: boolean
}
export type RunnerAudioState = 'ready' | 'running' | 'paused' | 'game-over' | 'inactive'
type MusicTrack = 'menu' | 'running'
type MusicVoice = 'lead' | 'arp' | 'bass'
type MusicNote = { midi: number; voice: MusicVoice; duration: number; volume: number; waveform: OscillatorType }
type MusicStep = { notes: MusicNote[]; drums: Array<'kick' | 'snare' | 'hat'> }

export const RUNNER_AUDIO_SETTINGS_KEY = 'yangyuanhang-run.audio.v1'
export const RUNNER_AUDIO_DEFAULTS: RunnerAudioSettings = { bgmEnabled: true, sfxEnabled: true, bgmVolume: 0.24, sfxVolume: 0.42, muted: false }
export const RUNNER_MUSIC_TEMPO = { menu: 110, running: 135, highSpeedThreshold: 410 } as const
const SIXTEENTHS_PER_BAR = 16
const LOOP_STEPS = 16 * SIXTEENTHS_PER_BAR
const CHORD_ROOTS = [0, 9, 5, 7, 0, 2, 5, 7, 9, 5, 0, 7, 2, 7, 0, 7]
const MOTIFS = [
  [0, 4, 7, 9, 7, 4, 2, 4],
  [7, 9, 12, 11, 9, 7, 4, 7],
  [4, 7, 9, 7, 4, 2, 0, 2],
  [9, 12, 14, 12, 9, 7, 4, 2],
]
const clamp = (value: number): number => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0))

export function sanitizeRunnerAudioSettings(value: unknown): RunnerAudioSettings {
  if (!value || typeof value !== 'object') return { ...RUNNER_AUDIO_DEFAULTS }
  const saved = value as Partial<RunnerAudioSettings>
  return {
    bgmEnabled: typeof saved.bgmEnabled === 'boolean' ? saved.bgmEnabled : RUNNER_AUDIO_DEFAULTS.bgmEnabled,
    sfxEnabled: typeof saved.sfxEnabled === 'boolean' ? saved.sfxEnabled : RUNNER_AUDIO_DEFAULTS.sfxEnabled,
    bgmVolume: clamp(typeof saved.bgmVolume === 'number' ? saved.bgmVolume : RUNNER_AUDIO_DEFAULTS.bgmVolume),
    sfxVolume: clamp(typeof saved.sfxVolume === 'number' ? saved.sfxVolume : RUNNER_AUDIO_DEFAULTS.sfxVolume),
    muted: typeof saved.muted === 'boolean' ? saved.muted : RUNNER_AUDIO_DEFAULTS.muted,
  }
}

export function loadRunnerAudioSettings(storage?: Pick<Storage, 'getItem'>): RunnerAudioSettings {
  try {
    const target = storage ?? (typeof localStorage === 'undefined' ? undefined : localStorage)
    const saved = target?.getItem(RUNNER_AUDIO_SETTINGS_KEY)
    return saved ? sanitizeRunnerAudioSettings(JSON.parse(saved)) : { ...RUNNER_AUDIO_DEFAULTS }
  }
  catch { return { ...RUNNER_AUDIO_DEFAULTS } }
}

export function saveRunnerAudioSettings(settings: RunnerAudioSettings, storage?: Pick<Storage, 'setItem'>): void {
  try {
    const target = storage ?? (typeof localStorage === 'undefined' ? undefined : localStorage)
    target?.setItem(RUNNER_AUDIO_SETTINGS_KEY, JSON.stringify(sanitizeRunnerAudioSettings(settings)))
  }
  catch { /* Audio preferences are optional when browser storage is unavailable. */ }
}

export function createMusicStep(track: MusicTrack, absoluteStep: number, highSpeed = false): MusicStep {
  const step = ((absoluteStep % LOOP_STEPS) + LOOP_STEPS) % LOOP_STEPS
  const bar = Math.floor(step / SIXTEENTHS_PER_BAR)
  const position = step % SIXTEENTHS_PER_BAR
  const beat = Math.floor(position / 4)
  const root = CHORD_ROOTS[bar]
  const motif = MOTIFS[(Math.floor(bar / 2) + Math.floor(bar / 4)) % MOTIFS.length]
  const notes: MusicNote[] = []
  const drums: MusicStep['drums'] = []

  if (track === 'menu') {
    if (position % 2 === 0 && (position < 12 || bar % 2 === 0)) {
      const degree = motif[(position / 2 + bar) % motif.length]
      notes.push({ midi: 72 + root + degree, voice: 'lead', duration: 0.22, volume: 0.095, waveform: 'triangle' })
    }
    if (position === 0 || position === 8) notes.push({ midi: 36 + root, voice: 'bass', duration: 0.34, volume: 0.11, waveform: 'triangle' })
    if (position === 4 || position === 12) notes.push({ midi: 60 + root + (bar % 2 ? 7 : 4), voice: 'arp', duration: 0.18, volume: 0.045, waveform: 'sine' })
    return { notes, drums }
  }

  if (position % 2 === 0) {
    const degree = motif[(position / 2 + bar) % motif.length]
    notes.push({ midi: 74 + root + degree, voice: 'lead', duration: 0.14, volume: 0.12, waveform: 'square' })
  }
  if (position === 0 || position === 8) {
    notes.push({ midi: 36 + root, voice: 'bass', duration: 0.22, volume: 0.14, waveform: 'triangle' })
    drums.push('kick')
  }
  if (position === 4 || position === 12) drums.push('snare')
  if (position % (highSpeed ? 1 : 2) === 0) drums.push('hat')
  if (position % (highSpeed ? 2 : 4) === 0) {
    const arpIndex = (beat + bar) % 3
    notes.push({ midi: 84 + root + [0, 4, 7][arpIndex], voice: 'arp', duration: 0.095, volume: highSpeed ? 0.09 : 0.055, waveform: 'square' })
  }
  return { notes, drums }
}

function midiFrequency(midi: number): number { return 440 * 2 ** ((midi - 69) / 12) }

export class RunnerAudioManager {
  readonly settings: RunnerAudioSettings
  private context?: AudioContext
  private master?: GainNode
  private musicBus?: GainNode
  private effectsBus?: GainNode
  private noiseBuffer?: AudioBuffer
  private readonly activeSources = new Set<AudioScheduledSourceNode>()
  private readonly musicSources = new Set<AudioScheduledSourceNode>()
  private schedulerTimer?: ReturnType<typeof setTimeout>
  private mode: 'stopped' | 'menu' | 'running' | 'paused' | 'game-over' = 'stopped'
  private scheduledTrack?: MusicTrack
  private highSpeed = false
  private nextStepTime = 0
  private stepIndex = 0
  private readonly lastSoundAt = new Map<string, number>()
  private disposed = false

  constructor(settings: RunnerAudioSettings = loadRunnerAudioSettings()) {
    Object.assign(settings, sanitizeRunnerAudioSettings(settings))
    this.settings = settings
  }

  async unlock(): Promise<void> {
    if (this.disposed) return
    const context = this.ensureContext()
    if (!context) return
    if (context.state === 'suspended') {
      try { await context.resume() }
      catch { return }
    }
    this.applyVolumes()
    this.syncMusic()
  }

  setState(state: RunnerAudioState, speed = 260): void {
    if (this.disposed) return
    if (state === 'inactive') {
      this.mode = 'stopped'
      this.stopMusic(0.08)
      this.stopAllSources(0.08)
      return
    }
    if (state === 'paused') {
      this.mode = 'paused'
      this.stopMusic(0.09)
      return
    }
    if (state === 'game-over') {
      if (this.mode === 'game-over') return
      this.mode = 'game-over'
      this.stopMusic(0.26)
      this.playGameOverCue()
      return
    }
    this.mode = state === 'ready' ? 'menu' : 'running'
    this.highSpeed = state === 'running' && speed >= RUNNER_MUSIC_TEMPO.highSpeedThreshold
    this.syncMusic()
  }

  setBgmEnabled(enabled: boolean): void {
    this.settings.bgmEnabled = enabled
    this.persist()
    this.syncMusic()
  }

  setSfxEnabled(enabled: boolean): void {
    this.settings.sfxEnabled = enabled
    this.persist()
  }

  setMuted(muted: boolean): void {
    this.settings.muted = muted
    this.persist()
    this.applyVolumes()
    if (muted) this.stopMusic(0.08)
    else this.syncMusic()
  }

  setVolume(channel: 'bgm' | 'sfx', value: number, persist = true): void {
    if (channel === 'bgm') this.settings.bgmVolume = clamp(value)
    else this.settings.sfxVolume = clamp(value)
    if (persist) this.persist()
    this.applyVolumes()
  }

  play(event: RunnerEvent): void {
    if (!this.settings.sfxEnabled || this.settings.muted || this.disposed) return
    const context = this.ensureContext()
    if (!context || context.state !== 'running' || !this.effectsBus) return
    const key = event === 'coin' ? 'coin' : event.startsWith('powerup-') ? 'powerup' : event
    const cooldown = event === 'coin' ? 0.065 : event.startsWith('powerup-') ? 0.12 : 0.04
    const last = this.lastSoundAt.get(key) ?? -Infinity
    if (context.currentTime - last < cooldown) return
    this.lastSoundAt.set(key, context.currentTime)
    if (event === 'jump') this.playSfxNotes([[64, 0, 0.11, 'square'], [72, 0.065, 0.13, 'triangle']])
    else if (event === 'double-jump') this.playSfxNotes([[78, 0, 0.09, 'square'], [84, 0.055, 0.1, 'square'], [88, 0.11, 0.13, 'triangle']])
    else if (event === 'land') this.playSfxNotes([[45, 0, 0.075, 'triangle']])
    else if (event === 'passed' || event === 'coin') this.playSfxNotes(event === 'coin' ? [[88, 0, 0.055, 'square'], [96, 0.045, 0.09, 'triangle']] : [[79, 0, 0.11, 'triangle']])
    else if (event === 'collision') this.playSfxNotes([[39, 0, 0.16, 'square'], [32, 0.08, 0.2, 'triangle']])
    else if (event === 'shield-break') this.playSfxNotes([[72, 0, 0.06, 'square'], [60, 0.045, 0.13, 'triangle'], [48, 0.1, 0.14, 'sine']])
    else if (event === 'dash-block') this.playSfxNotes([[81, 0, 0.065, 'triangle']])
    else if (event === 'powerup-shield') this.playSfxNotes([[67, 0, 0.11, 'triangle'], [74, 0.07, 0.15, 'sine']])
    else if (event === 'powerup-slow') this.playSfxNotes([[84, 0, 0.12, 'sine'], [79, 0.075, 0.18, 'triangle']])
    else if (event === 'powerup-magnet') this.playSfxNotes([[69, 0, 0.08, 'square'], [76, 0.07, 0.11, 'square'], [81, 0.14, 0.12, 'sine']])
    else if (event === 'powerup-dash') this.playSfxNotes([[72, 0, 0.07, 'square'], [79, 0.055, 0.08, 'square'], [86, 0.11, 0.12, 'triangle']])
    else if (event === 'powerup-heart') this.playSfxNotes([[60, 0, 0.12, 'sine'], [67, 0.075, 0.12, 'sine'], [72, 0.15, 0.17, 'triangle']])
    else if (event === 'new-record') this.playSfxNotes([[72, 0, 0.13, 'triangle'], [76, 0.09, 0.13, 'triangle'], [79, 0.18, 0.15, 'triangle'], [84, 0.28, 0.24, 'sine']])
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.stopMusic(0)
    this.stopAllSources(0)
    if (this.context && this.context.state !== 'closed') void this.context.close()
    this.context = undefined
  }

  private ensureContext(): AudioContext | undefined {
    if (this.context || this.disposed || typeof AudioContext === 'undefined') return this.context
    try {
      const context = new AudioContext({ latencyHint: 'interactive' })
      const master = context.createGain()
      const music = context.createGain()
      const effects = context.createGain()
      const compressor = context.createDynamicsCompressor()
      compressor.threshold.value = -15
      compressor.knee.value = 4
      compressor.ratio.value = 14
      compressor.attack.value = 0.003
      compressor.release.value = 0.12
      music.connect(master)
      effects.connect(master)
      master.connect(compressor)
      compressor.connect(context.destination)
      this.context = context
      this.master = master
      this.musicBus = music
      this.effectsBus = effects
      this.noiseBuffer = this.makeNoiseBuffer(context)
      this.applyVolumes()
      return context
    }
    catch { return undefined }
  }

  private makeNoiseBuffer(context: AudioContext): AudioBuffer {
    const buffer = context.createBuffer(1, Math.floor(context.sampleRate * 0.11), context.sampleRate)
    const samples = buffer.getChannelData(0)
    for (let i = 0; i < samples.length; i++) samples[i] = (Math.random() * 2 - 1) * (1 - i / samples.length)
    return buffer
  }

  private applyVolumes(): void {
    const context = this.context
    if (!context) return
    const now = context.currentTime
    const set = (gain: GainNode | undefined, target: number): void => {
      if (!gain) return
      gain.gain.cancelScheduledValues(now)
      gain.gain.setTargetAtTime(target, now, 0.035)
    }
    set(this.master, this.settings.muted ? 0 : 0.86)
    set(this.musicBus, this.settings.bgmEnabled && !this.settings.muted ? this.settings.bgmVolume : 0)
    set(this.effectsBus, this.settings.sfxEnabled && !this.settings.muted ? this.settings.sfxVolume : 0)
  }

  private persist(): void { saveRunnerAudioSettings(this.settings) }

  private syncMusic(): void {
    if (!this.context || !this.musicBus || this.context.state !== 'running' || this.mode === 'paused' || this.mode === 'stopped' || this.mode === 'game-over') return
    if (!this.settings.bgmEnabled || this.settings.muted) {
      this.stopMusic(0.08)
      return
    }
    const desired: MusicTrack = this.mode === 'menu' ? 'menu' : 'running'
    if (this.schedulerTimer !== undefined && this.scheduledTrack === desired) return
    this.startMusic(desired)
  }

  private startMusic(track: MusicTrack): void {
    const context = this.context
    const bus = this.musicBus
    if (!context || !bus) return
    this.cancelScheduler()
    this.stopMusicSources(0.035)
    this.stepIndex = 0
    this.scheduledTrack = track
    this.nextStepTime = context.currentTime + 0.15
    const now = context.currentTime
    bus.gain.cancelScheduledValues(now)
    bus.gain.setValueAtTime(bus.gain.value, now)
    bus.gain.linearRampToValueAtTime(0, now + 0.055)
    bus.gain.setValueAtTime(0, now + 0.055)
    bus.gain.linearRampToValueAtTime(this.settings.bgmVolume, now + 0.2)
    this.mode = track
    this.scheduleMusicStep(track)
  }

  private scheduleMusicStep(track: MusicTrack): void {
    const context = this.context
    if (!context || this.mode !== track || context.state !== 'running' || !this.settings.bgmEnabled || this.settings.muted) return
    const bpm = track === 'menu' ? RUNNER_MUSIC_TEMPO.menu : RUNNER_MUSIC_TEMPO.running
    const stepDuration = 60 / bpm / 4
    const horizon = context.currentTime + 0.15
    while (this.nextStepTime < horizon) {
      const plan = createMusicStep(track, this.stepIndex, this.highSpeed)
      for (const note of plan.notes) {
        const duration = Math.min(stepDuration * note.duration * 4, 0.44)
        this.synthNote(midiFrequency(note.midi), this.nextStepTime, duration, note.waveform, note.volume, 'music')
      }
      if (track === 'running') for (const drum of plan.drums) this.synthDrum(drum, this.nextStepTime)
      this.stepIndex = (this.stepIndex + 1) % LOOP_STEPS
      this.nextStepTime += stepDuration
    }
    this.schedulerTimer = setTimeout(() => {
      this.schedulerTimer = undefined
      this.scheduleMusicStep(track)
    }, 24)
  }

  private synthNote(frequency: number, at: number, duration: number, waveform: OscillatorType, volume: number, channel: 'music' | 'effects'): void {
    const context = this.context
    const destination = channel === 'music' ? this.musicBus : this.effectsBus
    if (!context || !destination) return
    const oscillator = context.createOscillator()
    const envelope = context.createGain()
    oscillator.type = waveform
    oscillator.frequency.setValueAtTime(frequency, at)
    envelope.gain.setValueAtTime(0.0001, at)
    envelope.gain.linearRampToValueAtTime(volume, at + Math.min(0.008, duration * 0.2))
    envelope.gain.setValueAtTime(Math.max(0.0001, volume * 0.68), at + duration * 0.55)
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + duration)
    oscillator.connect(envelope)
    envelope.connect(destination)
    this.trackSource(oscillator, channel === 'music', [envelope])
    oscillator.start(at)
    oscillator.stop(at + duration + 0.015)
  }

  private synthDrum(kind: 'kick' | 'snare' | 'hat', at: number): void {
    const context = this.context
    const bus = this.musicBus
    if (!context || !bus) return
    if (kind === 'kick') {
      const oscillator = context.createOscillator()
      const envelope = context.createGain()
      oscillator.type = 'sine'
      oscillator.frequency.setValueAtTime(145, at)
      oscillator.frequency.exponentialRampToValueAtTime(48, at + 0.11)
      envelope.gain.setValueAtTime(0.13, at)
      envelope.gain.exponentialRampToValueAtTime(0.0001, at + 0.13)
      oscillator.connect(envelope); envelope.connect(bus)
      this.trackSource(oscillator, true, [envelope])
      oscillator.start(at); oscillator.stop(at + 0.14)
      return
    }
    if (kind === 'snare') {
      this.synthNote(midiFrequency(48), at, 0.075, 'triangle', 0.045, 'music')
      this.playNoise(at, 0.065, 0.032, bus)
      return
    }
    this.playNoise(at, this.highSpeed ? 0.035 : 0.028, this.highSpeed ? 0.018 : 0.012, bus)
  }

  private playNoise(at: number, duration: number, volume: number, destination: AudioNode): void {
    const context = this.context
    if (!context || !this.noiseBuffer) return
    const source = context.createBufferSource()
    const filter = context.createBiquadFilter()
    const envelope = context.createGain()
    source.buffer = this.noiseBuffer
    filter.type = 'highpass'
    filter.frequency.value = 4200
    envelope.gain.setValueAtTime(volume, at)
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + duration)
    source.connect(filter); filter.connect(envelope); envelope.connect(destination)
    this.trackSource(source, true, [filter, envelope])
    source.start(at); source.stop(at + duration + 0.01)
  }

  private playSfxNotes(notes: Array<[midi: number, delay: number, duration: number, waveform: OscillatorType]>): void {
    const context = this.context
    if (!context) return
    for (const [midi, delay, duration, waveform] of notes) this.synthNote(midiFrequency(midi), context.currentTime + delay + 0.006, duration, waveform, 0.14, 'effects')
  }

  private playGameOverCue(): void {
    const context = this.context
    const bus = this.musicBus
    if (!context || !bus || !this.settings.bgmEnabled || this.settings.muted) return
    const now = context.currentTime
    const fadeEnd = now + 0.25
    const cueStart = fadeEnd + 0.035
    bus.gain.cancelScheduledValues(now)
    bus.gain.setValueAtTime(bus.gain.value, now)
    bus.gain.linearRampToValueAtTime(0, fadeEnd)
    bus.gain.setValueAtTime(0, cueStart)
    bus.gain.linearRampToValueAtTime(this.settings.bgmVolume * 0.72, cueStart + 0.045)
    const notes: Array<[number, number, number]> = [[79, 0, 0.18], [74, 0.22, 0.2], [71, 0.47, 0.24], [67, 0.76, 0.34]]
    for (const [midi, delay, duration] of notes) this.synthNote(midiFrequency(midi), cueStart + delay, duration, 'square', 0.1, 'music')
    bus.gain.setValueAtTime(this.settings.bgmVolume * 0.72, cueStart + 0.8)
    bus.gain.linearRampToValueAtTime(0, cueStart + 1.18)
  }

  private trackSource(source: AudioScheduledSourceNode, music: boolean, auxiliaries: AudioNode[] = []): void {
    this.activeSources.add(source)
    if (music) this.musicSources.add(source)
    source.onended = () => {
      this.activeSources.delete(source)
      this.musicSources.delete(source)
      try { source.disconnect() } catch { /* Already disconnected by the browser. */ }
      for (const node of auxiliaries) {
        try { node.disconnect() } catch { /* Already disconnected by the browser. */ }
      }
    }
  }

  private cancelScheduler(): void {
    if (this.schedulerTimer !== undefined) clearTimeout(this.schedulerTimer)
    this.schedulerTimer = undefined
  }

  private stopMusic(duration: number): void {
    this.cancelScheduler()
    this.scheduledTrack = undefined
    this.stopMusicSources(duration)
    const context = this.context
    const bus = this.musicBus
    if (!context || !bus) return
    const now = context.currentTime
    bus.gain.cancelScheduledValues(now)
    bus.gain.setValueAtTime(bus.gain.value, now)
    bus.gain.linearRampToValueAtTime(0, now + duration)
  }

  private stopMusicSources(fadeSeconds: number): void {
    for (const source of this.musicSources) {
      try { source.stop((this.context?.currentTime ?? 0) + fadeSeconds + 0.01) } catch { /* One-shot source has already ended. */ }
    }
  }

  private stopAllSources(fadeSeconds: number): void {
    for (const source of this.activeSources) {
      try { source.stop((this.context?.currentTime ?? 0) + fadeSeconds + 0.01) } catch { /* One-shot source has already ended. */ }
    }
  }
}
