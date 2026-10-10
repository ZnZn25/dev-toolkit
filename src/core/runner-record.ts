import type { RunnerEvolutionLevel } from './runner-evolution.ts'

export const RUNNER_BEST_SCORE_KEY = 'dev-toolkit.yang-yuanhang-run.high-score'
export const RUNNER_EVOLUTION_RECORD_KEY = 'dev-toolkit.yang-yuanhang-run.evolution'

export type RunnerEvolutionRecord = { lifetimeCoins: number; highestEvolutionLevel: RunnerEvolutionLevel }

type ScoreStorage = Pick<Storage, 'getItem' | 'setItem'>

export function loadRunnerBestScore(storage?: ScoreStorage): number {
  try {
    const score = Number((storage ?? globalThis.localStorage).getItem(RUNNER_BEST_SCORE_KEY))
    return Number.isSafeInteger(score) && score > 0 ? score : 0
  }
  catch { return 0 }
}

export function saveRunnerBestScore(score: number, storage?: ScoreStorage): void {
  if (!Number.isSafeInteger(score) || score < 0) return
  try { (storage ?? globalThis.localStorage).setItem(RUNNER_BEST_SCORE_KEY, String(score)) }
  catch { /* The current run stays playable if local storage is blocked or full. */ }
}

export function loadRunnerEvolutionRecord(storage?: ScoreStorage): RunnerEvolutionRecord {
  try {
    const value = JSON.parse((storage ?? globalThis.localStorage).getItem(RUNNER_EVOLUTION_RECORD_KEY) ?? 'null') as Partial<RunnerEvolutionRecord> | null
    const lifetimeCoins = Number(value?.lifetimeCoins)
    const level = Number(value?.highestEvolutionLevel)
    return {
      lifetimeCoins: Number.isSafeInteger(lifetimeCoins) && lifetimeCoins >= 0 ? lifetimeCoins : 0,
      highestEvolutionLevel: Number.isInteger(level) && level >= 1 && level <= 5 ? level as RunnerEvolutionLevel : 1,
    }
  }
  catch { return { lifetimeCoins: 0, highestEvolutionLevel: 1 } }
}

export function saveRunnerEvolutionRecord(record: RunnerEvolutionRecord, storage?: ScoreStorage): void {
  if (!Number.isSafeInteger(record.lifetimeCoins) || record.lifetimeCoins < 0 || !Number.isInteger(record.highestEvolutionLevel) || record.highestEvolutionLevel < 1 || record.highestEvolutionLevel > 5) return
  try { (storage ?? globalThis.localStorage).setItem(RUNNER_EVOLUTION_RECORD_KEY, JSON.stringify(record)) }
  catch { /* Keep the run playable if local storage is blocked or full. */ }
}
