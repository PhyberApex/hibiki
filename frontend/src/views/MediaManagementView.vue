<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { fetchDiscordConfig } from '@/api/config'
import SoundListManage from '@/components/SoundListManage.vue'
import { usePlayerStore } from '@/stores/player'

const player = usePlayerStore()
const tokenConfigured = ref<boolean | null>(null)

onMounted(async () => {
  try {
    const config = await fetchDiscordConfig()
    tokenConfigured.value = config.tokenConfigured
  }
  catch {
    tokenConfigured.value = false
  }
})

const showSetupGuide = computed(() => !player.botStatus?.ready && tokenConfigured.value === false)
const showConnecting = computed(() => !player.botStatus?.ready && tokenConfigured.value !== false)
</script>

<template>
  <main class="media-view">
    <h1 class="page-title">
      Sound library
    </h1>
    <p class="page-subtitle">
      Add audio files here, then combine them into scenes to play during your session.
    </p>

    <section v-if="showConnecting" class="setup-guide setup-guide-connecting">
      <p class="connecting-message">
        Connecting to Discord…
      </p>
    </section>

    <section v-else-if="showSetupGuide" class="setup-guide">
      <h2 class="setup-guide-title">
        Get started
      </h2>
      <ol class="setup-steps">
        <li class="setup-step">
          <span class="step-number">1</span>
          <div class="step-content">
            <RouterLink to="/settings" class="step-link">
              Add your Discord bot token
            </RouterLink>
            so Hibiki can join voice channels.
          </div>
        </li>
        <li class="setup-step">
          <span class="step-number">2</span>
          <div class="step-content">
            Upload sounds below — drag files onto a panel or click + Add.
          </div>
        </li>
        <li class="setup-step">
          <span class="step-number">3</span>
          <div class="step-content">
            Build a
            <RouterLink to="/scenes" class="step-link">
              Scene
            </RouterLink>
            — combine sounds into a soundboard you can play in Discord.
          </div>
        </li>
      </ol>
      <p class="setup-shortcut">
        Want to skip setup?
        <RouterLink to="/scenes" class="step-link">
          Browse community scenes
        </RouterLink>
        — they include sounds and are ready to play.
      </p>
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
}

/* ── Page intro: tight unit ── */

.page-title {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.page-subtitle {
  margin: 0.25rem 0 0;
  font-size: 0.9rem;
  color: var(--color-text-muted);
  line-height: 1.4;
}

/* ── Setup guide ── */

.setup-guide {
  margin-top: 1.5rem;
  background: var(--color-bg-card);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  padding: 1.25rem 1.5rem;
  animation: fade-in 0.25s ease-out;
}

.setup-guide-connecting {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 4rem;
}

.connecting-message {
  margin: 0;
  font-size: 0.95rem;
  color: var(--color-text-muted);
}

.setup-guide-title {
  margin: 0 0 0.75rem;
  font-size: 1rem;
  font-weight: 600;
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
  color: var(--color-text-muted);
}

.step-link {
  color: var(--color-accent);
  text-decoration: none;
}

.step-link:hover {
  text-decoration: underline;
}

.setup-shortcut {
  margin: 1rem 0 0;
  padding-top: 0.75rem;
  border-top: 1px solid var(--color-border);
  font-size: 0.85rem;
  color: var(--color-text-dim);
}

/* ── Sound grid ── */

.sound-grid {
  display: grid;
  gap: 1rem;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  margin-top: 2rem;
}

/* Cap at 3 columns — one per category, never wider */
@media (min-width: 840px) {
  .sound-grid {
    grid-template-columns: repeat(3, 1fr);
  }
}

/* Stacked layout: tighter spacing, shorter lists */
@media (max-width: 560px) {
  .sound-grid {
    gap: 0.75rem;
    margin-top: 1.5rem;
  }

  .page-subtitle {
    font-size: 0.85rem;
  }
}
</style>
