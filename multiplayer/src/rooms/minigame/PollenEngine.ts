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

import {
  MAX_CONCURRENT_MOTES,
  type Mote,
  POLLEN_ESCAPE_BUDGET,
  POLLEN_LIVES,
  isMoteAlive,
  jitteredIntervalMs,
  quotaForLevel,
  spawnMote,
} from "../../../../shared/minigames/pollen"
import type { MinigameEngine, MinigameHost } from "./MinigameEngine"

/** A pop sooner than this after the mote spawned can't be a human seeing and
 *  reacting to it — only a script auto-popping the spawn message. */
const POP_MIN_REACTION_MS = 120
/** Minimum gap between two scored pops (~14/sec ceiling). Humans tap ~6-8/sec;
 *  this only bites a burst-popping script. */
const POP_MIN_GAP_MS = 70

/**
 * Server-authoritative Pollen Pop. The server owns the mote field: it spawns
 * motes (its RNG) and streams them; the client renders but never invents motes.
 * A pop is validated against the server's live set at the server's clock, so a
 * mote that never existed or already drifted off-screen can't be popped — and a
 * pop faster than a human could see/click is dropped as a bot (the mote lives on
 * and just escapes), so auto-popping the spawn stream scores nothing.
 *
 * Levels + lives: clearing a per-level pop quota advances the level (quicker,
 * jittered cadence and faster-rising motes, density still capped), so the late
 * game outpaces a slow bot. A flower that drifts off unpopped eats the level's
 * escape budget; blowing the budget costs a life, and the run ends at zero
 * lives. Score is the total valid pops.
 */
export class PollenEngine implements MinigameEngine {
  private readonly motes = new Map<number, Mote>()
  private nextId = 1
  private score = 0
  private level = 1
  private levelPops = 0
  private escapes = 0
  private lives = POLLEN_LIVES
  private ended = false
  private startMs = 0
  private lastSpawnMs = 0
  private lastPopMs = Number.NEGATIVE_INFINITY

  constructor(
    private readonly rng: () => number = Math.random,
    private readonly now: () => number = () => Date.now(),
  ) {}

  start(host: MinigameHost): void {
    this.startMs = this.now()
    this.lastSpawnMs = this.startMs
    this.score = 0
    this.level = 1
    this.levelPops = 0
    this.escapes = 0
    this.lives = POLLEN_LIVES
    this.lastPopMs = Number.NEGATIVE_INFINITY
    this.ended = false
    host.state.round = this.level
    host.state.lives = this.lives
    host.notify("pollen_start", {
      level: this.level,
      lives: this.lives,
      quota: quotaForLevel(this.level),
    })
  }

  tick(host: MinigameHost, nowMs: number): void {
    if (this.ended) return
    // Reap dead motes first: each escape eats into the level's budget, and
    // blowing the budget costs a life. Out of lives ends the run. Reaping
    // before spawning also lets the concurrency cap below see freed slots.
    for (const [id, mote] of this.motes) {
      if (isMoteAlive(mote, nowMs)) continue
      this.motes.delete(id)
      this.escapes += 1
      // Tell the client this was an escape and how full the level's miss meter
      // now is, so it can show the danger building toward a lost life.
      host.notify("pollen_despawn", { id, escapes: this.escapes, budget: POLLEN_ESCAPE_BUDGET })
      if (this.escapes >= POLLEN_ESCAPE_BUDGET) {
        this.escapes = 0
        this.lives -= 1
        host.state.lives = this.lives
        host.notify("pollen_life", { lives: this.lives })
        if (this.lives <= 0) {
          this.ended = true
          host.finish()
          return
        }
      }
    }
    // Spawn on the level cadence (jittered), capped so the arena can't flood.
    for (;;) {
      const interval = jitteredIntervalMs(this.level, this.rng)
      if (nowMs - this.lastSpawnMs < interval) break
      this.lastSpawnMs += interval
      if (this.motes.size >= MAX_CONCURRENT_MOTES) continue
      const mote = spawnMote(this.nextId++, nowMs, this.rng, this.level)
      this.motes.set(mote.id, mote)
      host.notify("pollen_spawn", mote)
    }
  }

  input(host: MinigameHost, type: string, payload: unknown): void {
    if (this.ended || type !== "pop") return
    const id = readId(payload)
    if (id === null) return
    const now = this.now()
    const mote = this.motes.get(id)
    if (!mote || !isMoteAlive(mote, now)) return
    // Plausibility guards: a pop sooner than a human could see and react to the
    // mote, or faster than a human can click, is a bot — drop it. The mote stays
    // live (and just escapes), so auto-popping the spawn stream earns nothing.
    if (now - mote.spawnAtMs < POP_MIN_REACTION_MS) return
    if (now - this.lastPopMs < POP_MIN_GAP_MS) return
    this.lastPopMs = now
    this.motes.delete(id)
    this.score += 1
    this.levelPops += 1
    host.state.score = this.score
    host.notify("pollen_popped", { id, score: this.score })
    // Clearing the quota advances the level: faster, with a fresh escape budget.
    if (this.levelPops >= quotaForLevel(this.level)) {
      this.level += 1
      this.levelPops = 0
      this.escapes = 0
      host.state.round = this.level
      host.notify("pollen_levelup", { level: this.level, quota: quotaForLevel(this.level) })
    }
  }

  finalScore(): number {
    return this.score
  }
}

function readId(payload: unknown): number | null {
  if (typeof payload !== "object" || payload === null) return null
  const id = (payload as { id?: unknown }).id
  return typeof id === "number" && Number.isInteger(id) ? id : null
}
