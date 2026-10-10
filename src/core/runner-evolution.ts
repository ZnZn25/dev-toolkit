export type RunnerEvolutionLevel = 1 | 2 | 3 | 4 | 5

export type RunnerEvolutionConfig = {
  level: RunnerEvolutionLevel
  requiredCoins: number
  title: string
  appearance: 'classic' | 'speed' | 'thunder' | 'gold' | 'cosmic'
  outfit: string
  trim: string
  glow: string
  trail: string
  doubleJumpEffect: 'dust' | 'speed' | 'lightning' | 'spark' | 'cosmic'
  evolutionSound: 'swift' | 'thunder' | 'gold' | 'cosmic'
}

export const RUNNER_EVOLUTIONS: readonly RunnerEvolutionConfig[] = [
  { level: 1, requiredCoins: 0, title: '普通杨远航', appearance: 'classic', outfit: '#566b40', trim: '#879065', glow: 'transparent', trail: 'transparent', doubleJumpEffect: 'dust', evolutionSound: 'swift' },
  { level: 2, requiredCoins: 50, title: '疾风杨远航', appearance: 'speed', outfit: '#c64d43', trim: '#f09a72', glow: 'transparent', trail: '#f0755b', doubleJumpEffect: 'speed', evolutionSound: 'swift' },
  { level: 3, requiredCoins: 150, title: '雷霆杨远航', appearance: 'thunder', outfit: '#337ebc', trim: '#79d8ff', glow: 'transparent', trail: '#72d9ff', doubleJumpEffect: 'lightning', evolutionSound: 'thunder' },
  { level: 4, requiredCoins: 300, title: '黄金杨远航', appearance: 'gold', outfit: '#d59b32', trim: '#ffe29a', glow: '#ffd76c', trail: '#ffd76c', doubleJumpEffect: 'spark', evolutionSound: 'gold' },
  { level: 5, requiredCoins: 500, title: '宇宙杨远航', appearance: 'cosmic', outfit: '#6849a5', trim: '#d2b7ff', glow: 'transparent', trail: '#c39cff', doubleJumpEffect: 'cosmic', evolutionSound: 'cosmic' },
] as const

export function evolutionLevelForCoins(coins: number): RunnerEvolutionLevel {
  const safeCoins = Number.isFinite(coins) ? Math.max(0, Math.floor(coins)) : 0
  for (let index = RUNNER_EVOLUTIONS.length - 1; index >= 0; index--) {
    const evolution = RUNNER_EVOLUTIONS[index]
    if (safeCoins >= evolution.requiredCoins) return evolution.level
  }
  return 1
}

export function evolutionForLevel(level: number): RunnerEvolutionConfig {
  return RUNNER_EVOLUTIONS[Math.max(0, Math.min(RUNNER_EVOLUTIONS.length - 1, Math.floor(level) - 1))]
}
