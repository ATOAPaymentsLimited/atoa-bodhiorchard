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
 * Lake Fishing — pure game logic for the timing-bar fishing game.
 *
 * Framework-free and shared. The key property that makes this server-ownable:
 * the bobber's position is a DETERMINISTIC function of how long the current
 * cast has been running, so the server can recompute where the bobber really
 * was when a hook arrived and score it itself — the client never reports a
 * score. The server owns the strike-zone position (server-seeded RNG) and the
 * cast clock; the client only renders and sends hook timing.
 */

/** Lives a game starts with; a missed cast (hook outside the zone) costs one. */
export const FISHING_LIVES = 3
/** Casts completed before the difficulty steps up a level. */
export const CASTS_PER_LEVEL = 4
/** Strike-zone width (fraction of the water) at level 1 — shrinks with level. */
export const ZONE_WIDTH = 0.16

/** Sweep speed jitter band: the per-level base is scaled by 0.85×..1.35×. */
const SWEEP_JITTER_MIN = 0.85
const SWEEP_JITTER_SPAN = 0.5
/** Sweep speed ramp: level-1 base, climbing per level, capped so "endless"
 *  never means an unplayably (or un-renderably) fast bobber. */
const SWEEP_RATE_BASE = 0.9
const SWEEP_RATE_PER_LEVEL = 0.22
const SWEEP_RATE_MAX = 3.2
/** Strike-zone shrink ramp: narrows from ZONE_WIDTH toward a floor as the level
 *  climbs, so the target gets meaner (and harder for a slow bot to hit). */
const ZONE_WIDTH_MIN = 0.07
const ZONE_WIDTH_PER_LEVEL = 0.012

/**
 * Base bobber sweep speed (Hz-ish) for a level. Faster each level so the late
 * game outpaces a screenshot-then-click bot; `level` is 1-indexed and the rate
 * is capped so it stays renderable. The live rate is this jittered per cast.
 */
export function sweepRateForLevel(level: number): number {
  return Math.min(SWEEP_RATE_MAX, SWEEP_RATE_BASE + (level - 1) * SWEEP_RATE_PER_LEVEL)
}

/** Strike-zone width for a level — shrinks toward ZONE_WIDTH_MIN as level rises. */
export function zoneWidthForLevel(level: number): number {
  return Math.max(ZONE_WIDTH_MIN, ZONE_WIDTH - (level - 1) * ZONE_WIDTH_PER_LEVEL)
}

/**
 * A cast's actual sweep speed: the level base, jittered, so the bobber moves at
 * a different speed every cast/play. The server picks it (server-seeded) and
 * sends it so the client renders the same curve.
 */
export function randomSweepRate(level: number, rng: () => number = Math.random): number {
  return sweepRateForLevel(level) * (SWEEP_JITTER_MIN + rng() * SWEEP_JITTER_SPAN)
}

/**
 * A cast's starting phase (0..2 — one full sine period in `t`). With it the
 * bobber no longer always opens dead-centre rising: each cast starts at a
 * different point and direction, so the timing can't be memorised play-to-play.
 */
export function randomPhase(rng: () => number = Math.random): number {
  return rng() * 2
}

/**
 * Bobber position (0..1) `elapsedMs` into a cast with sweep speed `sweepRate`
 * and starting `phase`. A sine sweep: `(sin((t + phase)·π) + 1) / 2`, where `t`
 * advances at `sweepRate` per second. Deterministic in its arguments — the same
 * (elapsed, rate, phase) always yields the same position, which is what lets the
 * server validate a hook authoritatively from the params it chose and sent.
 */
export function bobberPositionAt(elapsedMs: number, sweepRate: number, phase: number): number {
  const t = (elapsedMs / 1000) * sweepRate + phase
  return (Math.sin(t * Math.PI) + 1) / 2
}

/**
 * A fresh strike-zone start position (left edge, 0..1) for the next cast.
 * `rng` is injectable so the server (server-seeded) and tests stay deterministic.
 */
export function randomZoneStart(
  rng: () => number = Math.random,
  zoneWidth: number = ZONE_WIDTH,
): number {
  return 0.08 + rng() * (0.84 - zoneWidth)
}

/**
 * Points for a hook: how close the bobber (`marker`) was to the zone centre,
 * relative to the (level-dependent) `zoneWidth`. 10 (bullseye) / 7 / 4 inside
 * the zone, 0 for a miss. Pure — the server calls this with its own recomputed
 * `marker`, `zoneStart`, and `zoneWidth`.
 */
export function scoreForHook(
  marker: number,
  zoneStart: number,
  zoneWidth: number = ZONE_WIDTH,
): number {
  const half = zoneWidth / 2
  const center = zoneStart + half
  const offset = Math.abs(marker - center) / half
  if (offset > 1) return 0
  if (offset < 0.35) return 10
  if (offset < 0.7) return 7
  return 4
}
