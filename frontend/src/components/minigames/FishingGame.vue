<!--
  Copyright 2025-2026 Arun Rajkumar

  Licensed under the Apache License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License.
  You may obtain a copy of the License at

      http://www.apache.org/licenses/LICENSE-2.0

  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  See the License for the specific language governing permissions and
  limitations under the License.

  FishingGame — timing-bar fishing at the forest lake.

  Endless casts on three lives: the bobber sweeps the water, hook inside the
  green strike zone (closer to centre = more points). Miss the zone and you lose
  a life; every few casts the level steps up — faster sweep, smaller zone.
-->
<template>
  <div class="fishing d-flex flex-column ga-3">
    <div class="d-flex align-center justify-space-between">
      <div class="fishing__hud">
        <span class="fishing__level">Lv {{ level }}</span>
        <span class="fishing__lives">
          <span
            v-for="n in FISHING_LIVES"
            :key="n"
            class="fishing__heart"
            :class="{ 'fishing__heart--lost': n > lives }"
          >❤️</span>
        </span>
      </div>
      <span class="fishing__score">{{ score }} <small>pts</small></span>
    </div>

    <!-- Water -->
    <div class="fishing__water" @pointerdown="hook">
      <div class="fishing__waves" />
      <div
        class="fishing__zone"
        :style="{ left: `${zoneStart * 100}%`, width: `${zoneWidth * 100}%` }"
      />
      <div class="fishing__bobber" :style="{ left: `${marker * 100}%` }">
        <span class="fishing__bobber-emoji">🐟</span>
      </div>
      <transition name="catch-pop">
        <div v-if="flash" :key="flash.id" class="fishing__flash" :class="`fishing__flash--${flash.kind}`">
          {{ flash.text }}
        </div>
      </transition>
    </div>

    <div class="text-caption text-medium-emphasis text-center" style="min-height: 18px">
      {{ message }}
    </div>

    <v-btn
      v-if="!done"
      color="primary"
      rounded="lg"
      size="large"
      block
      @pointerdown.stop="hook"
    >
      Hook it!
    </v-btn>
    <v-btn v-else color="success" rounded="lg" size="large" block @click="collect">
      Collect {{ score }} points
    </v-btn>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { FISHING_LIVES, ZONE_WIDTH, bobberPositionAt, scoreForHook } from '@shared/minigames/fishing'
import type { MinigameResult } from '@/multiplayer/MinigameRoomClient'
import { useMinigameRoom } from './useMinigameRoom'

const emit = defineEmits<{ finished: [result: MinigameResult | null] }>()

const marker = ref(0.5) // bobber position 0..1 — client-rendered for display
const zoneStart = ref(0.42) // server-chosen strike-zone start
const zoneWidth = ref(ZONE_WIDTH) // server-chosen zone width (narrows with level)
const message = ref('Tap when the fish swims over the bright water!')
const flash = ref<{ id: number; text: string; kind: 'hit' | 'miss' } | null>(null)
const result = ref<MinigameResult | null>(null)

const room = useMinigameRoom('fishing', { onEvent, onResult }, { startingLives: FISHING_LIVES })
const score = room.score // authoritative running score
const level = computed(() => room.round.value || 1) // server level (state.round)
const lives = room.lives // authoritative lives remaining
const done = computed(() => room.status.value === 'finished')

let raf = 0
let castStart = 0
let sweepRate = 0 // server-chosen sweep speed for this cast
let phase = 0 // server-chosen starting phase for this cast
let sweeping = false
let flashId = 0
let lastLevel = 1 // tracks level changes so the level-up banner fires once
// Points shown optimistically for the current cast (−1 = none yet), so the
// server's authoritative result reconciles without a redundant second flash.
let shownPoints = -1

// Render the bobber from the SAME deterministic curve the server scores with,
// timed from when this cast was received. The server uses its own clock when a
// hook arrives, so the score is authoritative; this is display only.
function loop(now: number): void {
  if (sweeping) marker.value = bobberPositionAt(now - castStart, sweepRate, phase)
  raf = requestAnimationFrame(loop)
}

function showResult(points: number): void {
  if (points > 0) {
    flash.value = {
      id: ++flashId,
      text: points === 10 ? '🐠 +10!' : `🐟 +${points}`,
      kind: 'hit',
    }
    message.value = points === 10 ? 'Perfect catch!' : 'Got one!'
  } else {
    flash.value = { id: ++flashId, text: '💔 missed', kind: 'miss' }
    message.value = 'It got away…'
  }
}

function onEvent(type: string, payload: unknown): void {
  if (type === 'fishing_cast') {
    const p = payload as {
      zoneStart: number
      zoneWidth: number
      sweepRate: number
      phase: number
      level: number
    }
    zoneStart.value = p.zoneStart
    zoneWidth.value = p.zoneWidth
    sweepRate = p.sweepRate
    phase = p.phase
    castStart = performance.now()
    sweeping = true
    shownPoints = -1
    // A new level shows its own banner; otherwise clear the last result flash.
    if (p.level > lastLevel) {
      lastLevel = p.level
      flash.value = { id: ++flashId, text: `⬆ Level ${p.level}`, kind: 'hit' }
      message.value = `Level ${p.level} — faster sweep, tighter zone!`
    } else {
      flash.value = null
    }
  } else if (type === 'fishing_result') {
    // Authoritative result. It normally equals what we already showed (the
    // server scores from our reported in-cast time), so only re-render on a
    // rare mismatch — and never snap the bobber, which caused a visible jump.
    const p = payload as { points: number }
    if (p.points !== shownPoints) {
      shownPoints = p.points
      showResult(p.points)
    }
  }
}

function onResult(r: MinigameResult): void {
  result.value = r
  sweeping = false
  message.value = `Final score: ${r.score}`
}

function hook(): void {
  if (!sweeping || done.value) return
  sweeping = false
  // Score from the SAME instant we report to the server — not the last rendered
  // frame, which can be ~16ms stale and flip the band (e.g. +10 vs +7). Freezing
  // the bobber at this exact position keeps the optimistic result matching the
  // authoritative one, so fishing_result never has to correct it.
  const elapsedMs = performance.now() - castStart
  marker.value = bobberPositionAt(elapsedMs, sweepRate, phase)
  shownPoints = scoreForHook(marker.value, zoneStart.value, zoneWidth.value)
  showResult(shownPoints)
  room.send('hook', { elapsedMs })
}

function collect(): void {
  emit('finished', result.value)
}

onMounted(() => {
  raf = requestAnimationFrame(loop)
})
onUnmounted(() => cancelAnimationFrame(raf))
</script>

<style scoped>
.fishing__hud {
  display: flex;
  align-items: center;
  gap: 10px;
}
.fishing__level {
  font-size: 13px;
  font-weight: 800;
  padding: 2px 9px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.12);
  letter-spacing: 0.03em;
}
.fishing__lives {
  display: flex;
  gap: 2px;
  font-size: 14px;
}
.fishing__heart--lost {
  opacity: 0.25;
  filter: grayscale(1);
}
.fishing__score {
  font-size: 20px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}
.fishing__water {
  position: relative;
  /* Taps stay taps — don't let a touch-drag here pan/scroll the garden behind. */
  touch-action: none;
  width: 100%;
  height: 84px;
  border-radius: 16px;
  background: linear-gradient(180deg, #67c4ea 0%, #2e85c4 55%, #1b5e96 100%);
  overflow: hidden;
  cursor: pointer;
  user-select: none;
  box-shadow: inset 0 4px 14px rgba(0, 0, 0, 0.25);
}
.fishing__waves {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(ellipse 60px 8px at 20% 30%, rgba(255, 255, 255, 0.25), transparent 70%),
    radial-gradient(ellipse 80px 9px at 65% 55%, rgba(255, 255, 255, 0.18), transparent 70%),
    radial-gradient(ellipse 50px 7px at 85% 25%, rgba(255, 255, 255, 0.2), transparent 70%);
  animation: waves-drift 5s linear infinite;
}
@keyframes waves-drift {
  from { background-position: 0 0, 0 0, 0 0; }
  to { background-position: 120px 0, -90px 0, 70px 0; }
}
.fishing__zone {
  position: absolute;
  top: 0;
  height: 100%;
  background: linear-gradient(180deg, rgba(140, 240, 180, 0.85), rgba(70, 200, 130, 0.55));
  border-radius: 10px;
  box-shadow: 0 0 16px rgba(120, 240, 170, 0.5);
}
.fishing__bobber {
  position: absolute;
  top: 50%;
  transform: translate(-50%, -50%);
  pointer-events: none;
}
.fishing__bobber-emoji {
  display: inline-block;
  font-size: 30px;
  filter: drop-shadow(0 3px 5px rgba(0, 0, 0, 0.4));
  animation: bob 1.1s ease-in-out infinite;
}
@keyframes bob {
  0%, 100% { transform: translateY(-3px); }
  50% { transform: translateY(3px); }
}
.fishing__flash {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  font-size: 20px;
  font-weight: 800;
  padding: 4px 14px;
  border-radius: 999px;
  pointer-events: none;
}
.fishing__flash--hit {
  background: rgba(76, 175, 80, 0.9);
  color: #fff;
}
.fishing__flash--miss {
  background: rgba(0, 0, 0, 0.55);
  color: #cfe9ff;
}
.catch-pop-enter-active {
  animation: catch-pop-in 0.35s ease-out;
}
@keyframes catch-pop-in {
  0% { transform: translate(-50%, -30%) scale(0.6); opacity: 0; }
  100% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
}
</style>
