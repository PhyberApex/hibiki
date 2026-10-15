<script setup lang="ts">
import { useRouter } from 'vue-router'
import { fetchDiscordConfig } from '@/api/config'
import { logInfo } from '@/audio/audio-element-diagnostics'
import { usePlayerStore } from '@/stores/player'

declare const __APP_VERSION__: string
const appVersion = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0'
const router = useRouter()
const player = usePlayerStore()

async function playAtTheTable() {
  logInfo('[welcome] onboarding path chosen: local (play at the table)')
  await player.setActiveTarget('local')
  router.replace('/scenes')
}

async function playInDiscord() {
  logInfo('[welcome] onboarding path chosen: discord')
  await player.setActiveTarget('discord')
  let tokenConfigured = false
  try {
    tokenConfigured = (await fetchDiscordConfig()).tokenConfigured
  }
  catch (err) {
    console.warn('[welcome] could not read the Discord config:', err)
  }
  router.replace(tokenConfigured ? '/scenes' : '/settings')
}
</script>

<template>
  <div class="welcome">
    <h1 class="welcome-title">
      Hibiki
    </h1>

    <svg class="welcome-wave" viewBox="0 0 260 36" aria-hidden="true">
      <path class="wave-base" d="M0 18 H260" />
      <path
        class="wave-line"
        d="M0 18 C 20 18 25 6 40 6 S 60 30 80 30 S 100 10 120 10 S 140 26 160 26 S 180 12 200 12 S 220 22 240 22 S 255 18 260 18"
      />
    </svg>

    <p class="welcome-tagline">
      Music, ambience and effects for your table.
    </p>

    <div class="welcome-paths">
      <button type="button" class="btn-path btn-path-local" @click="playAtTheTable">
        <span class="path-title">Play at the table</span>
        <span class="path-desc">Play through this computer's speakers. No setup needed.</span>
      </button>
      <button type="button" class="btn-path btn-path-discord" @click="playInDiscord">
        <span class="path-title">Play in Discord</span>
        <span class="path-desc">Play into a voice channel with your own bot token.</span>
      </button>
    </div>

    <span class="welcome-version">v{{ appVersion }}</span>
  </div>
</template>

<style scoped>
.welcome {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2.25rem;
  min-height: 100vh;
  padding: 3rem;
  background: var(--color-bg);
  user-select: none;
}

.welcome-title {
  margin: 0;
  font-size: 2.75rem;
  font-weight: 700;
  letter-spacing: -0.03em;
  line-height: 1;
  color: var(--color-text);
}

.welcome-wave {
  display: block;
  width: 260px;
  height: 36px;
  overflow: visible;
}

.welcome-wave path {
  fill: none;
  stroke-width: 1.5;
  stroke-linecap: round;
}

.wave-base {
  stroke: var(--color-border);
}

.wave-line {
  stroke: var(--color-accent);
  stroke-dasharray: 420;
  stroke-dashoffset: 420;
  animation: wave-draw 1.1s cubic-bezier(0.16, 1, 0.3, 1) 0.15s forwards;
}

@keyframes wave-draw {
  to {
    stroke-dashoffset: 0;
  }
}

.welcome-tagline {
  margin: 0;
  font-size: 0.95rem;
  color: var(--color-text-muted);
  text-align: center;
}

.welcome-paths {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 1rem;
}

.btn-path {
  appearance: none;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  width: 15rem;
  padding: 1rem 1.25rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg, 12px);
  background: transparent;
  color: var(--color-text);
  text-align: left;
  cursor: pointer;
  transition: border-color var(--transition), background var(--transition);
}

.btn-path:hover,
.btn-path:focus-visible {
  border-color: var(--color-accent);
  background: var(--color-accent-muted);
}

.path-title {
  font-size: 0.95rem;
  font-weight: 600;
}

.path-desc {
  font-size: 0.8rem;
  color: var(--color-text-muted);
}

.welcome-version {
  position: absolute;
  bottom: 1.5rem;
  font-size: 0.75rem;
  letter-spacing: 0.02em;
  color: var(--color-text-dim);
}
</style>
