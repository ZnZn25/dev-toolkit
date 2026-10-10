export const RUNNER_BEST_SCORE_KEY = 'dev-toolkit.yang-yuanhang-run.high-score'

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
