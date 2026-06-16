// Copyright 2025-2026 Arun Rajkumar
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

/**
 * Pollen Pop — pure game logic for the level-based popping game.
 *
 * Framework-free and shared. The server owns the mote field: it spawns motes
 * with a server-seeded RNG and streams their spawn parameters; the client
 * renders them deterministically. A pop the client sends is validated
 * server-side, so the client can never invent a mote or pop one twice.
 *
 * Levels + lives: clear a per-level pop quota to advance; each level spawns on a
 * quicker (jittered) cadence and the motes rise faster (density still capped by
 * MAX_CONCURRENT_MOTES), so the late game outpaces a screenshot-then-click bot.
 * Letting flowers escape past a per-level budget costs a life; the run ends at
 * zero lives. Score is total pops — the depth you reach is the score, no ceiling.
 */

/** Renderable blossom glyphs; index is server-chosen so both sides agree. */
export const MOTE_EMOJI = ['🌸', '🌼', '💮', '🌺'] as const

/** Lives a game starts with; over-escaping within a level costs one. */
export const POLLEN_LIVES = 3
/** Flowers that may drift off-screen per level before a life is lost. */
export const POLLEN_ESCAPE_BUDGET = 6

/** Pops needed to clear a level — grows each level. */
const QUOTA_BASE = 8
const QUOTA_STEP = 4
export function quotaForLevel(level: number): number {
  return QUOTA_BASE + (level - 1) * QUOTA_STEP
}

/** Spawn interval (ms): SPAWN_START_MS at level 1, easing to SPAWN_MIN_MS as the
 *  level climbs. The floor stays well above zero — density is bounded by the
 *  live-mote cap, not the cadence. */
export const SPAWN_START_MS = 600
export const SPAWN_MIN_MS = 320
/** Motes rise up to (1 + SPEED_RAMP)× faster at the top of the ramp. */
export const SPEED_RAMP = 1.6
/** Levels over which the difficulty eases from level 1 to fully ramped. */
const LEVELS_TO_MAX = 8
/** Hard ceiling on live motes — the arena never floods, so the late game is a
 *  reaction test of fast, fleeting targets rather than a flooded click-farm. */
export const MAX_CONCURRENT_MOTES = 8
/** Cadence jitter (±fraction). 0.5 RNG is neutral, keeping cadence deterministic. */
export const SPAWN_JITTER = 0.3

/** Below this y (percent, 0 = top) a mote has drifted off the top and dies. */
const DESPAWN_Y = -8
/** Spawn y (percent) — just below the arena floor, so motes rise into view. */
const SPAWN_Y = 104

/** Difficulty ramp 0..1 across the first LEVELS_TO_MAX levels. */
function levelRamp(level: number): number {
  return Math.min(1, Math.max(0, (level - 1) / LEVELS_TO_MAX))
}

/**
 * Time between spawns at a level — eases from SPAWN_START_MS down to
 * SPAWN_MIN_MS so the cadence quickens as you climb. The floor stays well above
 * zero; the live count, not the cadence, bounds on-screen density.
 */
export function spawnIntervalForLevel(level: number): number {
  return SPAWN_START_MS - levelRamp(level) * (SPAWN_START_MS - SPAWN_MIN_MS)
}

/**
 * The level cadence with ±SPAWN_JITTER randomness applied, so spawns don't fall
 * on a predictable metronome. `rng() === 0.5` is neutral (returns the base),
 * which keeps seeded callers deterministic.
 */
export function jitteredIntervalMs(level: number, rng: () => number = Math.random): number {
  return spawnIntervalForLevel(level) * (1 - SPAWN_JITTER + rng() * 2 * SPAWN_JITTER)
}

/**
 * One drifting blossom. Spawn parameters are fixed at creation; position at any
 * later time is a pure function of them, so the server is the source of truth
 * and the client merely interpolates.
 */
export interface Mote {
  id: number
  spawnAtMs: number
  x: number // percent, horizontal start
  vy: number // percent/sec upward
  vx: number // percent/sec horizontal drift
  scale: number
  emojiIndex: number
}

/**
 * Spawn a mote with server-seeded (or test) RNG. `level` ramps the rise speed;
 * the spread on position, drift, size, and speed is deliberately wide so
 * trajectories vary shot-to-shot.
 */
export function spawnMote(
  id: number,
  spawnAtMs: number,
  rng: () => number = Math.random,
  level = 1,
): Mote {
  const speed = 1 + levelRamp(level) * SPEED_RAMP
  return {
    id,
    spawnAtMs,
    x: 6 + rng() * 88,
    vy: (8 + rng() * 14) * speed,
    vx: (rng() - 0.5) * 14,
    scale: 0.7 + rng() * 1.0,
    emojiIndex: Math.floor(rng() * MOTE_EMOJI.length),
  }
}

/** A mote's position (percent) at wall-clock `nowMs`. Pure and deterministic. */
export function motePositionAt(mote: Mote, nowMs: number): { x: number; y: number } {
  const elapsedSec = Math.max(0, (nowMs - mote.spawnAtMs) / 1000)
  return {
    x: mote.x + mote.vx * elapsedSec,
    y: SPAWN_Y - mote.vy * elapsedSec,
  }
}

/** True while the mote is still on-screen (hasn't drifted off the top) at `nowMs`. */
export function isMoteAlive(mote: Mote, nowMs: number): boolean {
  return motePositionAt(mote, nowMs).y > DESPAWN_Y
}
