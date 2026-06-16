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
  CASTS_PER_LEVEL,
  FISHING_LIVES,
  bobberPositionAt,
  randomPhase,
  randomSweepRate,
  randomZoneStart,
  scoreForHook,
  zoneWidthForLevel,
} from "../../../../shared/minigames/fishing"
import type { MinigameEngine, MinigameHost } from "./MinigameEngine"

/** Clamp ceiling for server-measured cast elapsed — a stalled tab can't run the
 *  bobber phase off to a wild value. */
const MAX_CAST_MS = 20000
/** Pause after a hook so the client can show the catch/miss feedback before the
 *  next cast begins (the next `fishing_cast` is what clears it). */
const RESULT_PAUSE_MS = 700
/** How far the client's reported in-cast time may diverge from the server's own
 *  measure before we stop trusting it. Wide enough to absorb real network
 *  latency (the #261 fairness fix), tight enough that a bot can't wait and then
 *  claim a perfect past time — it must hook in real time. */
const LATENCY_GRACE_MS = 400

/**
 * Server-authoritative Lake Fishing. The server owns the strike zone (its RNG)
 * and the cast clock. A hook carries no score: the server recomputes where the
 * bobber really was and scores it. It trusts the client's in-cast timing only
 * within a latency grace (so lag never punishes a correct tap) and otherwise
 * falls back to its own clock — so a bot can't bank a perfect time and replay it.
 *
 * Endless + lives: casting continues until lives run out. A missed hook (0 pts)
 * costs a life; every CASTS_PER_LEVEL casts the level steps up, speeding the
 * sweep and narrowing the zone — so the late game outpaces a slow bot.
 */
export class FishingEngine implements MinigameEngine {
  private level = 1
  private castInLevel = 0
  private lives = FISHING_LIVES
  private score = 0
  private zoneStart = 0
  private zoneWidth = 0
  private sweepRate = 0
  private phase = 0
  private castStartMs = 0
  /** True only while a cast is live — rejects stray hooks during the inter-cast
   *  pause (and any malicious double-hook). */
  private canHook = false

  constructor(
    private readonly rng: () => number = Math.random,
    private readonly now: () => number = () => Date.now(),
  ) {}

  start(host: MinigameHost): void {
    this.level = 1
    this.castInLevel = 0
    this.lives = FISHING_LIVES
    this.score = 0
    this.beginCast(host)
  }

  input(host: MinigameHost, type: string, payload: unknown): void {
    if (type !== "hook" || !this.canHook) return
    this.canHook = false
    // Bind the reported in-cast time to when the hook actually ARRIVED. We trust
    // the client's own timing only when it's within LATENCY_GRACE_MS of the
    // server's measure — so real latency doesn't shift the bobber out from under
    // a correct tap (the #261 fix) — but a time that disagrees is dropped for the
    // server's own. That stops a bot from waiting and then claiming a perfect
    // past time: to land a bullseye it has to hook in real time. The score is
    // still computed here from the deterministic curve, never reported.
    const serverElapsed = Math.max(0, this.now() - this.castStartMs)
    const reported = readElapsed(payload)
    const consistent = reported !== null && Math.abs(reported - serverElapsed) <= LATENCY_GRACE_MS
    const elapsed = Math.min(MAX_CAST_MS, consistent ? Math.max(0, reported) : serverElapsed)
    const marker = bobberPositionAt(elapsed, this.sweepRate, this.phase)
    const points = scoreForHook(marker, this.zoneStart, this.zoneWidth)
    this.score += points
    if (points === 0) this.lives -= 1
    host.state.score = this.score
    host.state.lives = this.lives
    host.notify("fishing_result", { points, marker, level: this.level, lives: this.lives })

    // Hold the result on screen before advancing (or finishing), so the catch
    // feedback is visible — the server paces this, not the client.
    if (this.lives <= 0) {
      host.scheduleAfter(RESULT_PAUSE_MS, () => host.finish())
      return
    }
    // Every CASTS_PER_LEVEL casts steps the difficulty up a level.
    this.castInLevel += 1
    if (this.castInLevel >= CASTS_PER_LEVEL) {
      this.level += 1
      this.castInLevel = 0
    }
    host.scheduleAfter(RESULT_PAUSE_MS, () => this.beginCast(host))
  }

  finalScore(): number {
    return this.score
  }

  private beginCast(host: MinigameHost): void {
    this.zoneWidth = zoneWidthForLevel(this.level)
    this.zoneStart = randomZoneStart(this.rng, this.zoneWidth)
    this.sweepRate = randomSweepRate(this.level, this.rng)
    this.phase = randomPhase(this.rng)
    this.castStartMs = this.now()
    this.canHook = true
    host.state.round = this.level
    host.state.lives = this.lives
    host.notify("fishing_cast", {
      zoneStart: this.zoneStart,
      zoneWidth: this.zoneWidth,
      sweepRate: this.sweepRate,
      phase: this.phase,
      level: this.level,
      lives: this.lives,
    })
  }
}

/** Read the client's in-cast elapsed (ms), or null if absent/invalid. */
function readElapsed(payload: unknown): number | null {
  if (typeof payload !== "object" || payload === null) return null
  const v = (payload as { elapsedMs?: unknown }).elapsedMs
  return typeof v === "number" && Number.isFinite(v) ? v : null
}
