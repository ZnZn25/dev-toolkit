import { CoinManager, PowerUpManager, pickPowerUp, type ActivePowerUps, type PowerUpType, type RunnerCoin, type RunnerPowerUp } from './runner-items.ts'
import { evolutionLevelForCoins, type RunnerEvolutionLevel } from './runner-evolution.ts'

export type RunnerStatus = 'ready' | 'running' | 'paused' | 'game-over'
export type ObstacleKind = 'small-box' | 'large-box' | 'roadblock' | 'tire-stack' | 'overhead-bar'
export type RunnerEvent = 'jump' | 'double-jump' | 'land' | 'passed' | 'collision' | 'new-record' | 'coin' | 'shield-break' | 'dash-block' | 'mushroom-smash' | 'boss-start' | 'boss-win' | 'achievement-backwards' | 'achievement-rich' | 'title-aerial' | 'achievement-tough' | 'run-minute' | `powerup-${PowerUpType}` | `evolution-${2 | 3 | 4 | 5}`
export type RunnerParticleKind = 'takeoff' | 'double-jump' | 'landing' | 'hit' | 'shield-break' | 'collect' | 'dash' | 'heart' | 'evolution'
export type RunnerParticle = { kind: RunnerParticleKind; x: number; y: number; vx: number; vy: number; life: number; maxLife: number; size: number }

export const RUNNER = {
  width: 960,
  height: 420,
  groundY: 334,
  playerX: 132,
  playerWidth: 84,
  playerHeight: 116,
  jumpVelocity: 710,
  gravity: 1600,
  glideGravityScale: 0.24,
  glideFallSpeed: 170,
  slideHeight: 58,
  initialSpeed: 260,
  maximumSpeed: 500,
  minimumGapSeconds: 2.05,
} as const

export type RunnerObstacle = {
  id: number
  kind: ObstacleKind
  x: number
  width: number
  height: number
  top?: number
  passed: boolean
  collisionHandled?: boolean
}

export type RunnerState = {
  status: RunnerStatus
  viewWidth: number
  score: number
  bestScore: number
  health: number
  maxHealth: number
  invulnerabilityRemaining: number
  hitFlashRemaining: number
  elapsed: number
  distance: number
  speed: number
  worldSpeed: number
  distanceScore: number
  bonusScore: number
  coinsCollected: number
  lifetimeCoins: number
  evolutionLevel: RunnerEvolutionLevel
  highestEvolutionLevel: RunnerEvolutionLevel
  evolutionRemaining: number
  cosmicRemaining: number
  coins: RunnerCoin[]
  powerUps: RunnerPowerUp[]
  activePowerUps: ActivePowerUps
  jumpHeight: number
  verticalSpeed: number
  onGround: boolean
  jumpsUsed: number
  glideHeld: boolean
  gliding: boolean
  flightHeld: boolean
  slideHeld: boolean
  sliding: boolean
  doubleJumpRemaining: number
  doubleJumpStreak: number
  doubleJumpedThisAir: boolean
  obstacles: RunnerObstacle[]
  particles: RunnerParticle[]
  spawnDistance: number
  itemSpawnDistance: number
  impactRemaining: number
  newRecordThisRun: boolean
  bossRemaining: number
  bossAttackRemaining: number
  bossX: number
  bossesQueued: number
  bossesTriggered: number
  collisionStreak: number
  coinWindowRemaining: number
  coinWindowCollected: number
  lowHealthElapsed: number
  lowHealthEarned: boolean
  runMinuteEarned: boolean
  backwardsEarned: boolean
  aerialTitleEarned: boolean
}

export type GameRect = { left: number; right: number; top: number; bottom: number }

const OBSTACLE_SIZE: Record<ObstacleKind, { width: number; height: number; top?: number }> = {
  'small-box': { width: 46, height: 38 },
  'large-box': { width: 58, height: 63 },
  roadblock: { width: 82, height: 48 },
  'tire-stack': { width: 72, height: 54 },
  'overhead-bar': { width: 112, height: 30, top: RUNNER.groundY - 80 },
}

export function speedForScore(score: number): number {
  return Math.min(RUNNER.maximumSpeed, RUNNER.initialSpeed + Math.max(0, score) * 0.32)
}

export function obstacleGap(speed: number, difficulty: number, random: number): number {
  const minimum = speed * RUNNER.minimumGapSeconds
  const maximum = speed * (2.55 - Math.min(1, Math.max(0, difficulty)) * 0.4)
  return minimum + Math.min(1, Math.max(0, random)) * (maximum - minimum)
}

export function intersects(a: GameRect, b: GameRect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
}

export function playerHitbox(jumpHeight: number, sliding = false, mushroomActive = false): GameRect {
  const scale = mushroomActive ? 2 : 1
  const bodyHeight = (sliding ? RUNNER.slideHeight : RUNNER.playerHeight) * scale
  const halfWidth = (RUNNER.playerWidth - 34) * scale / 2
  return {
    left: RUNNER.playerX + 48 - halfWidth,
    right: RUNNER.playerX + 48 + halfWidth,
    top: RUNNER.groundY - bodyHeight - jumpHeight + (sliding ? 8 : 13 * scale),
    bottom: RUNNER.groundY - jumpHeight - 7 * scale,
  }
}

export function obstacleHitbox(obstacle: RunnerObstacle): GameRect {
  const top = obstacle.top ?? RUNNER.groundY - obstacle.height
  return {
    left: obstacle.x + 7,
    right: obstacle.x + obstacle.width - 6,
    top: top + 4,
    bottom: obstacle.top === undefined ? RUNNER.groundY : top + obstacle.height - 4,
  }
}

function initialState(bestScore: number, lifetimeCoins = 0, highestEvolutionLevel: RunnerEvolutionLevel = 1): RunnerState {
  return {
    status: 'ready',
    viewWidth: RUNNER.width,
    score: 0,
    bestScore,
    health: 3,
    maxHealth: 3,
    invulnerabilityRemaining: 0,
    hitFlashRemaining: 0,
    elapsed: 0,
    distance: 0,
    speed: RUNNER.initialSpeed,
    worldSpeed: RUNNER.initialSpeed,
    distanceScore: 0,
    bonusScore: 0,
    coinsCollected: 0,
    lifetimeCoins,
    evolutionLevel: 1,
    highestEvolutionLevel,
    evolutionRemaining: 0,
    cosmicRemaining: 0,
    coins: [],
    powerUps: [],
    activePowerUps: { shield: false, slowRemaining: 0, magnetRemaining: 0, dashRemaining: 0, flightRemaining: 0, mushroomRemaining: 0 },
    jumpHeight: 0,
    verticalSpeed: 0,
    onGround: true,
    jumpsUsed: 0,
    glideHeld: false,
    gliding: false,
    flightHeld: false,
    slideHeld: false,
    sliding: false,
    doubleJumpRemaining: 0,
    doubleJumpStreak: 0,
    doubleJumpedThisAir: false,
    obstacles: [],
    particles: [],
    spawnDistance: RUNNER.initialSpeed * 1.8,
    itemSpawnDistance: RUNNER.initialSpeed * 1.3,
    impactRemaining: 0,
    newRecordThisRun: false,
    bossRemaining: 0,
    bossAttackRemaining: 0,
    bossX: 0,
    bossesQueued: 0,
    bossesTriggered: 0,
    collisionStreak: 0,
    coinWindowRemaining: 0,
    coinWindowCollected: 0,
    lowHealthElapsed: 0,
    lowHealthEarned: false,
    runMinuteEarned: false,
    backwardsEarned: false,
    aerialTitleEarned: false,
  }
}

export class RunnerSimulation {
  readonly state: RunnerState
  private nextObstacleId = 1
  private nextItemId = 1
  private passedObstacles = 0
  private readonly random: () => number

  constructor(bestScore = 0, random: () => number = Math.random, progress = { lifetimeCoins: 0, highestEvolutionLevel: 1 as RunnerEvolutionLevel }) {
    this.state = initialState(Math.max(0, Math.floor(bestScore)), Math.max(0, Math.floor(progress.lifetimeCoins)), progress.highestEvolutionLevel)
    this.random = random
  }

  setViewWidth(width: number): void {
    this.state.viewWidth = Math.max(620, width)
  }

  start(): void {
    if (this.state.status === 'ready') this.state.status = 'running'
  }

  pause(): void {
    if (this.state.status === 'running') {
      this.state.status = 'paused'
      this.setGlideHeld(false)
      this.setFlightHeld(false)
      this.setSlideHeld(false)
    }
  }

  resume(): void {
    if (this.state.status === 'paused') this.state.status = 'running'
  }

  restart(startImmediately = true): void {
    const bestScore = this.state.bestScore
    Object.assign(this.state, initialState(bestScore, this.state.lifetimeCoins, this.state.highestEvolutionLevel))
    this.nextObstacleId = 1
    this.nextItemId = 1
    this.passedObstacles = 0
    if (startImmediately) this.state.status = 'running'
  }

  setGlideHeld(held: boolean): void {
    this.state.glideHeld = held && this.state.status === 'running'
    if (!this.state.glideHeld) this.state.gliding = false
  }

  setFlightHeld(held: boolean): void {
    this.state.flightHeld = held && this.state.status === 'running' && this.state.activePowerUps.flightRemaining > 0
  }

  setSlideHeld(held: boolean): void {
    this.state.slideHeld = held && this.state.status === 'running'
    this.state.sliding = this.state.slideHeld && this.state.onGround
  }

  jump(): 'jump' | 'double-jump' | false {
    if (this.state.status !== 'running' || this.state.activePowerUps.flightRemaining > 0 || this.state.jumpsUsed >= 2) return false
    const doubleJump = this.state.jumpsUsed === 1 && !this.state.onGround
    this.state.verticalSpeed = doubleJump ? RUNNER.jumpVelocity * 0.8 : RUNNER.jumpVelocity
    this.state.onGround = false
    this.state.sliding = false
    this.state.jumpsUsed++
    if (doubleJump) {
      this.state.doubleJumpedThisAir = true
      this.state.doubleJumpStreak++
      this.state.doubleJumpRemaining = 0.42
      this.emitParticles('double-jump', 14, RUNNER.playerX + 48, RUNNER.groundY - this.state.jumpHeight - 66)
      return 'double-jump'
    }
    this.state.doubleJumpedThisAir = false
    this.emitParticles('takeoff', 7, RUNNER.playerX + 48, RUNNER.groundY - 3)
    return 'jump'
  }

  step(deltaSeconds: number): RunnerEvent[] {
    const events: RunnerEvent[] = []
    const dt = Math.min(0.1, Math.max(0, deltaSeconds))
    if (this.state.status === 'game-over') {
      this.state.impactRemaining = Math.max(0, this.state.impactRemaining - dt)
      this.state.hitFlashRemaining = Math.max(0, this.state.hitFlashRemaining - dt)
      this.updateParticles(dt)
      return events
    }
    if (this.state.status !== 'running' || dt === 0) return events

    const wasAirborne = !this.state.onGround
    this.state.elapsed += dt
    this.state.evolutionRemaining = Math.max(0, this.state.evolutionRemaining - dt)
    this.state.cosmicRemaining = Math.max(0, this.state.cosmicRemaining - dt)
    this.state.doubleJumpRemaining = Math.max(0, this.state.doubleJumpRemaining - dt)
    this.state.invulnerabilityRemaining = Math.max(0, this.state.invulnerabilityRemaining - dt)
    this.state.hitFlashRemaining = Math.max(0, this.state.hitFlashRemaining - dt)
    const dashActive = this.state.activePowerUps.dashRemaining > 0
    const worldScale = this.state.activePowerUps.slowRemaining > 0 ? 0.6 : 1
    const progressionScore = this.state.distanceScore + this.passedObstacles * 18 + this.state.coinsCollected * 10 + this.state.bonusScore
    const scoreRateScale = dashActive ? 1.5 : 1
    const startSpeed = speedForScore(progressionScore)
    this.state.speed = speedForScore(progressionScore + startSpeed * worldScale * scoreRateScale * dt / 44)
    this.state.worldSpeed = this.state.speed * worldScale
    PowerUpManager.step(this.state.powerUps, this.state.activePowerUps, dt, this.state.worldSpeed)
    if (!this.state.runMinuteEarned && this.state.elapsed >= 60) {
      this.state.runMinuteEarned = true
      events.push('run-minute')
    }
    if (this.state.health === 1) {
      this.state.lowHealthElapsed += dt
      if (!this.state.lowHealthEarned && this.state.lowHealthElapsed >= 60) {
        this.state.lowHealthEarned = true
        events.push('achievement-tough')
      }
    }
    else this.state.lowHealthElapsed = 0
    if (this.state.doubleJumpStreak >= 10 && !this.state.aerialTitleEarned) {
      this.state.aerialTitleEarned = true
      events.push('title-aerial')
    }
    this.state.coinWindowRemaining = Math.max(0, this.state.coinWindowRemaining - dt)
    if (this.state.coinWindowRemaining === 0) this.state.coinWindowCollected = 0
    this.stepBoss(dt, events)
    this.state.distance += this.state.worldSpeed * dt
    this.state.distanceScore += this.state.worldSpeed * dt / 22 * (dashActive ? 1.5 : 1)
    if (this.state.activePowerUps.flightRemaining > 0) {
      this.state.flightHeld = this.state.flightHeld && this.state.status === 'running'
      this.state.gliding = false
      this.state.verticalSpeed = this.state.flightHeld ? 390 : -310
    }
    else {
      this.state.flightHeld = false
      this.state.gliding = this.state.glideHeld && wasAirborne && this.state.verticalSpeed <= 0
      const gravity = RUNNER.gravity * (this.state.gliding ? RUNNER.glideGravityScale : 1)
      this.state.verticalSpeed = this.state.gliding
        ? Math.max(-RUNNER.glideFallSpeed, this.state.verticalSpeed - gravity * dt)
        : this.state.verticalSpeed - gravity * dt
    }
    this.state.jumpHeight += this.state.verticalSpeed * dt
    this.state.jumpHeight = Math.min(250, this.state.jumpHeight)
    if (this.state.jumpHeight <= 0) {
      this.state.jumpHeight = 0
      this.state.verticalSpeed = 0
      this.state.onGround = true
      this.state.gliding = false
      if (wasAirborne) {
        if (!this.state.doubleJumpedThisAir) this.state.doubleJumpStreak = 0
        this.state.doubleJumpedThisAir = false
        this.state.jumpsUsed = 0
        this.emitParticles('landing', 7, RUNNER.playerX + 48, RUNNER.groundY - 2)
        events.push('land')
      }
    }
    else this.state.onGround = false
    this.state.sliding = this.state.slideHeld && this.state.onGround
    this.updateParticles(dt)

    for (const obstacle of this.state.obstacles) obstacle.x -= this.state.worldSpeed * dt
    this.state.spawnDistance -= this.state.worldSpeed * dt
    if (this.state.spawnDistance <= 0) this.spawnObstacle()

    CoinManager.step(this.state.coins, dt, this.state.worldSpeed, RUNNER.playerX + 48, RUNNER.groundY - this.state.jumpHeight - 66, this.state.activePowerUps.magnetRemaining > 0)
    this.state.itemSpawnDistance -= this.state.worldSpeed * dt
    if (this.state.itemSpawnDistance <= 0) this.spawnCollectible()

    const mushroomActive = this.state.activePowerUps.mushroomRemaining > 0
    const playerBox = playerHitbox(this.state.jumpHeight, this.state.sliding, mushroomActive)
    const collectedCoins = CoinManager.collect(this.state.coins, playerBox)
    if (collectedCoins > 0) {
      this.state.coinsCollected += collectedCoins
      this.state.lifetimeCoins += collectedCoins
      if (this.state.coinWindowRemaining <= 0) {
        this.state.coinWindowCollected = 0
        this.state.coinWindowRemaining = 10
      }
      this.state.coinWindowCollected += collectedCoins
      if (this.state.coinWindowCollected >= 30) {
        this.state.coinWindowCollected = 0
        this.state.coinWindowRemaining = 0
        events.push('achievement-rich')
      }
      const nextLevel = evolutionLevelForCoins(this.state.coinsCollected)
      if (nextLevel > this.state.evolutionLevel) {
        this.state.evolutionLevel = nextLevel
        this.state.highestEvolutionLevel = Math.max(this.state.highestEvolutionLevel, nextLevel) as RunnerEvolutionLevel
        this.state.evolutionRemaining = 2.4
        if (nextLevel === 5) this.state.cosmicRemaining = 4
        this.emitParticles('evolution', 24, RUNNER.playerX + 48, RUNNER.groundY - this.state.jumpHeight - 66)
        events.push(`evolution-${nextLevel}` as RunnerEvent)
      }
      const reachedBosses = Math.floor(this.state.coinsCollected / 50)
      while (this.state.bossesTriggered < reachedBosses) {
        this.state.bossesTriggered++
        if (this.state.bossRemaining > 0) this.state.bossesQueued++
        else this.startBoss(events)
      }
      this.emitParticles('collect', Math.min(12, collectedCoins * 4), RUNNER.playerX + 48, RUNNER.groundY - this.state.jumpHeight - 66)
      events.push('coin')
    }
    const collected = PowerUpManager.collect(this.state.powerUps, playerBox, this.state.activePowerUps, this.state.health, this.state.maxHealth)
    this.state.health = collected.health
    this.state.bonusScore += collected.scoreBonus
    for (const type of collected.types) {
      if (type === 'chest') {
        const reward: PowerUpType = this.random() < 0.5 ? 'flight' : 'mushroom'
        if (reward === 'flight') this.state.activePowerUps.flightRemaining = 8
        else this.state.activePowerUps.mushroomRemaining = 6
        events.push('powerup-chest', `powerup-${reward}`)
      }
      this.emitParticles(type === 'heart' ? 'heart' : 'collect', type === 'heart' ? 12 : 8, RUNNER.playerX + 48, RUNNER.groundY - this.state.jumpHeight - 66)
      if (type !== 'chest') events.push(`powerup-${type}`)
    }

    for (let index = this.state.obstacles.length - 1; index >= 0; index--) {
      const obstacle = this.state.obstacles[index]
      if (!obstacle.collisionHandled && intersects(playerBox, obstacleHitbox(obstacle))) {
        obstacle.collisionHandled = true
        if (mushroomActive && (obstacle.kind === 'small-box' || obstacle.kind === 'large-box')) {
          this.state.obstacles.splice(index, 1)
          this.state.bonusScore += 50
          this.emitParticles('collect', 10, obstacle.x + obstacle.width / 2, RUNNER.groundY - obstacle.height / 2)
          events.push('mushroom-smash')
          continue
        }
        if (this.state.activePowerUps.dashRemaining > 0) {
          events.push('dash-block')
        }
        else if (PowerUpManager.absorbShield(this.state.activePowerUps)) {
          this.state.invulnerabilityRemaining = 1.5
          this.emitParticles('shield-break', 12, RUNNER.playerX + 48, RUNNER.groundY - this.state.jumpHeight - 66)
          events.push('shield-break')
        }
        else if (this.state.invulnerabilityRemaining <= 0) {
          this.state.health = Math.max(0, this.state.health - 1)
          this.state.collisionStreak++
          this.state.hitFlashRemaining = 0.36
          this.emitParticles('hit', 9, RUNNER.playerX + 48, RUNNER.groundY - this.state.jumpHeight - 72)
          events.push('collision')
          if (this.state.collisionStreak >= 3 && !this.state.backwardsEarned) {
            this.state.backwardsEarned = true
            events.push('achievement-backwards')
          }
          if (this.state.health === 0) {
            this.state.status = 'game-over'
            this.setGlideHeld(false)
            this.setSlideHeld(false)
            this.state.invulnerabilityRemaining = 0
            this.state.impactRemaining = 0.28
            PowerUpManager.clear(this.state.powerUps, this.state.activePowerUps)
            CoinManager.clear(this.state.coins)
            this.state.bossRemaining = 0
            this.state.bossesQueued = 0
            break
          }
          this.state.invulnerabilityRemaining = 1.5
        }
        break
      }
      if (!obstacle.passed && obstacle.x + obstacle.width < RUNNER.playerX + RUNNER.playerWidth / 2) {
        obstacle.passed = true
        this.passedObstacles++
        events.push('passed')
      }
    }

    this.state.obstacles = this.state.obstacles.filter(obstacle => obstacle.x + obstacle.width >= -24)
    this.state.score = Math.floor(this.state.distanceScore) + this.passedObstacles * 18 + this.state.coinsCollected * 10 + this.state.bonusScore
    if (this.state.score > this.state.bestScore) {
      this.state.bestScore = this.state.score
      if (!this.state.newRecordThisRun) {
        this.state.newRecordThisRun = true
        events.push('new-record')
      }
    }
    return events
  }

  private startBoss(events: RunnerEvent[]): void {
    this.state.bossRemaining = 10
    this.state.bossAttackRemaining = 0.85
    this.state.bossX = this.state.viewWidth - 145
    events.push('boss-start')
  }

  private stepBoss(dt: number, events: RunnerEvent[]): void {
    if (this.state.bossRemaining > 0) {
      this.state.bossRemaining = Math.max(0, this.state.bossRemaining - dt)
      this.state.bossX = Math.max(RUNNER.playerX + 250, this.state.bossX - this.state.worldSpeed * 0.34 * dt)
      this.state.bossAttackRemaining -= dt
      if (this.state.bossAttackRemaining <= 0 && this.state.bossRemaining > 0) {
        this.state.obstacles.push({ id: this.nextObstacleId++, kind: 'small-box', x: this.state.bossX - 54, width: OBSTACLE_SIZE['small-box'].width, height: OBSTACLE_SIZE['small-box'].height, passed: false })
        this.state.bossAttackRemaining = 1.45
      }
      if (this.state.bossRemaining === 0) {
        const info = { id: this.nextItemId++, type: 'chest' as const, x: RUNNER.playerX + 255, y: RUNNER.groundY - 43, width: 38, height: 36, hitbox: { left: 0, right: 0, top: 0, bottom: 0 }, duration: 0, effect: 'treasure' as const, pickupSound: 'chest' as const, status: 'available' as const }
        info.hitbox = { left: info.x - info.width / 2, right: info.x + info.width / 2, top: info.y - info.height / 2, bottom: info.y + info.height / 2 }
        this.state.powerUps.push(info)
        events.push('boss-win')
      }
    }
    if (this.state.bossRemaining === 0 && this.state.bossesQueued > 0 && this.state.status === 'running') {
      this.state.bossesQueued--
      this.startBoss(events)
    }
  }

  private spawnObstacle(): void {
    const difficulty = Math.min(1, this.state.score / 750)
    const roll = this.random()
    const kind: ObstacleKind = roll < 0.34 - difficulty * 0.04
      ? 'small-box'
      : roll < 0.54 - difficulty * 0.02 ? 'large-box'
        : roll < 0.70 ? 'roadblock'
          : roll < 0.84 ? 'tire-stack' : 'overhead-bar'
    const size = OBSTACLE_SIZE[kind]
    this.state.obstacles.push({ id: this.nextObstacleId++, kind, x: this.state.viewWidth + 24, ...size, passed: false })
    this.state.spawnDistance += obstacleGap(this.state.speed, difficulty, this.random())
  }

  private spawnCollectible(): void {
    const obstacles = this.state.obstacles.map(({ x, width, height }) => ({ x, width, height }))
    if (this.random() < 0.24) {
      const type = pickPowerUp(this.random, this.state.health, this.state.maxHealth)
      PowerUpManager.spawn(this.state.powerUps, this.nextItemId++, type, this.state.viewWidth, RUNNER.groundY, obstacles, this.random)
    }
    else {
      this.nextItemId += CoinManager.spawn(this.state.coins, this.nextItemId, this.state.viewWidth, RUNNER.groundY, obstacles, this.random)
    }
    this.state.itemSpawnDistance += this.state.worldSpeed * (1.6 + Math.min(0.9, this.random() * 0.9))
  }

  private emitParticles(kind: RunnerParticleKind, count: number, x: number, y: number): void {
    const offset = this.state.elapsed * 7
    for (let i = 0; i < count && this.state.particles.length < 64; i++) {
      const angle = (Math.PI * 2 * i) / count + offset
      const speed = kind === 'double-jump' ? 72 + (i % 4) * 16 : 34 + (i % 3) * 13
      const life = kind === 'evolution' ? 0.72 : kind === 'double-jump' ? 0.48 : kind === 'hit' || kind === 'shield-break' ? 0.42 : 0.34
      this.state.particles.push({
        kind,
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - (kind === 'double-jump' ? 25 : kind === 'hit' ? 15 : 38),
        life,
        maxLife: life,
        size: kind === 'double-jump' ? 3 + (i % 3) : 2 + (i % 2),
      })
    }
  }

  private updateParticles(dt: number): void {
    for (const particle of this.state.particles) {
      particle.life -= dt
      particle.x += (particle.vx - this.state.speed) * dt
      particle.y += particle.vy * dt
      particle.vy += 120 * dt
    }
    this.state.particles = this.state.particles.filter(particle => particle.life > 0)
  }
}
