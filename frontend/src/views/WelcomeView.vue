<script setup lang="ts">
import { useRouter } from 'vue-router'

declare const __APP_VERSION__: string
const appVersion = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0'
const router = useRouter()

function enter() {
  router.replace('/media')
}
</script>

<template>
  <div class="welcome" @click="enter" @keydown.enter="enter">
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
      Music, ambience and effects for your Discord table.
    </p>

    <button type="button" class="btn-enter" @click.stop="enter">
      Continue
    </button>

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
  cursor: pointer;
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

.btn-enter {
  appearance: none;
  padding: 0.6rem 1.5rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-full);
  background: transparent;
  color: var(--color-text);
  font-size: 0.9rem;
  font-weight: 600;
  transition: border-color var(--transition), background var(--transition);
}

.btn-enter:hover {
  border-color: var(--color-accent);
  background: var(--color-accent-muted);
}

.welcome-version {
  position: absolute;
  bottom: 1.5rem;
  font-size: 0.75rem;
  letter-spacing: 0.02em;
  color: var(--color-text-dim);
}
</style>
