export type PowerUpType = 'shield' | 'slow' | 'magnet' | 'dash' | 'heart' | 'chest' | 'flight' | 'mushroom'
export type PowerUpSound = PowerUpType
export type PowerUpEffect = 'single-hit-shield' | 'world-slow' | 'coin-magnet' | 'dash-immunity' | 'heal' | 'treasure' | 'flight' | 'mushroom'
export type ItemRect = { left: number; right: number; top: number; bottom: number }
export type ItemObstacle = { x: number; width: number; height: number }
export type RunnerCoin = { id: number; x: number; y: number; radius: number; phase: number; hitbox: ItemRect }
export type RunnerPowerUp = {
  id: number
  type: PowerUpType
  x: number
  y: number
  width: number
  height: number
  hitbox: ItemRect
  duration: number
  effect: PowerUpEffect
  pickupSound: PowerUpSound
  status: 'available' | 'collected'
}
export type ActivePowerUps = { shield: boolean; slowRemaining: number; magnetRemaining: number; dashRemaining: number; flightRemaining: number; mushroomRemaining: number }

export const ACTIVE_POWER_UPS: ActivePowerUps = { shield: false, slowRemaining: 0, magnetRemaining: 0, dashRemaining: 0, flightRemaining: 0, mushroomRemaining: 0 }

export const POWER_UP_INFO: Record<PowerUpType, { label: string; duration: number; effect: PowerUpEffect; pickupSound: PowerUpSound }> = {
  shield: { label: '护盾', duration: 0, effect: 'single-hit-shield', pickupSound: 'shield' },
  slow: { label: '减速', duration: 5, effect: 'world-slow', pickupSound: 'slow' },
  magnet: { label: '磁铁', duration: 8, effect: 'coin-magnet', pickupSound: 'magnet' },
  dash: { label: '冲刺', duration: 4, effect: 'dash-immunity', pickupSound: 'dash' },
  heart: { label: '生命恢复', duration: 0, effect: 'heal', pickupSound: 'heart' },
  chest: { label: '宝箱', duration: 0, effect: 'treasure', pickupSound: 'chest' },
  flight: { label: '飞行', duration: 8, effect: 'flight', pickupSound: 'flight' },
  mushroom: { label: '特殊蘑菇', duration: 6, effect: 'mushroom', pickupSound: 'mushroom' },
}

function intersects(a: ItemRect, b: ItemRect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
}

function circleRect(x: number, y: number, radius: number): ItemRect {
  return { left: x - radius, right: x + radius, top: y - radius, bottom: y + radius }
}

function obstacleClearance(obstacle: ItemObstacle, groundY: number): ItemRect {
  return { left: obstacle.x - 20, right: obstacle.x + obstacle.width + 20, top: groundY - obstacle.height - 24, bottom: groundY + 8 }
}

function safePickupPosition(x: number, y: number, width: number, height: number, obstacles: ItemObstacle[], groundY: number): boolean {
  const box = { left: x - width / 2, right: x + width / 2, top: y - height / 2, bottom: y + height / 2 }
  return obstacles.every(obstacle => !intersects(box, obstacleClearance(obstacle, groundY)))
}

export function pickPowerUp(random: () => number, health: number, maxHealth: number): PowerUpType {
  const weights: Array<[PowerUpType, number]> = [
    ['shield', 25], ['slow', 20], ['magnet', 20], ['dash', 15], ['heart', health < maxHealth ? (health === 1 ? 35 : 26) : 0],
  ]
  const total = weights.reduce((sum, [, weight]) => sum + weight, 0)
  let roll = Math.min(1 - Number.EPSILON, Math.max(0, random())) * total
  for (const [type, weight] of weights) {
    roll -= weight
    if (roll < 0) return type
  }
  return 'shield'
}

export const CoinManager = {
  spawn(coins: RunnerCoin[], firstId: number, viewWidth: number, groundY: number, obstacles: ItemObstacle[], random: () => number): number {
    const count = random() < 0.34 ? 1 : 3 + Math.floor(random() * 3)
    const lane = random()
    const baseY = groundY - (lane < 0.24 ? 34 : lane < 0.72 ? 88 : 142)
    let created = 0
    for (let i = 0; i < count; i++) {
      const x = viewWidth + 190 + i * 34
      const y = baseY - (count > 1 ? Math.abs(i - (count - 1) / 2) * 5 : 0)
      const radius = 13
      if (!safePickupPosition(x, y, radius * 2, radius * 2, obstacles, groundY)) continue
      coins.push({ id: firstId + created, x, y, radius, phase: (firstId + created) * 0.77, hitbox: circleRect(x, y, radius) })
      created++
    }
    return created
  },

  step(coins: RunnerCoin[], deltaSeconds: number, worldSpeed: number, playerX: number, playerY: number, magnetActive: boolean): void {
    const attraction = 1 - Math.exp(-7 * deltaSeconds)
    for (const coin of coins) {
      coin.x -= worldSpeed * deltaSeconds
      if (magnetActive && Math.hypot(coin.x - playerX, coin.y - playerY) < 270) {
        coin.x += (playerX - coin.x) * attraction
        coin.y += (playerY - coin.y) * attraction
      }
      coin.hitbox = circleRect(coin.x, coin.y, coin.radius)
    }
    for (let i = coins.length - 1; i >= 0; i--) if (coins[i].x + coins[i].radius < -24) coins.splice(i, 1)
  },

  collect(coins: RunnerCoin[], player: ItemRect): number {
    let collected = 0
    for (let i = coins.length - 1; i >= 0; i--) {
      if (intersects(player, coins[i].hitbox)) {
        coins.splice(i, 1)
        collected++
      }
    }
    return collected
  },

  clear(coins: RunnerCoin[]): void { coins.length = 0 },
}

export const PowerUpManager = {
  spawn(items: RunnerPowerUp[], firstId: number, type: PowerUpType, viewWidth: number, groundY: number, obstacles: ItemObstacle[], random: () => number): RunnerPowerUp | undefined {
    const info = POWER_UP_INFO[type]
    const width = 34
    const height = 34
    const x = viewWidth + 210
    for (let attempt = 0; attempt < 5; attempt++) {
      const y = groundY - 58 - random() * 58
      const candidateX = x + attempt * 54
      if (!safePickupPosition(candidateX, y, width, height, obstacles, groundY)) continue
      const hitbox = { left: candidateX - width / 2, right: candidateX + width / 2, top: y - height / 2, bottom: y + height / 2 }
      const item: RunnerPowerUp = { id: firstId, type, x: candidateX, y, width, height, hitbox, duration: info.duration, effect: info.effect, pickupSound: info.pickupSound, status: 'available' }
      items.push(item)
      return item
    }
    return undefined
  },

  step(items: RunnerPowerUp[], effects: ActivePowerUps, deltaSeconds: number, worldSpeed: number): void {
    effects.slowRemaining = Math.max(0, effects.slowRemaining - deltaSeconds)
    effects.magnetRemaining = Math.max(0, effects.magnetRemaining - deltaSeconds)
    effects.dashRemaining = Math.max(0, effects.dashRemaining - deltaSeconds)
    effects.flightRemaining = Math.max(0, effects.flightRemaining - deltaSeconds)
    effects.mushroomRemaining = Math.max(0, effects.mushroomRemaining - deltaSeconds)
    for (const item of items) {
      item.x -= worldSpeed * deltaSeconds
      item.hitbox = { left: item.x - item.width / 2, right: item.x + item.width / 2, top: item.y - item.height / 2, bottom: item.y + item.height / 2 }
    }
    for (let i = items.length - 1; i >= 0; i--) if (items[i].x + items[i].width / 2 < -24) items.splice(i, 1)
  },

  collect(items: RunnerPowerUp[], player: ItemRect, effects: ActivePowerUps, health: number, maxHealth: number): { health: number; scoreBonus: number; types: PowerUpType[] } {
    const types: PowerUpType[] = []
    let scoreBonus = 0
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i]
      if (item.status !== 'available' || !intersects(player, item.hitbox)) continue
      item.status = 'collected'
      types.push(item.type)
      if (item.type === 'shield') effects.shield = true
      else if (item.type === 'slow') effects.slowRemaining = item.duration
      else if (item.type === 'magnet') effects.magnetRemaining = item.duration
      else if (item.type === 'dash') effects.dashRemaining = item.duration
      else if (item.type === 'flight') effects.flightRemaining = item.duration
      else if (item.type === 'mushroom') effects.mushroomRemaining = item.duration
      else if (item.type === 'heart') {
        if (health < maxHealth) health++
        else scoreBonus += 30
      }
      items.splice(i, 1)
    }
    return { health, scoreBonus, types }
  },

  absorbShield(effects: ActivePowerUps): boolean {
    if (!effects.shield) return false
    effects.shield = false
    return true
  },

  clear(items: RunnerPowerUp[], effects: ActivePowerUps): void {
    items.length = 0
    effects.shield = false
    effects.slowRemaining = 0
    effects.magnetRemaining = 0
    effects.dashRemaining = 0
    effects.flightRemaining = 0
    effects.mushroomRemaining = 0
  },
}
