<script setup lang="ts">
import { RouterLink } from 'vue-router'

declare const __APP_VERSION__: string
const appVersion = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0'

const repoUrl = 'https://github.com/PhyberApex/hibiki'
</script>

<template>
  <main class="about">
    <h1 class="about-title">
      Hibiki
    </h1>
    <p class="about-tagline">
      Your private bard bot for Discord — music, ambience, and sound effects in voice channels.
    </p>
    <p class="about-desc">
      Built for tabletop sessions and streaming. Create scenes, stream browser audio, or trigger one-shot effects from the desktop app.
    </p>
    <p class="about-version">
      Version {{ appVersion }}
    </p>
    <a
      :href="repoUrl"
      target="_blank"
      rel="noopener noreferrer"
      class="about-link"
    >
      GitHub
    </a>
  </main>
</template>

<style scoped>
.about {
  max-width: 28rem;
  padding: 2rem 1.5rem;
}

.about-title {
  margin: 0 0 0.5rem;
  font-size: 1.5rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--color-text);
}

.about-tagline {
  margin: 0 0 1rem;
  font-size: 1rem;
  font-weight: 500;
  color: var(--color-text-muted);
  line-height: 1.5;
}

.about-desc {
  margin: 0 0 1.5rem;
  font-size: 0.9rem;
  color: var(--color-text-muted);
  line-height: 1.6;
}

.about-version {
  margin: 0 0 1.5rem;
  font-size: 0.8rem;
  color: var(--color-text-dim);
}
</style>
