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
    <div class="welcome-banner">
      <img src="/banner.png" alt="Hibiki" class="banner-img">
      <div class="banner-overlay" />
    </div>

    <div class="welcome-content">
      <img src="/logo.png" alt="" class="welcome-logo">
      <h1 class="welcome-title">
        Hibiki
      </h1>
      <p class="welcome-tagline">
        Echoes of Adventure. Your private bard bot for Discord.
      </p>
      <button type="button" class="btn-enter" @click.stop="enter">
        Get Started
      </button>
      <span class="welcome-version">v{{ appVersion }}</span>
    </div>
  </div>
</template>

<style scoped>
.welcome {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  background: #0c0c0e;
  position: relative;
  overflow: hidden;
  cursor: pointer;
  user-select: none;
}

.welcome-banner {
  position: absolute;
  inset: 0;
}

.banner-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  opacity: 0.35;
}

.banner-overlay {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    to bottom,
    transparent 30%,
    rgba(12, 12, 14, 0.6) 60%,
    rgba(12, 12, 14, 0.95) 85%
  );
}

.welcome-content {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
  padding: 2rem;
  margin-top: 30vh;
}

.welcome-logo {
  width: 72px;
  height: 72px;
  border-radius: 16px;
  object-fit: contain;
  filter: drop-shadow(0 4px 24px rgba(0, 0, 0, 0.5));
}

.welcome-title {
  font-size: 2.5rem;
  font-weight: 800;
  letter-spacing: -0.03em;
  color: #fff;
  margin: 0;
  text-shadow: 0 2px 16px rgba(0, 0, 0, 0.6);
}

.welcome-tagline {
  font-size: 1.05rem;
  color: rgba(255, 255, 255, 0.7);
  margin: 0;
  text-shadow: 0 1px 8px rgba(0, 0, 0, 0.5);
}

.btn-enter {
  margin-top: 1.5rem;
  padding: 0.7rem 2.5rem;
  font-size: 1rem;
  font-weight: 600;
  color: #0c0c0e;
  background: var(--color-accent, #fbbf24);
  border: none;
  border-radius: 999px;
  cursor: pointer;
  transition: transform 0.15s ease, box-shadow 0.15s ease;
  box-shadow: 0 4px 20px rgba(251, 191, 36, 0.3);
}

.btn-enter:hover {
  transform: scale(1.04);
  box-shadow: 0 6px 28px rgba(251, 191, 36, 0.45);
}

.welcome-version {
  margin-top: 0.5rem;
  font-size: 0.7rem;
  color: rgba(255, 255, 255, 0.3);
}
</style>
