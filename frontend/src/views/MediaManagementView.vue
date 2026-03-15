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
      Upload and manage music, ambience, and sound effects for your scenes.
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
            Open
            <RouterLink to="/settings" class="step-link">
              Settings
            </RouterLink>
            and paste your Discord bot token so Hibiki can join your server.
          </div>
        </li>
        <li class="setup-step">
          <span class="step-number">2</span>
          <div class="step-content">
            Upload sounds below: drag files onto a panel or click + Add. Use Music for tracks, Ambience for loops, Effects for one-shots.
          </div>
        </li>
        <li class="setup-step">
          <span class="step-number">3</span>
          <div class="step-content">
            Go to
            <RouterLink to="/scenes" class="step-link">
              Scenes
            </RouterLink>
            to build a soundboard — mix music, ambience, and effects, then stream to a voice channel.
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

.page-subtitle {
  margin: 0;
  font-size: 0.9rem;
  color: var(--color-text-muted);
  line-height: 1.4;
}

.setup-guide {
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

.sound-grid {
  display: grid;
  gap: 1.5rem;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
}
</style>
