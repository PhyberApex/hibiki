<script setup lang="ts">
import { RouterView } from 'vue-router'
</script>

<template>
  <div class="layout">
    <aside class="sidebar">
      <div class="brand">
        <span class="brand-icon">響</span>
        <div>
          <h1 class="brand-title">Hibiki</h1>
          <p class="brand-subtitle">Discord DJ</p>
        </div>
      </div>
      <nav class="nav-hint">Control center</nav>
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
  background: var(--color-bg);
}

.sidebar {
  width: 260px;
  padding: 1.75rem 1.5rem;
  background: var(--color-bg-elevated);
  border-right: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
  gap: 2rem;
}

.brand {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.brand-icon {
  width: 44px;
  height: 44px;
  border-radius: var(--radius-md);
  background: var(--color-accent-muted);
  color: var(--color-accent);
  font-size: 1.5rem;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
}

.brand-title {
  margin: 0;
  font-size: 1.35rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--color-text);
}

.brand-subtitle {
  margin: 0.15rem 0 0;
  font-size: 0.8rem;
  color: var(--color-text-muted);
}

.nav-hint {
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--color-text-dim);
}

.content {
  flex: 1;
  padding: 2rem;
  overflow: auto;
}

@media (max-width: 768px) {
  .layout {
    flex-direction: column;
  }
  .sidebar {
    width: 100%;
    border-right: none;
    border-bottom: 1px solid var(--color-border);
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
  }
  .nav-hint {
    display: none;
  }
  .content {
    padding: 1.25rem;
  }
}
</style>
