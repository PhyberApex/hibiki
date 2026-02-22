<script setup lang="ts">
import SoundListManage from '@/components/SoundListManage.vue'
</script>

<template>
  <main class="dashboard">
    <header class="page-header">
      <div>
        <p class="eyebrow">
          Library
        </p>
        <h1>Media Management</h1>
      </div>
    </header>
    <p class="page-intro">
      Upload music and effects, add tags, and organize your sound library. Use the control center to play and trigger sounds.
    </p>
    <div class="sound-grid">
      <SoundListManage title="Music" type="music" />
      <SoundListManage title="Effects" type="effects" />
    </div>
  </main>
</template>

<style scoped>
.dashboard {
  display: flex;
  flex-direction: column;
  gap: 2rem;
  max-width: 1000px;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
}

.eyebrow {
  margin: 0;
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--color-text-dim);
}

.page-header h1 {
  margin: 0.2rem 0 0;
  font-size: 1.75rem;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.page-intro {
  margin: 0;
  font-size: 0.95rem;
  color: var(--color-text-muted);
  max-width: 560px;
}

.sound-grid {
  display: grid;
  gap: 1.5rem;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
}
</style>
