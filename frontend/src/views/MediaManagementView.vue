<script setup lang="ts">
import { RouterLink } from 'vue-router'
import SoundListManage from '@/components/SoundListManage.vue'
import { usePlayerStore } from '@/stores/player'

const player = usePlayerStore()
</script>

<template>
  <main class="media-view">
    <h1 class="page-title">
      Media Library
    </h1>

    <section v-if="!player.botStatus?.ready" class="setup-guide">
      <h2 class="setup-guide-title">
        Getting started
      </h2>
      <p class="setup-guide-desc">
        Set up Hibiki in three steps and you'll be playing audio in Discord in no time.
      </p>
      <ol class="setup-steps">
        <li class="setup-step">
          <span class="step-number">1</span>
          <div class="step-content">
            <strong>Connect your Discord bot</strong>
            <p>
              Go to
              <RouterLink to="/settings" class="step-link">
                Settings
              </RouterLink>
              and paste your bot token.
            </p>
          </div>
        </li>
        <li class="setup-step">
          <span class="step-number">2</span>
          <div class="step-content">
            <strong>Upload some sounds</strong>
            <p>Add music, ambience, or effects below — drag files or click Add.</p>
          </div>
        </li>
        <li class="setup-step">
          <span class="step-number">3</span>
          <div class="step-content">
            <strong>Build a scene</strong>
            <p>
              Head to
              <RouterLink to="/scenes" class="step-link">
                Scenes
              </RouterLink>
              to create a soundboard for your session.
            </p>
          </div>
        </li>
      </ol>
    </section>

    <div class="sound-grid">
      <SoundListManage title="Music" type="music" />
      <SoundListManage title="Ambience" type="ambience" />
      <SoundListManage title="Effects" type="effects" />
    </div>
  </main>
</template>

<style scoped>
.media-view {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.page-title {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.setup-guide {
  background: var(--color-bg-card);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  padding: 1.25rem 1.5rem;
  animation: fade-in 0.25s ease-out;
}

.setup-guide-title {
  margin: 0 0 0.25rem;
  font-size: 1rem;
  font-weight: 600;
}

.setup-guide-desc {
  margin: 0 0 1rem;
  font-size: 0.9rem;
  color: var(--color-text-muted);
}

.setup-steps {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.setup-step {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
}

.step-number {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 1.75rem;
  height: 1.75rem;
  flex-shrink: 0;
  border-radius: var(--radius-full);
  background: var(--color-accent-muted);
  color: var(--color-accent);
  font-size: 0.8rem;
  font-weight: 600;
}

.step-content {
  font-size: 0.9rem;
  line-height: 1.5;
}

.step-content strong {
  color: var(--color-text);
}

.step-content p {
  margin: 0.15rem 0 0;
  color: var(--color-text-muted);
}

.step-link {
  color: var(--color-accent);
  text-decoration: none;
}

.step-link:hover {
  text-decoration: underline;
}

.sound-grid {
  display: grid;
  gap: 1.5rem;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
}
</style>
