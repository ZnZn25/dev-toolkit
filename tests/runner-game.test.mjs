import assert from 'node:assert/strict'
import test from 'node:test'
import { intersects, obstacleGap, obstacleHitbox, playerHitbox, RUNNER, RunnerSimulation, speedForScore } from '../src/core/runner-game.ts'
import { evolutionLevelForCoins } from '../src/core/runner-evolution.ts'
import { loadRunnerBestScore, loadRunnerEvolutionRecord, RUNNER_BEST_SCORE_KEY, RUNNER_EVOLUTION_RECORD_KEY, saveRunnerBestScore, saveRunnerEvolutionRecord } from '../src/core/runner-record.ts'
import { CoinManager, POWER_UP_INFO, PowerUpManager } from '../src/core/runner-items.ts'

function stopNaturalSpawns(game) {
  game.state.spawnDistance = Number.MAX_SAFE_INTEGER
  game.state.itemSpawnDistance = Number.MAX_SAFE_INTEGER
}

function powerUp(type, id, x, y) {
  const info = POWER_UP_INFO[type]
  return {
    id, type, x, y, width: 34, height: 34,
    hitbox: { left: x - 17, right: x + 17, top: y - 17, bottom: y + 17 },
    duration: info.duration, effect: info.effect, pickupSound: info.pickupSound, status: 'available',
  }
}

test('space starts, double-jumps once in the air, lands, and restores both jumps', () => {
  const game = new RunnerSimulation(0, () => 0.5)
  game.start()
  assert.equal(game.state.status, 'running')
  game.state.spawnDistance = Number.MAX_SAFE_INTEGER
  assert.equal(game.jump(), 'jump')
  assert.equal(game.state.onGround, false)
  assert.equal(game.state.jumpsUsed, 1)
  for (let i = 0; i < 30; i++) game.step(1 / 60)
  assert.equal(game.jump(), 'double-jump')
  assert.equal(game.state.jumpsUsed, 2)
  assert.equal(game.state.verticalSpeed, RUNNER.jumpVelocity * 0.8)
  assert.equal(game.state.doubleJumpRemaining, 0.42)
  assert.equal(game.jump(), false)
  for (let i = 0; i < 120; i++) game.step(1 / 60)
  assert.equal(game.state.onGround, true)
  assert.equal(game.state.jumpHeight, 0)
  assert.equal(game.state.jumpsUsed, 0)
  assert.equal(game.jump(), 'jump')
})

test('holding space slows descent after the jump apex, and release restores normal gravity', () => {
  const glider = new RunnerSimulation(0, () => 0.5)
  const normal = new RunnerSimulation(0, () => 0.5)
  for (const game of [glider, normal]) {
    game.start()
    stopNaturalSpawns(game)
    game.jump()
  }
  glider.setGlideHeld(true)
  for (let i = 0; i < 60; i++) {
    glider.step(1 / 60)
    normal.step(1 / 60)
  }
  assert.equal(glider.state.gliding, true)
  assert.ok(glider.state.jumpHeight > 0)
  assert.equal(normal.state.onGround, true)
  assert.equal(glider.state.verticalSpeed, -RUNNER.glideFallSpeed)

  const glideFallSpeed = glider.state.verticalSpeed
  glider.setGlideHeld(false)
  assert.equal(glider.state.gliding, false)
  glider.step(0.1)
  assert.equal(glider.state.verticalSpeed, glideFallSpeed - RUNNER.gravity * 0.1)

  glider.setGlideHeld(true)
  glider.pause()
  assert.equal(glider.state.glideHeld, false)
  assert.equal(glider.state.gliding, false)
  glider.restart()
  assert.equal(glider.state.glideHeld, false)
  assert.equal(glider.state.gliding, false)
})

test('Ctrl slide clears an overhead bar, remains vulnerable to ground obstacles, and resets on release', () => {
  const game = new RunnerSimulation(0, () => 0.5)
  game.start()
  stopNaturalSpawns(game)
  const overhead = { id: 1, kind: 'overhead-bar', x: RUNNER.playerX + 30, width: 112, height: 30, top: RUNNER.groundY - 80, passed: false }
  assert.equal(intersects(playerHitbox(0), obstacleHitbox(overhead)), true)
  assert.equal(intersects(playerHitbox(0, true), obstacleHitbox(overhead)), false)
  assert.equal(intersects(playerHitbox(80), obstacleHitbox(overhead)), false)

  game.setSlideHeld(true)
  assert.equal(game.state.sliding, true)
  game.state.obstacles.push(overhead)
  assert.equal(game.step(1 / 60).includes('collision'), false)
  assert.equal(game.state.health, 3)
  game.setSlideHeld(false)
  assert.equal(game.state.slideHeld, false)
  assert.equal(game.state.sliding, false)

  game.state.obstacles.push({ id: 2, kind: 'tire-stack', x: RUNNER.playerX + 30, width: 72, height: 54, passed: false })
  game.setSlideHeld(true)
  assert.equal(game.step(1 / 60).includes('collision'), true)
  assert.equal(game.state.health, 2)
})

test('spawn selection includes tire stacks and overhead bars', () => {
  const rolls = [0.78, 0.5, 0.95, 0.5]
  const game = new RunnerSimulation(0, () => rolls.shift() ?? 0.5)
  game.start()
  stopNaturalSpawns(game)
  game.state.spawnDistance = 0
  game.step(1 / 60)
  assert.equal(game.state.obstacles.at(-1).kind, 'tire-stack')
  game.state.spawnDistance = 0
  game.step(1 / 60)
  assert.equal(game.state.obstacles.at(-1).kind, 'overhead-bar')
})

test('an obstacle removes one life, while a correctly timed double jump clears it', () => {
  const grounded = new RunnerSimulation(0, () => 0.5)
  grounded.start()
  grounded.state.spawnDistance = Number.MAX_SAFE_INTEGER
  grounded.state.obstacles.push({ id: 1, kind: 'small-box', x: RUNNER.playerX + 30, width: 46, height: 38, passed: false })
  assert.ok(grounded.step(1 / 60).includes('collision'))
  assert.equal(grounded.state.health, 2)
  assert.equal(grounded.state.status, 'running')

  const airborne = new RunnerSimulation(0, () => 0.5)
  airborne.start()
  airborne.state.spawnDistance = Number.MAX_SAFE_INTEGER
  airborne.jump()
  for (let i = 0; i < 18; i++) airborne.step(1 / 60)
  assert.equal(airborne.jump(), 'double-jump')
  airborne.state.obstacles.push({ id: 1, kind: 'small-box', x: RUNNER.playerX + 30, width: 46, height: 38, passed: false })
  airborne.step(1 / 60)
  assert.equal(airborne.state.status, 'running')
  assert.equal(airborne.state.health, 3)
})

test('one contact costs at most one life, and three protected hits end the run', () => {
  const game = new RunnerSimulation(0, () => 0.5)
  game.start()
  game.state.spawnDistance = Number.MAX_SAFE_INTEGER
  const obstacle = () => ({ id: game.state.obstacles.length + 1, kind: 'small-box', x: RUNNER.playerX + 30, width: 46, height: 38, passed: false })

  game.state.obstacles.push(obstacle())
  assert.ok(game.step(1 / 60).includes('collision'))
  assert.equal(game.state.health, 2)
  assert.equal(game.state.invulnerabilityRemaining, 1.5)
  assert.equal(game.step(1 / 60).includes('collision'), false)
  game.state.obstacles.push(obstacle())
  assert.equal(game.step(1 / 60).includes('collision'), false)
  assert.equal(game.state.health, 2)

  for (let i = 0; i < 91; i++) game.step(1 / 60)
  game.state.obstacles.push(obstacle())
  assert.ok(game.step(1 / 60).includes('collision'))
  assert.equal(game.state.health, 1)
  for (let i = 0; i < 91; i++) game.step(1 / 60)
  game.state.obstacles.push(obstacle())
  assert.ok(game.step(1 / 60).includes('collision'))
  assert.equal(game.state.health, 0)
  assert.equal(game.state.status, 'game-over')
})

test('a jump cannot repeat while airborne and pause freezes score, distance, and time', () => {
  const game = new RunnerSimulation(0, () => 0.5)
  game.start()
  game.jump()
  game.jump()
  assert.equal(game.jump(), false)
  for (let i = 0; i < 45; i++) game.step(1 / 60)
  game.pause()
  const before = { score: game.state.score, distance: game.state.distance, elapsed: game.state.elapsed }
  for (let i = 0; i < 60; i++) game.step(1 / 60)
  assert.deepEqual({ score: game.state.score, distance: game.state.distance, elapsed: game.state.elapsed }, before)
  game.resume()
  assert.equal(game.state.status, 'running')
})

test('restart clears the previous run and preserves the record', () => {
  const game = new RunnerSimulation(120, () => 0.5)
  game.start()
  game.state.score = 80
  game.state.distance = 1000
  game.state.elapsed = 12
  game.state.jumpHeight = 70
  game.state.onGround = false
  game.state.obstacles.push({ id: 1, kind: 'large-box', x: 500, width: 58, height: 63, passed: false })
  game.state.coins.push({ id: 2, x: 500, y: 200, radius: 13, phase: 0, hitbox: { left: 487, right: 513, top: 187, bottom: 213 } })
  game.state.powerUps.push(powerUp('slow', 3, 500, 200))
  game.state.activePowerUps.slowRemaining = 4
  game.state.coinsCollected = 5
  game.restart()
  assert.equal(game.state.status, 'running')
  assert.equal(game.state.score, 0)
  assert.equal(game.state.health, 3)
  assert.equal(game.state.invulnerabilityRemaining, 0)
  assert.equal(game.state.distance, 0)
  assert.equal(game.state.elapsed, 0)
  assert.equal(game.state.jumpHeight, 0)
  assert.equal(game.state.jumpsUsed, 0)
  assert.equal(game.state.onGround, true)
  assert.equal(game.state.obstacles.length, 0)
  assert.equal(game.state.coins.length, 0)
  assert.equal(game.state.powerUps.length, 0)
  assert.equal(game.state.coinsCollected, 0)
  assert.deepEqual(game.state.activePowerUps, { shield: false, slowRemaining: 0, magnetRemaining: 0, dashRemaining: 0, flightRemaining: 0, mushroomRemaining: 0 })
  assert.equal(game.state.particles.length, 0)
  assert.equal(game.state.bestScore, 120)
})

test('speed rises to a cap and obstacle spacing leaves time to land and jump again', () => {
  assert.equal(speedForScore(0), RUNNER.initialSpeed)
  assert.ok(speedForScore(500) > speedForScore(100))
  assert.equal(speedForScore(10000), RUNNER.maximumSpeed)
  const minimumGap = obstacleGap(RUNNER.maximumSpeed, 1, 0)
  assert.equal(minimumGap, RUNNER.maximumSpeed * RUNNER.minimumGapSeconds)
  const flightSeconds = 2 * RUNNER.jumpVelocity / RUNNER.gravity
  assert.ok(RUNNER.minimumGapSeconds > flightSeconds + 0.45)

  const box = { id: 1, kind: 'large-box', x: RUNNER.playerX + 25, width: 58, height: 63, passed: false }
  assert.equal(playerHitbox(160).bottom < obstacleHitbox(box).top, true)
})

test('60 Hz and 120 Hz steps produce the same score and distance', () => {
  const sixty = new RunnerSimulation(0, () => 0.5)
  const oneTwenty = new RunnerSimulation(0, () => 0.5)
  sixty.start()
  oneTwenty.start()
  sixty.state.spawnDistance = Number.MAX_SAFE_INTEGER
  oneTwenty.state.spawnDistance = Number.MAX_SAFE_INTEGER
  for (let i = 0; i < 600; i++) sixty.step(1 / 60)
  for (let i = 0; i < 1200; i++) oneTwenty.step(1 / 120)
  assert.equal(sixty.state.score, oneTwenty.state.score)
  assert.ok(Math.abs(sixty.state.distance - oneTwenty.state.distance) < 0.5)
  assert.ok(Math.abs(sixty.state.elapsed - oneTwenty.state.elapsed) < 0.001)
})

test('long simulation keeps obstacle storage bounded', () => {
  const game = new RunnerSimulation(0, () => 0.5)
  game.start()
  for (let i = 0; i < 60 * 60; i++) {
    if (game.state.status === 'game-over') game.restart()
    game.step(1 / 60)
  }
  assert.ok(game.state.obstacles.length <= 2)
  assert.ok(game.state.obstacles.every(obstacle => Number.isFinite(obstacle.x)))
  assert.ok(game.state.coins.length < 40)
  assert.ok(game.state.powerUps.length < 5)
})

test('shield absorbs one collision before hit points and protects overlapping contacts', () => {
  const game = new RunnerSimulation(0, () => 0.5)
  game.start()
  stopNaturalSpawns(game)
  game.state.activePowerUps.shield = true
  const obstacle = id => ({ id, kind: 'small-box', x: RUNNER.playerX + 30, width: 46, height: 38, passed: false })
  game.state.obstacles.push(obstacle(1), obstacle(2))
  const events = game.step(1 / 60)
  assert.ok(events.includes('shield-break'))
  assert.equal(events.includes('collision'), false)
  assert.equal(game.state.health, 3)
  assert.equal(game.state.activePowerUps.shield, false)
  assert.equal(game.state.invulnerabilityRemaining, 1.5)
  game.state.obstacles.push(obstacle(3))
  game.step(1 / 60)
  assert.equal(game.state.health, 3)
})

test('dash immunity has priority over shield and boosts distance score by 50 percent', () => {
  const dash = new RunnerSimulation(0, () => 0.5)
  const normal = new RunnerSimulation(0, () => 0.5)
  dash.start(); normal.start()
  stopNaturalSpawns(dash); stopNaturalSpawns(normal)
  dash.state.activePowerUps.dashRemaining = 4
  dash.state.activePowerUps.shield = true
  dash.state.obstacles.push({ id: 1, kind: 'small-box', x: RUNNER.playerX + 30, width: 46, height: 38, passed: false })
  assert.ok(dash.step(1 / 60).includes('dash-block'))
  assert.equal(dash.state.health, 3)
  assert.equal(dash.state.activePowerUps.shield, true)
  for (let i = 0; i < 60; i++) { dash.step(1 / 60); normal.step(1 / 60) }
  assert.ok(dash.state.distanceScore / normal.state.distanceScore > 1.45)
})

test('slow motion affects world travel but not jump physics, and its timer freezes while paused', () => {
  const slow = new RunnerSimulation(0, () => 0.5)
  const normal = new RunnerSimulation(0, () => 0.5)
  slow.start(); normal.start()
  stopNaturalSpawns(slow); stopNaturalSpawns(normal)
  slow.state.activePowerUps.slowRemaining = 5
  slow.jump(); normal.jump()
  for (let i = 0; i < 30; i++) { slow.step(1 / 60); normal.step(1 / 60) }
  assert.ok(slow.state.distance < normal.state.distance * 0.61)
  assert.ok(Math.abs(slow.state.jumpHeight - normal.state.jumpHeight) < 0.001)
  const remaining = slow.state.activePowerUps.slowRemaining
  slow.pause()
  slow.step(1)
  assert.equal(slow.state.activePowerUps.slowRemaining, remaining)
  slow.resume()
  for (let i = 0; i < 5; i++) slow.step(0.1)
  assert.ok(Math.abs(slow.state.activePowerUps.slowRemaining - (remaining - 0.5)) < 0.001)
})

test('coins are magnetized independently and each collected coin adds ten points', () => {
  const coins = [{ id: 1, x: 250, y: 180, radius: 13, phase: 0, hitbox: { left: 237, right: 263, top: 167, bottom: 193 } }]
  const originalX = coins[0].x
  CoinManager.step(coins, 1 / 60, 0, 130, 200, true)
  assert.ok(coins[0].x < originalX)
  assert.ok(coins[0].y > 180)

  const game = new RunnerSimulation(0, () => 0.5)
  game.start(); stopNaturalSpawns(game)
  const speed = game.state.worldSpeed
  const x = RUNNER.playerX + 48 + speed / 60
  game.state.coins.push({ id: 1, x, y: RUNNER.groundY - 66, radius: 13, phase: 0, hitbox: { left: x - 13, right: x + 13, top: RUNNER.groundY - 79, bottom: RUNNER.groundY - 53 } })
  assert.ok(game.step(1 / 60).includes('coin'))
  assert.equal(game.state.coinsCollected, 1)
  assert.equal(game.state.score, 10)
})

test('evolution levels switch at the exact coin thresholds', () => {
  assert.equal(evolutionLevelForCoins(29), 1)
  assert.equal(evolutionLevelForCoins(30), 2)
  assert.equal(evolutionLevelForCoins(59), 2)
  assert.equal(evolutionLevelForCoins(60), 3)
  assert.equal(evolutionLevelForCoins(89), 3)
  assert.equal(evolutionLevelForCoins(90), 4)
  assert.equal(evolutionLevelForCoins(119), 4)
  assert.equal(evolutionLevelForCoins(120), 5)
  assert.equal(evolutionLevelForCoins(Number.POSITIVE_INFINITY), 1)
})

test('coin batches can cross multiple evolution levels and preserve lifetime progress on restart', () => {
  const game = new RunnerSimulation(0, () => 0.5, { lifetimeCoins: 23, highestEvolutionLevel: 1 })
  game.start()
  stopNaturalSpawns(game)
  game.state.coinsCollected = 29
  const x = RUNNER.playerX + 48 + game.state.worldSpeed / 60
  game.state.coins = Array.from({ length: 101 }, (_, index) => ({
    id: index + 1, x, y: RUNNER.groundY - 66, radius: 13, phase: 0,
    hitbox: { left: x - 13, right: x + 13, top: RUNNER.groundY - 79, bottom: RUNNER.groundY - 53 },
  }))
  const events = game.step(1 / 60)
  assert.equal(game.state.coinsCollected, 130)
  assert.equal(game.state.lifetimeCoins, 124)
  assert.equal(game.state.evolutionLevel, 5)
  assert.equal(game.state.highestEvolutionLevel, 5)
  assert.ok(events.includes('evolution-5'))
  assert.equal(game.state.evolutionRemaining, 2.4)

  game.pause()
  game.step(0.1)
  assert.equal(game.state.evolutionRemaining, 2.4)
  game.resume()
  game.restart()
  assert.equal(game.state.coinsCollected, 0)
  assert.equal(game.state.evolutionLevel, 1)
  assert.equal(game.state.lifetimeCoins, 124)
  assert.equal(game.state.highestEvolutionLevel, 5)
})

test('a magnet-attracted coin also advances evolution', () => {
  const game = new RunnerSimulation(0, () => 0.5)
  game.start()
  stopNaturalSpawns(game)
  game.state.coinsCollected = 29
  game.state.activePowerUps.magnetRemaining = 5
  const x = RUNNER.playerX + 118
  game.state.coins.push({ id: 1, x, y: RUNNER.groundY - 66, radius: 13, phase: 0, hitbox: { left: x - 13, right: x + 13, top: RUNNER.groundY - 79, bottom: RUNNER.groundY - 53 } })
  assert.ok(game.step(0.1).includes('coin'))
  assert.equal(game.state.coinsCollected, 30)
  assert.equal(game.state.evolutionLevel, 2)
})

test('every 50 collected coins starts a ten-second boss chase and a surviving chase drops a chest', () => {
  const game = new RunnerSimulation(0, () => 0.5)
  game.start(); stopNaturalSpawns(game)
  game.state.coinsCollected = 49
  const x = RUNNER.playerX + 48 + game.state.worldSpeed / 60
  game.state.coins.push({ id: 1, x, y: RUNNER.groundY - 66, radius: 13, phase: 0, hitbox: { left: x - 13, right: x + 13, top: RUNNER.groundY - 79, bottom: RUNNER.groundY - 53 } })
  assert.ok(game.step(1 / 60).includes('boss-start'))
  assert.equal(game.state.bossesTriggered, 1)
  assert.ok(game.state.bossRemaining > 9.9)

  game.state.bossRemaining = 0.01
  const events = game.step(1 / 60)
  assert.ok(events.includes('boss-win'))
  assert.ok(game.state.powerUps.some(item => item.type === 'chest'))
})

test('a chest grants flight, whose held and released controls raise and lower the runner', () => {
  const game = new RunnerSimulation(0, () => 0.1)
  game.start(); stopNaturalSpawns(game)
  const x = RUNNER.playerX + 48 + game.state.worldSpeed / 60
  game.state.powerUps.push(powerUp('chest', 1, x, RUNNER.groundY - 66))
  const events = game.step(1 / 60)
  assert.ok(events.includes('powerup-flight'))
  assert.equal(game.state.activePowerUps.flightRemaining, 8)
  game.setFlightHeld(true)
  game.step(0.1)
  const highPoint = game.state.jumpHeight
  assert.ok(highPoint > 0)
  game.setFlightHeld(false)
  game.step(0.1)
  assert.ok(game.state.jumpHeight < highPoint)
})

test('mushroom size doubles the hitbox and breaks wooden boxes for bonus points', () => {
  const normal = playerHitbox(0)
  const giant = playerHitbox(0, false, true)
  assert.equal(giant.right - giant.left, (normal.right - normal.left) * 2)
  const game = new RunnerSimulation(0, () => 0.5)
  game.start(); stopNaturalSpawns(game)
  game.state.activePowerUps.mushroomRemaining = 6
  game.state.obstacles.push({ id: 1, kind: 'small-box', x: RUNNER.playerX + 55 + game.state.worldSpeed / 60, width: 46, height: 38, passed: false })
  const events = game.step(1 / 60)
  assert.ok(events.includes('mushroom-smash'))
  assert.equal(game.state.obstacles.length, 0)
  assert.equal(game.state.bonusScore, 50)
})

test('run minute and one-health minute awards each trigger once', () => {
  const game = new RunnerSimulation(0, () => 0.5)
  game.start(); stopNaturalSpawns(game)
  game.state.elapsed = 59.99
  game.state.health = 1
  game.state.lowHealthElapsed = 59.99
  const events = game.step(0.02)
  assert.ok(events.includes('run-minute'))
  assert.ok(events.includes('achievement-tough'))
  assert.equal(game.step(0.1).includes('run-minute'), false)
  assert.equal(game.step(0.1).includes('achievement-tough'), false)
})

test('30 coins in the ten-second window and ten consecutive double-jumps unlock their rewards', () => {
  const rich = new RunnerSimulation(0, () => 0.5)
  rich.start(); stopNaturalSpawns(rich)
  const x = RUNNER.playerX + 48 + rich.state.worldSpeed / 60
  rich.state.coins = Array.from({ length: 30 }, (_, id) => ({ id, x, y: RUNNER.groundY - 66, radius: 13, phase: 0, hitbox: { left: x - 13, right: x + 13, top: RUNNER.groundY - 79, bottom: RUNNER.groundY - 53 } }))
  assert.ok(rich.step(1 / 60).includes('achievement-rich'))

  const jumper = new RunnerSimulation(0, () => 0.5)
  jumper.start(); stopNaturalSpawns(jumper)
  for (let count = 0; count < 10; count++) {
    jumper.state.onGround = false
    jumper.state.jumpsUsed = 1
    jumper.state.jumpHeight = 100
    jumper.state.doubleJumpedThisAir = false
    assert.equal(jumper.jump(), 'double-jump')
    jumper.state.jumpHeight = 1
    jumper.state.verticalSpeed = -100
    const events = jumper.step(0.1)
    if (count === 9) assert.ok(events.includes('title-aerial'))
  }
})

test('three actual collisions unlock the backwards message even when the third hit ends the run', () => {
  const game = new RunnerSimulation(0, () => 0.5)
  game.start(); stopNaturalSpawns(game)
  let thirdHitEvents = []
  for (let hit = 0; hit < 3; hit++) {
    game.state.invulnerabilityRemaining = 0
    game.state.obstacles = [{ id: hit + 1, kind: 'small-box', x: RUNNER.playerX + 10 + game.state.worldSpeed / 60, width: 46, height: 38, passed: false }]
    thirdHitEvents = game.step(1 / 60)
  }
  assert.ok(thirdHitEvents.includes('achievement-backwards'))
  assert.equal(game.state.status, 'game-over')
})

test('heart pickup caps at three, while a full-health pickup becomes a score bonus', () => {
  const game = new RunnerSimulation(0, () => 0.5)
  game.start(); stopNaturalSpawns(game)
  game.state.health = 2
  const x = RUNNER.playerX + 48 + game.state.worldSpeed / 60
  game.state.powerUps.push(powerUp('heart', 1, x, RUNNER.groundY - 66))
  assert.ok(game.step(1 / 60).includes('powerup-heart'))
  assert.equal(game.state.health, 3)

  const full = new RunnerSimulation(0, () => 0.5)
  full.start(); stopNaturalSpawns(full)
  const fullX = RUNNER.playerX + 48 + full.state.worldSpeed / 60
  full.state.powerUps.push(powerUp('heart', 1, fullX, RUNNER.groundY - 66))
  full.step(1 / 60)
  assert.equal(full.state.health, 3)
  assert.equal(full.state.bonusScore, 30)
  assert.equal(full.state.score, 30)
  assert.equal(full.state.coinsCollected, 0)
  assert.equal(full.state.evolutionLevel, 1)
})

test('same power-up refreshes its timer and independent effects coexist', () => {
  const effects = { shield: false, slowRemaining: 1, magnetRemaining: 0, dashRemaining: 0 }
  const y = 200
  const items = [powerUp('slow', 1, 100, y), powerUp('magnet', 2, 100, y)]
  const result = PowerUpManager.collect(items, { left: 80, right: 120, top: 180, bottom: 220 }, effects, 3, 3)
  assert.deepEqual(result.types.sort(), ['magnet', 'slow'])
  assert.equal(effects.slowRemaining, 5)
  assert.equal(effects.magnetRemaining, 8)
  assert.equal(items.length, 0)
})

test('slow motion expires and restores the normal world speed', () => {
  const game = new RunnerSimulation(0, () => 0.5)
  game.start(); stopNaturalSpawns(game)
  game.state.activePowerUps.slowRemaining = 0.02
  game.step(1 / 60)
  assert.ok(Math.abs(game.state.worldSpeed / game.state.speed - 0.6) < 0.001)
  game.step(1 / 60)
  assert.equal(game.state.activePowerUps.slowRemaining, 0)
  game.step(1 / 60)
  assert.equal(game.state.worldSpeed, game.state.speed)
})

test('record storage validates values and survives unavailable storage', () => {
  const values = new Map()
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  }
  assert.equal(loadRunnerBestScore(storage), 0)
  saveRunnerBestScore(456, storage)
  assert.equal(values.get(RUNNER_BEST_SCORE_KEY), '456')
  assert.equal(loadRunnerBestScore(storage), 456)
  saveRunnerBestScore(-1, storage)
  assert.equal(loadRunnerBestScore(storage), 456)
  assert.equal(loadRunnerBestScore({ getItem() { throw new Error('blocked') }, setItem() {} }), 0)
})

test('evolution record stores lifetime coins and sanitizes malformed values', () => {
  const values = new Map()
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  }
  assert.deepEqual(loadRunnerEvolutionRecord(storage), { lifetimeCoins: 0, highestEvolutionLevel: 1 })
  saveRunnerEvolutionRecord({ lifetimeCoins: 124, highestEvolutionLevel: 3 }, storage)
  assert.deepEqual(loadRunnerEvolutionRecord(storage), { lifetimeCoins: 124, highestEvolutionLevel: 3 })
  assert.equal(values.has(RUNNER_EVOLUTION_RECORD_KEY), true)
  values.set(RUNNER_EVOLUTION_RECORD_KEY, '{"lifetimeCoins":-4,"highestEvolutionLevel":9}')
  assert.deepEqual(loadRunnerEvolutionRecord(storage), { lifetimeCoins: 0, highestEvolutionLevel: 1 })
  saveRunnerEvolutionRecord({ lifetimeCoins: -1, highestEvolutionLevel: 3 }, storage)
  assert.deepEqual(loadRunnerEvolutionRecord(storage), { lifetimeCoins: 0, highestEvolutionLevel: 1 })
})
