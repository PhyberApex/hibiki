<script setup lang="ts">
import { RouterView } from 'vue-router'
</script>

<template>
  <div class="layout">
    <aside class="sidebar">
      <h1>Hibiki</h1>
      <p class="subtitle">Discord DJ companion</p>
    </aside>
    <section class="content">
      <RouterView />
    </section>
  </div>
</template>

<style scoped>
.layout {
  display: flex;
  min-height: 100vh;
  background: var(--color-background-soft);
}

.sidebar {
  width: 240px;
  padding: 2rem;
  background: radial-gradient(circle at top, #5a7bff, #3b3b98);
  color: #fff;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.sidebar h1 {
  margin: 0;
  font-size: 1.8rem;
}

.subtitle {
  opacity: 0.85;
}

.content {
  flex: 1;
  padding: 2rem;
}

@media (max-width: 768px) {
  .layout {
    flex-direction: column;
  }
  .sidebar {
    width: 100%;
  }
}
</style>
