import { RUNNER, type RunnerObstacle, type RunnerState } from './runner-game.ts'
import { evolutionForLevel } from './runner-evolution.ts'

const TAU = Math.PI * 2

function wrap(value: number, length: number): number {
  return ((value % length) + length) % length
}

export function renderRunner(ctx: CanvasRenderingContext2D, state: RunnerState, effects: 'full' | 'reduced' | 'off' = 'full'): void {
  const width = state.viewWidth
  const sky = ctx.createLinearGradient(0, 0, 0, RUNNER.height)
  sky.addColorStop(0, '#83d3f0')
  sky.addColorStop(0.72, '#c6eff4')
  sky.addColorStop(1, '#f5f3d9')
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, width, RUNNER.height)

  drawSun(ctx, width)
  drawClouds(ctx, state.distance, width)
  drawHills(ctx, state.distance, width)
  drawGround(ctx, state.distance, width)
  if (state.bossRemaining > 0) drawBoss(ctx, state.bossX, RUNNER.groundY, state.elapsed)
  for (const obstacle of state.obstacles) drawObstacle(ctx, obstacle)
  drawCoins(ctx, state)
  for (const item of state.powerUps) drawPowerUp(ctx, item.type, item.x, item.y, state.elapsed)
  if (effects !== 'off') drawPowerEffects(ctx, state, effects === 'reduced')
  drawRunner(ctx, state, effects)
  if (effects === 'full') drawParticles(ctx, state)
  if (state.activePowerUps.slowRemaining > 0) {
    ctx.fillStyle = 'rgba(106, 187, 244, .10)'
    ctx.fillRect(0, 0, width, RUNNER.height)
  }
}

function drawCoins(ctx: CanvasRenderingContext2D, state: RunnerState): void {
  for (const coin of state.coins) {
    const bob = Math.sin(state.elapsed * 5 + coin.phase) * 3
    const turn = Math.max(0.22, Math.abs(Math.cos(state.elapsed * 6 + coin.phase)))
    ctx.save()
    ctx.translate(coin.x, coin.y + bob)
    ctx.scale(turn, 1)
    ctx.shadowColor = '#ffd85a'
    ctx.shadowBlur = 12
    ctx.fillStyle = '#f2ad35'
    ctx.beginPath()
    ctx.arc(0, 0, coin.radius, 0, TAU)
    ctx.fill()
    ctx.shadowBlur = 0
    ctx.strokeStyle = '#fff1a3'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.arc(0, 0, coin.radius - 4, 0, TAU)
    ctx.stroke()
    ctx.fillStyle = '#ffe47b'
    ctx.fillRect(-2, -6, 4, 12)
    ctx.restore()
  }
}

function drawPowerUp(ctx: CanvasRenderingContext2D, type: string, x: number, y: number, elapsed: number): void {
  const colors: Record<string, string> = { shield: '#eeb94e', slow: '#5daee8', magnet: '#e76566', dash: '#e5a743', heart: '#eb6676', chest: '#c8863b', flight: '#58bfe5', mushroom: '#df5c52' }
  const bob = Math.sin(elapsed * 4 + x * 0.03) * 3
  ctx.save()
  ctx.translate(x, y + bob)
  ctx.shadowColor = colors[type] ?? '#fff'
  ctx.shadowBlur = 13
  ctx.fillStyle = '#fffaf0'
  ctx.beginPath()
  if (type === 'chest') ctx.roundRect(-21, -16, 42, 34, 6)
  else ctx.arc(0, 0, 20, 0, TAU)
  ctx.fill()
  ctx.shadowBlur = 0
  ctx.fillStyle = colors[type] ?? '#888'
  ctx.strokeStyle = '#fff'
  ctx.lineWidth = 2
  if (type === 'chest') {
    ctx.fillStyle = '#bc7732'; ctx.strokeStyle = '#8e572d'; ctx.lineWidth = 2.5
    ctx.beginPath(); ctx.roundRect(-16, -10, 32, 23, 4); ctx.fill(); ctx.stroke()
    ctx.fillStyle = '#f2c75d'; ctx.fillRect(-3, -8, 6, 20); ctx.fillRect(-17, -3, 34, 4)
    ctx.fillStyle = '#fff0a5'; ctx.beginPath(); ctx.arc(0, -1, 2, 0, TAU); ctx.fill()
  }
  else if (type === 'mushroom') {
    ctx.fillStyle = '#f0d5a0'; ctx.beginPath(); ctx.roundRect(-5, -2, 10, 15, 4); ctx.fill()
    ctx.fillStyle = '#e45c50'; ctx.strokeStyle = '#a63e41'; ctx.lineWidth = 2
    ctx.beginPath(); ctx.ellipse(0, -3, 14, 10, 0, Math.PI, TAU); ctx.lineTo(14, -2); ctx.quadraticCurveTo(0, 4, -14, -2); ctx.closePath(); ctx.fill(); ctx.stroke()
    ctx.fillStyle = '#fff3dc'; ctx.beginPath(); ctx.arc(-6, -7, 3, 0, TAU); ctx.arc(5, -8, 3, 0, TAU); ctx.fill()
  }
  else if (type === 'flight') {
    ctx.fillStyle = '#58bfe5'; ctx.beginPath(); ctx.moveTo(0, -15); ctx.lineTo(12, 11); ctx.lineTo(0, 6); ctx.lineTo(-12, 11); ctx.closePath(); ctx.fill()
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, 7); ctx.lineTo(0, -9); ctx.moveTo(0, -1); ctx.lineTo(-6, -6); ctx.moveTo(0, -1); ctx.lineTo(6, -6); ctx.stroke()
  }
  else if (type === 'heart') drawHeartGlyph(ctx)
  else if (type === 'shield') {
    ctx.beginPath()
    ctx.moveTo(0, -13); ctx.lineTo(12, -8); ctx.lineTo(10, 4); ctx.quadraticCurveTo(7, 11, 0, 14); ctx.quadraticCurveTo(-7, 11, -10, 4); ctx.lineTo(-12, -8); ctx.closePath()
    ctx.fill(); ctx.stroke()
    ctx.strokeStyle = '#fff6ce'; ctx.lineWidth = 2
    ctx.beginPath(); ctx.moveTo(-5, -1); ctx.lineTo(-1, 4); ctx.lineTo(6, -5); ctx.stroke()
  }
  else if (type === 'slow') {
    ctx.lineCap = 'round'; ctx.lineWidth = 2.5
    for (let i = 0; i < 3; i++) {
      ctx.save(); ctx.rotate(i * TAU / 6)
      ctx.beginPath(); ctx.moveTo(0, -12); ctx.lineTo(0, 12); ctx.moveTo(0, -8); ctx.lineTo(-4, -4); ctx.moveTo(0, -8); ctx.lineTo(4, -4); ctx.stroke()
      ctx.restore()
    }
  }
  else if (type === 'magnet') {
    ctx.strokeStyle = '#d94754'; ctx.lineWidth = 6; ctx.lineCap = 'round'
    ctx.beginPath(); ctx.moveTo(-9, -10); ctx.lineTo(-9, 4); ctx.quadraticCurveTo(-9, 12, 0, 12); ctx.quadraticCurveTo(9, 12, 9, 4); ctx.lineTo(9, -10); ctx.stroke()
    ctx.strokeStyle = '#f8f3ea'; ctx.lineWidth = 3
    ctx.beginPath(); ctx.moveTo(-11, -9); ctx.lineTo(-5, -9); ctx.moveTo(5, -9); ctx.lineTo(11, -9); ctx.stroke()
  }
  else {
    ctx.beginPath(); ctx.moveTo(2, -14); ctx.lineTo(-8, 1); ctx.lineTo(-1, 1); ctx.lineTo(-4, 13); ctx.lineTo(9, -4); ctx.lineTo(2, -4); ctx.closePath(); ctx.fill()
    ctx.fillStyle = '#e3a33e'; ctx.beginPath(); ctx.arc(-10, 10, 2, 0, TAU); ctx.arc(-14, 5, 1.5, 0, TAU); ctx.fill()
  }
  ctx.restore()
}

function drawHeartGlyph(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = '#eb6676'
  ctx.beginPath()
  ctx.moveTo(0, 12); ctx.bezierCurveTo(-17, 2, -10, -12, -2, -8); ctx.quadraticCurveTo(0, -7, 0, -3); ctx.quadraticCurveTo(7, -15, 14, -7); ctx.bezierCurveTo(21, 2, 9, 10, 0, 12); ctx.fill()
}

function drawBoss(ctx: CanvasRenderingContext2D, x: number, groundY: number, elapsed: number): void {
  const y = groundY - 78 + Math.sin(elapsed * 3) * 5
  ctx.save()
  ctx.translate(x, y)
  ctx.shadowColor = '#7d476b'; ctx.shadowBlur = 16
  ctx.fillStyle = '#68445d'; ctx.beginPath(); ctx.ellipse(59, 31, 54, 38, -0.08, 0, TAU); ctx.fill()
  ctx.shadowBlur = 0
  ctx.fillStyle = '#826078'; ctx.beginPath(); ctx.ellipse(18, 8, 28, 24, -0.2, 0, TAU); ctx.fill()
  ctx.fillStyle = '#302637'; ctx.beginPath(); ctx.moveTo(5, -5); ctx.lineTo(8, -28); ctx.lineTo(25, -15); ctx.lineTo(37, -31); ctx.lineTo(43, -7); ctx.closePath(); ctx.fill()
  ctx.fillStyle = '#f4ce71'; ctx.beginPath(); ctx.arc(17, 5, 4, 0, TAU); ctx.arc(32, 2, 4, 0, TAU); ctx.fill()
  ctx.strokeStyle = '#e59d83'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(93, 41); ctx.quadraticCurveTo(126, 42, 121, 13); ctx.stroke()
  ctx.restore()
}

function drawPowerEffects(ctx: CanvasRenderingContext2D, state: RunnerState, reduced: boolean): void {
  const centerX = RUNNER.playerX + 51
  const centerY = RUNNER.groundY - state.jumpHeight - 82
  if (state.activePowerUps.dashRemaining > 0) {
    ctx.save()
    ctx.strokeStyle = 'rgba(255,255,255,.72)'
    ctx.lineCap = 'round'
    for (let i = 0; i < (reduced ? 2 : 4); i++) {
      const x = RUNNER.playerX - 10 - i * 15
      const y = RUNNER.groundY - state.jumpHeight - 26 - ((i * 19) % 51)
      ctx.globalAlpha = 0.75 - i * 0.13
      ctx.lineWidth = 3 - i * 0.35
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 20 - i * 4, y + 3); ctx.stroke()
    }
    ctx.restore()
  }
  if (state.activePowerUps.shield) {
    ctx.save()
    ctx.strokeStyle = 'rgba(255,211,100,.86)'
    ctx.fillStyle = 'rgba(255,224,137,.12)'
    ctx.lineWidth = reduced ? 2 : 3
    ctx.beginPath(); ctx.ellipse(centerX, centerY, 59, 74, 0, 0, TAU); ctx.fill(); ctx.stroke()
    ctx.restore()
  }
  if (state.activePowerUps.flightRemaining > 0) {
    ctx.save()
    ctx.strokeStyle = 'rgba(109,224,255,.9)'; ctx.fillStyle = 'rgba(109,224,255,.12)'; ctx.lineWidth = reduced ? 2 : 3
    ctx.beginPath(); ctx.ellipse(centerX, centerY, 63, 81, 0, 0, TAU); ctx.fill(); ctx.stroke()
    ctx.restore()
  }
  if (state.activePowerUps.mushroomRemaining > 0) {
    ctx.save()
    ctx.strokeStyle = 'rgba(255,105,92,.85)'; ctx.lineWidth = reduced ? 2 : 3
    ctx.setLineDash([7, 5]); ctx.beginPath(); ctx.ellipse(centerX + 8, centerY - 25, 80, 145, 0, 0, TAU); ctx.stroke()
    ctx.restore()
  }
}

function drawSun(ctx: CanvasRenderingContext2D, width: number): void {
  ctx.save()
  ctx.globalAlpha = 0.92
  ctx.fillStyle = '#fff1ad'
  ctx.beginPath()
  ctx.arc(width - 94, 72, 32, 0, TAU)
  ctx.fill()
  ctx.fillStyle = '#fff8d8'
  ctx.beginPath()
  ctx.arc(width - 104, 62, 20, 0, TAU)
  ctx.fill()
  ctx.restore()
}

function drawClouds(ctx: CanvasRenderingContext2D, distance: number, width: number): void {
  ctx.fillStyle = 'rgba(255,255,255,.82)'
  for (let i = 0; i < 5; i++) {
    const cloudWidth = 88 + (i % 3) * 19
    const x = wrap(i * 263 - distance * 0.045 + 140, width + 200) - 110
    const y = 43 + (i % 3) * 37
    ctx.beginPath()
    ctx.ellipse(x, y + 8, cloudWidth * 0.43, 13, 0, 0, TAU)
    ctx.ellipse(x - 20, y, 19, 16, 0, 0, TAU)
    ctx.ellipse(x + 4, y - 9, 25, 22, 0, 0, TAU)
    ctx.ellipse(x + 30, y + 1, 19, 16, 0, 0, TAU)
    ctx.fill()
  }
}

function drawHills(ctx: CanvasRenderingContext2D, distance: number, width: number): void {
  ctx.fillStyle = '#a5d8b9'
  ctx.beginPath()
  ctx.moveTo(0, 255)
  const farOffset = wrap(distance * 0.075, 350)
  for (let x = -360 - farOffset; x <= width + 360; x += 350) {
    ctx.quadraticCurveTo(x + 90, 198, x + 180, 251)
    ctx.quadraticCurveTo(x + 275, 289, x + 350, 230)
  }
  ctx.lineTo(width, RUNNER.groundY)
  ctx.lineTo(0, RUNNER.groundY)
  ctx.closePath()
  ctx.fill()

  ctx.fillStyle = '#77bf9b'
  ctx.beginPath()
  ctx.moveTo(0, 292)
  const nearOffset = wrap(distance * 0.16, 270)
  for (let x = -280 - nearOffset; x <= width + 280; x += 270) {
    ctx.quadraticCurveTo(x + 78, 231, x + 147, 286)
    ctx.quadraticCurveTo(x + 218, 327, x + 270, 274)
  }
  ctx.lineTo(width, RUNNER.groundY)
  ctx.lineTo(0, RUNNER.groundY)
  ctx.closePath()
  ctx.fill()
}

function drawGround(ctx: CanvasRenderingContext2D, distance: number, width: number): void {
  ctx.fillStyle = '#e5c78f'
  ctx.fillRect(0, RUNNER.groundY, width, RUNNER.height - RUNNER.groundY)
  ctx.fillStyle = '#75b88b'
  ctx.fillRect(0, RUNNER.groundY, width, 6)
  ctx.fillStyle = '#4e9d72'
  ctx.fillRect(0, RUNNER.groundY, width, 2)

  const offset = wrap(distance * 0.9, 72)
  for (let x = -offset; x < width + 72; x += 72) {
    ctx.fillStyle = '#c29e68'
    ctx.beginPath()
    ctx.ellipse(x + 22, RUNNER.groundY + 36, 12, 2, 0, 0, TAU)
    ctx.fill()
    ctx.fillStyle = '#79a86d'
    ctx.fillRect(x + 49, RUNNER.groundY + 17, 3, 7)
    ctx.fillRect(x + 46, RUNNER.groundY + 18, 3, 2)
    ctx.fillRect(x + 52, RUNNER.groundY + 15, 3, 2)
  }
}

function drawObstacle(ctx: CanvasRenderingContext2D, obstacle: RunnerObstacle): void {
  const y = obstacle.top ?? RUNNER.groundY - obstacle.height
  if (obstacle.kind === 'roadblock') {
    drawRoadblock(ctx, obstacle, y)
    return
  }
  if (obstacle.kind === 'tire-stack') {
    drawTireStack(ctx, obstacle)
    return
  }
  if (obstacle.kind === 'overhead-bar') {
    drawOverheadBar(ctx, obstacle, y)
    return
  }

  ctx.save()
  ctx.fillStyle = obstacle.kind === 'large-box' ? '#a66e42' : '#c88951'
  ctx.strokeStyle = '#694c3b'
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.roundRect(obstacle.x, y, obstacle.width, obstacle.height, 5)
  ctx.fill()
  ctx.stroke()
  ctx.strokeStyle = '#714d36'
  ctx.lineWidth = 4
  ctx.beginPath()
  ctx.moveTo(obstacle.x + 8, y + 9)
  ctx.lineTo(obstacle.x + obstacle.width - 8, y + obstacle.height - 9)
  ctx.moveTo(obstacle.x + obstacle.width - 8, y + 9)
  ctx.lineTo(obstacle.x + 8, y + obstacle.height - 9)
  ctx.stroke()
  ctx.fillStyle = '#e1b47a'
  ctx.beginPath()
  ctx.arc(obstacle.x + obstacle.width / 2, y + obstacle.height / 2, 4, 0, TAU)
  ctx.fill()
  ctx.restore()
}

function drawTireStack(ctx: CanvasRenderingContext2D, obstacle: RunnerObstacle): void {
  ctx.save()
  const tires = [
    { x: obstacle.x + 19, y: RUNNER.groundY - 18 },
    { x: obstacle.x + 53, y: RUNNER.groundY - 18 },
    { x: obstacle.x + 36, y: RUNNER.groundY - 37 },
  ]
  for (const tire of tires) {
    ctx.fillStyle = '#414a4a'
    ctx.strokeStyle = '#293434'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.arc(tire.x, tire.y, 18, 0, TAU)
    ctx.fill()
    ctx.stroke()
    ctx.strokeStyle = '#727b73'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(tire.x, tire.y, 11, 0, TAU)
    ctx.stroke()
    ctx.fillStyle = '#c4b08a'
    ctx.beginPath()
    ctx.arc(tire.x, tire.y, 5, 0, TAU)
    ctx.fill()
  }
  ctx.restore()
}

function drawOverheadBar(ctx: CanvasRenderingContext2D, obstacle: RunnerObstacle, y: number): void {
  ctx.save()
  ctx.strokeStyle = '#5d7281'
  ctx.lineWidth = 4
  ctx.beginPath()
  ctx.moveTo(obstacle.x + 13, y - 23)
  ctx.lineTo(obstacle.x + 13, y + 3)
  ctx.moveTo(obstacle.x + obstacle.width - 13, y - 23)
  ctx.lineTo(obstacle.x + obstacle.width - 13, y + 3)
  ctx.stroke()
  ctx.fillStyle = '#586b78'
  ctx.strokeStyle = '#3d505c'
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.roundRect(obstacle.x, y, obstacle.width, obstacle.height, 7)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = '#f5c95f'
  for (let x = obstacle.x + 12; x < obstacle.x + obstacle.width - 8; x += 26) {
    ctx.beginPath()
    ctx.moveTo(x, y + 7)
    ctx.lineTo(x + 10, y + 7)
    ctx.lineTo(x + 3, y + obstacle.height - 7)
    ctx.lineTo(x - 7, y + obstacle.height - 7)
    ctx.closePath()
    ctx.fill()
  }
  ctx.restore()
}

function drawRoadblock(ctx: CanvasRenderingContext2D, obstacle: RunnerObstacle, y: number): void {
  ctx.save()
  ctx.fillStyle = '#57545a'
  ctx.beginPath()
  ctx.roundRect(obstacle.x + 8, RUNNER.groundY - 12, 13, 12, 3)
  ctx.roundRect(obstacle.x + obstacle.width - 21, RUNNER.groundY - 12, 13, 12, 3)
  ctx.fill()
  ctx.fillStyle = '#ee754f'
  ctx.strokeStyle = '#8b4e40'
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.roundRect(obstacle.x, y + 5, obstacle.width, obstacle.height - 8, 7)
  ctx.fill()
  ctx.stroke()
  ctx.save()
  ctx.beginPath()
  ctx.roundRect(obstacle.x + 2, y + 6, obstacle.width - 4, obstacle.height - 11, 5)
  ctx.clip()
  ctx.strokeStyle = '#fff0cf'
  ctx.lineWidth = 13
  for (let x = obstacle.x - 26; x < obstacle.x + obstacle.width + 32; x += 34) {
    ctx.beginPath()
    ctx.moveTo(x, RUNNER.groundY)
    ctx.lineTo(x + 31, y)
    ctx.stroke()
  }
  ctx.restore()
  ctx.fillStyle = '#fff7df'
  ctx.beginPath()
  ctx.arc(obstacle.x + obstacle.width / 2, y + 22, 3, 0, TAU)
  ctx.fill()
  ctx.restore()
}

function drawRunner(ctx: CanvasRenderingContext2D, state: RunnerState, effects: 'full' | 'reduced' | 'off'): void {
  const evolution = evolutionForLevel(state.evolutionLevel)
  const airborne = !state.onGround
  const runPhase = state.elapsed * 13
  const bob = state.status === 'running' && !airborne && !state.sliding ? Math.abs(Math.sin(runPhase * 2)) * 3 : 0
  const hitProgress = state.hitFlashRemaining > 0
    ? 0.45 + (1 - state.hitFlashRemaining / 0.36) * 0.55
    : state.status === 'game-over' ? 1 - state.impactRemaining / 0.28 : 0
  const lean = state.status === 'game-over' ? Math.min(0.42, Math.max(0, hitProgress) * 0.42) : 0

  ctx.save()
  const shadowScale = Math.max(0.35, 1 - state.jumpHeight / 240)
  ctx.fillStyle = 'rgba(72,82,57,.16)'
  ctx.beginPath()
  ctx.ellipse(RUNNER.playerX + 48, RUNNER.groundY - 2, 43 * shadowScale, 7 * shadowScale, 0, 0, TAU)
  ctx.fill()
  ctx.translate(RUNNER.playerX + 7, RUNNER.groundY - state.jumpHeight - bob)
  if (state.activePowerUps.mushroomRemaining > 0) ctx.scale(2, 2)
  if (state.sliding) ctx.scale(1, 0.36)
  if (lean) ctx.rotate(lean)
  if (state.doubleJumpRemaining > 0) {
    const progress = 1 - state.doubleJumpRemaining / 0.42
    ctx.translate(55, -75)
    ctx.rotate(Math.PI * 2 * progress)
    ctx.translate(-55, 75)
  }
  if (state.gliding) drawGlideWinds(ctx)
  if (effects !== 'off') {
    if (runningForState(state)) drawEvolutionTrail(ctx, state, evolution.trail, evolution.appearance, effects === 'reduced')
    drawEvolutionAura(ctx, state, evolution.glow, effects === 'reduced')
  }
  if (state.invulnerabilityRemaining > 0 && Math.floor((1.5 - state.invulnerabilityRemaining) * 12) % 2 === 0) ctx.globalAlpha = 0.38
  drawCharacter(ctx, state, runPhase, airborne, hitProgress, evolution)
  ctx.restore()
}

function runningForState(state: RunnerState): boolean {
  return state.status === 'running' && state.onGround && !state.sliding
}

function drawEvolutionTrail(ctx: CanvasRenderingContext2D, state: RunnerState, color: string, appearance: string, reduced: boolean): void {
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineCap = 'round'
  ctx.globalAlpha = appearance === 'cosmic' ? 0.55 : 0.42
  for (let i = 0; i < (reduced ? 1 : 3); i++) {
    const y = -28 - ((i * 23 + Math.floor(state.elapsed * 38)) % 64)
    ctx.lineWidth = 2 + i * 0.5
    ctx.beginPath()
    ctx.moveTo(9 - i * 5, y)
    ctx.lineTo(-13 - i * 8, y + Math.sin(state.elapsed * 14 + i) * 3)
    ctx.stroke()
  }
  if (appearance === 'cosmic') {
    ctx.fillStyle = color
    for (let i = 0; i < (reduced ? 1 : 3); i++) {
      const x = -13 - ((state.elapsed * (24 + i * 5) + i * 31) % 55)
      const y = -25 - ((i * 27 + Math.floor(state.elapsed * 32)) % 83)
      ctx.beginPath(); ctx.arc(x, y, i === 0 ? 2.2 : 1.4, 0, TAU); ctx.fill()
    }
  }
  ctx.restore()
}

function drawEvolutionAura(ctx: CanvasRenderingContext2D, state: RunnerState, color: string, reduced: boolean): void {
  if (color === 'transparent' && state.evolutionRemaining <= 0) return
  const evolutionFlash = state.evolutionRemaining > 0 ? state.evolutionRemaining / 2.4 : 0
  ctx.save()
  ctx.globalAlpha = color === 'transparent' ? evolutionFlash * 0.6 : 0.14 + evolutionFlash * 0.38
  ctx.strokeStyle = color === 'transparent' ? '#ffffff' : color
  ctx.shadowColor = ctx.strokeStyle
  ctx.shadowBlur = reduced ? 0 : 11 + evolutionFlash * 20
  ctx.lineWidth = reduced ? 2 : 3
  ctx.beginPath()
  ctx.ellipse(56, -78, 43 + evolutionFlash * 5, 76 + evolutionFlash * 7, 0, 0, TAU)
  ctx.stroke()
  ctx.restore()
}

function drawGlideWinds(ctx: CanvasRenderingContext2D): void {
  ctx.save()
  ctx.strokeStyle = '#eafaff'
  ctx.lineWidth = 3
  ctx.lineCap = 'round'
  ctx.globalAlpha = 0.72
  for (let i = 0; i < 3; i++) {
    const y = -29 - i * 20
    ctx.beginPath()
    ctx.moveTo(-31, y)
    ctx.quadraticCurveTo(-17, y - 4, -3, y + 1)
    ctx.stroke()
  }
  ctx.restore()
}

function drawParticles(ctx: CanvasRenderingContext2D, state: RunnerState): void {
  const evolution = evolutionForLevel(state.evolutionLevel)
  ctx.save()
  for (const particle of state.particles) {
    const progress = particle.life / particle.maxLife
    ctx.globalAlpha = Math.min(1, progress * 1.5)
    ctx.fillStyle = particle.kind === 'evolution' ? (evolution.glow === 'transparent' ? evolution.trim : evolution.glow)
      : particle.kind === 'double-jump' ? (evolution.doubleJumpEffect === 'dust' ? '#fff1a8' : evolution.trim)
      : particle.kind === 'landing' ? '#c8ad79'
        : particle.kind === 'hit' ? '#fff1a8'
          : particle.kind === 'shield-break' ? '#ffd565'
            : particle.kind === 'heart' ? '#ef6a80'
              : particle.kind === 'collect' ? '#ffe890'
                : particle.kind === 'dash' ? '#d8f5ff' : '#f4e6b5'
    if (particle.kind === 'double-jump' && evolution.doubleJumpEffect === 'lightning') {
      ctx.strokeStyle = evolution.trim
      ctx.lineWidth = 2
      ctx.beginPath(); ctx.moveTo(particle.x, particle.y); ctx.lineTo(particle.x + particle.size, particle.y - particle.size); ctx.lineTo(particle.x - 1, particle.y - particle.size * 1.6); ctx.lineTo(particle.x + particle.size, particle.y - particle.size * 2.2); ctx.stroke()
    }
    else if (particle.kind === 'double-jump' && evolution.doubleJumpEffect === 'cosmic') {
      drawStar(ctx, particle.x, particle.y, particle.size * progress, (1 - progress) * 2)
    }
    else if (particle.kind === 'evolution') {
      drawStar(ctx, particle.x, particle.y, particle.size * progress * 1.8, (1 - progress) * 2)
    }
    else if (particle.kind === 'double-jump') {
      ctx.save()
      ctx.translate(particle.x, particle.y)
      ctx.rotate((1 - progress) * 2)
      ctx.fillRect(-particle.size / 2, -particle.size / 2, particle.size, particle.size)
      ctx.restore()
    }
    else {
      ctx.beginPath()
      ctx.arc(particle.x, particle.y, particle.size * progress, 0, TAU)
      ctx.fill()
    }
  }
  ctx.restore()
}

function drawStar(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, rotation: number): void {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(rotation)
  ctx.beginPath()
  for (let point = 0; point < 8; point++) {
    const angle = point * Math.PI / 4
    const radius = point % 2 ? size * 0.4 : size
    const px = Math.cos(angle) * radius
    const py = Math.sin(angle) * radius
    if (point === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

function drawCharacter(ctx: CanvasRenderingContext2D, state: RunnerState, phase: number, airborne: boolean, hitProgress: number, evolution: ReturnType<typeof evolutionForLevel>): void {
  const running = state.status === 'running' && !airborne && !state.sliding
  const stride = running ? Math.sin(phase) * 15 : 0
  const legBend = airborne ? 9 : running ? 5 + Math.max(0, Math.cos(phase)) * 5 : 0

  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = '#343844'
  ctx.lineWidth = 13
  ctx.beginPath()
  if (airborne) {
    ctx.moveTo(43, -30)
    ctx.lineTo(30, -13)
    ctx.lineTo(23, -4)
    ctx.moveTo(61, -29)
    ctx.lineTo(75, -17)
    ctx.lineTo(70, -5)
  } else {
    ctx.moveTo(43, -30)
    ctx.lineTo(43 - stride, -12 - legBend)
    ctx.lineTo(39 - stride * 1.5, -3)
    ctx.moveTo(62, -30)
    ctx.lineTo(62 + stride, -12 + legBend)
    ctx.lineTo(63 + stride * 1.45, -3)
  }
  ctx.stroke()
  drawShoe(ctx, 39 - (airborne ? 16 : stride * 1.5), -1, -1)
  drawShoe(ctx, 63 + (airborne ? 7 : stride * 1.45), -1, 1)

  ctx.strokeStyle = evolution.outfit
  ctx.lineWidth = 15
  ctx.beginPath()
  if (airborne && state.gliding) {
    ctx.moveTo(35, -63)
    ctx.quadraticCurveTo(17, -66, 3, -60)
    ctx.moveTo(72, -62)
    ctx.quadraticCurveTo(91, -67, 105, -60)
  } else if (airborne) {
    ctx.moveTo(35, -63)
    ctx.quadraticCurveTo(13, -81, 5, -102)
    ctx.moveTo(72, -62)
    ctx.quadraticCurveTo(96, -80, 99, -97)
  } else if (running) {
    ctx.moveTo(35, -63)
    ctx.quadraticCurveTo(20, -57 + Math.sin(phase) * 7, 18 + Math.sin(phase) * 12, -47)
    ctx.moveTo(72, -63)
    ctx.quadraticCurveTo(90, -56 - Math.sin(phase) * 7, 83 - Math.sin(phase) * 12, -47)
  } else {
    ctx.moveTo(35, -63)
    ctx.lineTo(23, -43)
    ctx.moveTo(72, -63)
    ctx.lineTo(81, -43)
  }
  ctx.stroke()
  if (airborne) {
    ctx.fillStyle = '#f3c99a'
    ctx.beginPath()
    if (state.gliding) {
      ctx.arc(3, -60, 7, 0, TAU)
      ctx.arc(105, -60, 7, 0, TAU)
    } else {
      ctx.arc(5, -102, 7, 0, TAU)
      ctx.arc(99, -97, 7, 0, TAU)
    }
    ctx.fill()
  }

  ctx.fillStyle = evolution.outfit
  ctx.strokeStyle = evolution.appearance === 'classic' ? '#374b35' : evolution.trim
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.roundRect(27, -76, 54, 53, 14)
  ctx.fill()
  ctx.stroke()
  drawEvolutionOutfit(ctx, evolution.appearance, evolution.trim)

  ctx.strokeStyle = '#ece8d4'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(47, -86)
  ctx.bezierCurveTo(48, -60, 39, -51, 51, -34)
  ctx.stroke()
  ctx.fillStyle = '#f2eee1'
  ctx.beginPath()
  ctx.roundRect(44, -89, 6, 12, 3)
  ctx.fill()

  ctx.fillStyle = '#f2c69a'
  ctx.beginPath()
  ctx.ellipse(58, -105, 8, 12, -0.13, 0, TAU)
  ctx.fill()
  ctx.beginPath()
  ctx.ellipse(62, -116, 25, 26, 0.03, 0, TAU)
  ctx.fill()

  ctx.fillStyle = '#d99f79'
  ctx.beginPath()
  ctx.ellipse(39, -111, 5, 8, 0, 0, TAU)
  ctx.fill()
  ctx.fillStyle = '#392f32'
  ctx.beginPath()
  ctx.ellipse(55, -118, 2.4, 3.3, 0, 0, TAU)
  ctx.ellipse(73, -118, 2.4, 3.3, 0, 0, TAU)
  ctx.fill()
  ctx.fillStyle = '#fff'
  ctx.beginPath()
  ctx.arc(55.5, -119, 0.9, 0, TAU)
  ctx.arc(73.5, -119, 0.9, 0, TAU)
  ctx.fill()
  ctx.strokeStyle = '#a86e69'
  ctx.lineWidth = 1.7
  ctx.beginPath()
  ctx.moveTo(67, -103)
  ctx.quadraticCurveTo(73, -99, 79, -103)
  ctx.stroke()

  ctx.strokeStyle = '#252832'
  ctx.lineWidth = 3.2
  ctx.beginPath()
  ctx.arc(55, -117, 13, 0, TAU)
  ctx.arc(77, -117, 13, 0, TAU)
  ctx.moveTo(68, -117)
  ctx.lineTo(64, -117)
  ctx.moveTo(42, -118)
  ctx.lineTo(36, -120)
  ctx.moveTo(90, -118)
  ctx.lineTo(95, -120)
  ctx.stroke()

  ctx.fillStyle = '#151820'
  ctx.beginPath()
  ctx.moveTo(39, -124)
  ctx.quadraticCurveTo(30, -140, 45, -140)
  ctx.lineTo(40, -151)
  ctx.lineTo(56, -143)
  ctx.lineTo(57, -158)
  ctx.lineTo(69, -144)
  ctx.lineTo(82, -153)
  ctx.lineTo(78, -139)
  ctx.lineTo(97, -143)
  ctx.lineTo(88, -132)
  ctx.quadraticCurveTo(85, -126, 79, -124)
  ctx.quadraticCurveTo(66, -135, 54, -125)
  ctx.quadraticCurveTo(47, -120, 39, -124)
  ctx.closePath()
  ctx.fill()
  ctx.strokeStyle = '#25252e'
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(46, -138)
  ctx.lineTo(41, -149)
  ctx.moveTo(61, -141)
  ctx.lineTo(65, -155)
  ctx.moveTo(76, -138)
  ctx.lineTo(91, -146)
  ctx.stroke()

  if (evolution.appearance === 'speed') drawHeadband(ctx, evolution.trim)

  if (hitProgress > 0) drawBumpStars(ctx, hitProgress, evolution.trim)
}

function drawEvolutionOutfit(ctx: CanvasRenderingContext2D, appearance: string, trim: string): void {
  if (appearance === 'classic') {
    drawCamouflage(ctx)
    return
  }
  ctx.save()
  ctx.strokeStyle = trim
  ctx.lineWidth = 3
  ctx.lineCap = 'round'
  if (appearance === 'speed') {
    ctx.beginPath(); ctx.moveTo(34, -68); ctx.lineTo(72, -68); ctx.moveTo(38, -47); ctx.lineTo(77, -47); ctx.stroke()
  }
  else if (appearance === 'thunder') {
    ctx.beginPath(); ctx.moveTo(58, -72); ctx.lineTo(49, -58); ctx.lineTo(59, -58); ctx.lineTo(52, -42); ctx.lineTo(69, -61); ctx.lineTo(59, -61); ctx.stroke()
  }
  else if (appearance === 'gold') {
    ctx.lineWidth = 5
    ctx.beginPath(); ctx.moveTo(34, -68); ctx.lineTo(74, -68); ctx.moveTo(37, -42); ctx.lineTo(71, -42); ctx.stroke()
    ctx.beginPath(); ctx.arc(54, -56, 7, 0, TAU); ctx.fillStyle = '#fff0ba'; ctx.fill()
  }
  else {
    ctx.fillStyle = trim
    for (const [x, y] of [[39, -64], [68, -51], [49, -39]] as const) drawStar(ctx, x, y, 4, 0)
  }
  ctx.restore()
}

function drawHeadband(ctx: CanvasRenderingContext2D, color: string): void {
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = 4
  ctx.lineCap = 'round'
  ctx.beginPath(); ctx.moveTo(40, -137); ctx.quadraticCurveTo(64, -145, 87, -137); ctx.moveTo(86, -137); ctx.lineTo(97, -129); ctx.stroke()
  ctx.restore()
}

function drawShoe(ctx: CanvasRenderingContext2D, x: number, y: number, direction: number): void {
  ctx.fillStyle = '#f4eee0'
  ctx.beginPath()
  ctx.ellipse(x + direction * 4, y, 12, 5.5, direction * -0.1, 0, TAU)
  ctx.fill()
  ctx.strokeStyle = '#555860'
  ctx.lineWidth = 1.5
  ctx.stroke()
}

function drawCamouflage(ctx: CanvasRenderingContext2D): void {
  ctx.save()
  ctx.beginPath()
  ctx.roundRect(28, -75, 52, 51, 13)
  ctx.clip()
  ctx.fillStyle = '#43543d'
  ctx.fillRect(28, -75, 52, 51)
  ctx.fillStyle = '#879065'
  ctx.beginPath()
  ctx.moveTo(31, -68)
  ctx.lineTo(46, -74)
  ctx.lineTo(55, -66)
  ctx.lineTo(49, -59)
  ctx.lineTo(36, -60)
  ctx.closePath()
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(62, -52)
  ctx.lineTo(76, -60)
  ctx.lineTo(84, -55)
  ctx.lineTo(78, -44)
  ctx.lineTo(65, -43)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = '#242f2d'
  ctx.beginPath()
  ctx.moveTo(27, -42)
  ctx.lineTo(39, -54)
  ctx.lineTo(48, -46)
  ctx.lineTo(44, -34)
  ctx.lineTo(29, -31)
  ctx.closePath()
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(52, -77)
  ctx.lineTo(66, -76)
  ctx.lineTo(60, -64)
  ctx.lineTo(52, -61)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = '#c2bb8d'
  ctx.fillRect(44, -70, 5, 3)
  ctx.fillRect(69, -39, 7, 3)
  ctx.restore()
}

function drawBumpStars(ctx: CanvasRenderingContext2D, progress: number, color: string): void {
  ctx.save()
  ctx.globalAlpha = Math.min(1, progress * 3)
  ctx.fillStyle = color
  for (let i = 0; i < 3; i++) {
    const angle = i * TAU / 3
    const x = 64 + Math.cos(angle) * 31
    const y = -163 + Math.sin(angle) * 13
    ctx.beginPath()
    ctx.arc(x, y, 3, 0, TAU)
    ctx.fill()
  }
  ctx.restore()
}
