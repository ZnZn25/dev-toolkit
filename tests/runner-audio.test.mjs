import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createMusicStep,
  loadRunnerAudioSettings,
  RUNNER_AUDIO_DEFAULTS,
  RUNNER_AUDIO_SETTINGS_KEY,
  RUNNER_MUSIC_TEMPO,
  saveRunnerAudioSettings,
  sanitizeRunnerAudioSettings,
} from '../src/core/runner-audio.ts'

test('audio preferences validate, clamp, persist, and tolerate unavailable storage', () => {
  assert.deepEqual(sanitizeRunnerAudioSettings(null), RUNNER_AUDIO_DEFAULTS)
  assert.deepEqual(sanitizeRunnerAudioSettings({ bgmEnabled: false, sfxEnabled: true, bgmVolume: 4, sfxVolume: -1, muted: true }), {
    bgmEnabled: false, sfxEnabled: true, bgmVolume: 1, sfxVolume: 0, muted: true,
  })
  const values = new Map()
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }
  const settings = { ...RUNNER_AUDIO_DEFAULTS, bgmVolume: 0.37 }
  saveRunnerAudioSettings(settings, storage)
  assert.equal(values.has(RUNNER_AUDIO_SETTINGS_KEY), true)
  assert.equal(loadRunnerAudioSettings(storage).bgmVolume, 0.37)
  assert.equal(loadRunnerAudioSettings({ getItem() { throw new Error('blocked') } }).bgmEnabled, true)
})

test('menu and running tracks use 110 and 135 BPM with a varied sixteen-bar loop', () => {
  assert.equal(RUNNER_MUSIC_TEMPO.menu, 110)
  assert.equal(RUNNER_MUSIC_TEMPO.running, 135)
  const menu = Array.from({ length: 256 }, (_, step) => createMusicStep('menu', step))
  const run = Array.from({ length: 256 }, (_, step) => createMusicStep('running', step))
  assert.deepEqual(createMusicStep('menu', 256), menu[0])
  assert.deepEqual(createMusicStep('running', 256), run[0])
  assert.equal(menu.every(step => step.drums.length === 0), true)
  assert.equal(run.some(step => step.drums.includes('kick')), true)
  assert.equal(new Set(menu.flatMap(step => step.notes.map(note => note.midi))).size > 8, true)
  assert.equal(new Set(run.flatMap(step => step.notes.map(note => note.midi))).size > 12, true)
})

test('high-speed music adds denser hats and arpeggios without changing the track step', () => {
  const standard = Array.from({ length: 32 }, (_, step) => createMusicStep('running', step))
  const fast = Array.from({ length: 32 }, (_, step) => createMusicStep('running', step, true))
  const standardHits = standard.reduce((count, step) => count + step.drums.length + step.notes.filter(note => note.voice === 'arp').length, 0)
  const fastHits = fast.reduce((count, step) => count + step.drums.length + step.notes.filter(note => note.voice === 'arp').length, 0)
  assert.ok(fastHits > standardHits)
  assert.equal(createMusicStep('running', 32, true).notes.some(note => note.voice === 'arp'), true)
})
