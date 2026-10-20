<script setup lang="ts">
import { openExternal } from '@/api/electron'
import { useToastStore } from '@/stores/toast'

const toastStore = useToastStore()
</script>

<template>
  <div class="toast-region" role="status" aria-live="polite">
    <div
      v-for="toast in toastStore.toasts"
      :key="toast.id"
      class="toast"
      :class="`toast-${toast.type}`"
    >
      <span class="toast-text">{{ toast.text }}</span>
      <button
        v-if="toast.link"
        type="button"
        class="toast-link"
        @click="openExternal(toast.link.url)"
      >
        {{ toast.link.label }}
      </button>
      <button
        type="button"
        class="toast-dismiss"
        aria-label="Dismiss notification"
        @click="toastStore.dismissByUser(toast.id)"
      >
        ✕
      </button>
    </div>
  </div>
</template>

<style scoped>
.toast-region {
  position: fixed;
  right: 1rem;
  bottom: 1rem;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  max-width: min(24rem, calc(100vw - 2rem));
  pointer-events: none;
}

.toast {
  display: flex;
  align-items: flex-start;
  gap: 0.6rem;
  padding: 0.5rem 0.75rem;
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-border);
  background: var(--color-bg-elevated);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.45);
  font-size: 0.8rem;
  font-weight: 500;
  pointer-events: auto;
  animation: toast-in 0.25s ease-out;
}

.toast-text {
  flex: 1;
  overflow-wrap: anywhere;
}

.toast-success {
  background: var(--color-success-muted);
  border-color: var(--color-success);
  color: var(--color-success);
}

.toast-error {
  background: var(--color-error-muted);
  border-color: var(--color-error);
  color: var(--color-error);
}

.toast-info {
  background: var(--color-bg-elevated);
  border-color: var(--color-border);
  color: var(--color-text);
}

.toast-warning {
  background: var(--color-bg-elevated);
  border-color: #fbbf24;
  color: #fbbf24;
}

.toast-link {
  flex-shrink: 0;
  padding: 0;
  font: inherit;
  font-weight: 600;
  color: var(--color-accent);
  background: transparent;
  border: none;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.toast-link:hover {
  color: var(--color-accent-hover);
}

.toast-dismiss {
  flex-shrink: 0;
  padding: 0;
  font-size: 0.75rem;
  color: inherit;
  opacity: 0.7;
  background: transparent;
  border: none;
  cursor: pointer;
}

.toast-dismiss:hover {
  opacity: 1;
}

@keyframes toast-in {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .toast {
    animation: none;
  }
}
</style>
