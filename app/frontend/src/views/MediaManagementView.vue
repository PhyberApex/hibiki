<script setup lang="ts">
import SoundListManage from '@/components/SoundListManage.vue'
</script>

<template>
  <main class="media-view">
    <h1 class="page-title">
      Media Library
    </h1>
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

.sound-grid {
  display: grid;
  gap: 1.5rem;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
}
</style>
