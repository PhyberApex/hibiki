<script setup lang="ts">
import type { AllowlistConfig } from '@/api/permissions'
import { onMounted, ref } from 'vue'
import {
  fetchPermissionsConfig,
  updatePermissionsConfig,
} from '@/api/permissions'

const config = ref<AllowlistConfig>({
  allowedDiscordRoleIds: [],
  allowedDiscordUserIds: [],
})
const loading = ref(true)
const saving = ref(false)
const error = ref<string | null>(null)
const toast = ref<string | null>(null)

// One trailing empty row per list for adding new IDs.
const roleIdInputs = ref<string[]>([])
const userIdInputs = ref<string[]>([])

function addRoleRow() {
  roleIdInputs.value.push('')
}

function removeRoleRow(i: number) {
  roleIdInputs.value.splice(i, 1)
}

function addUserRow() {
  userIdInputs.value.push('')
}

function removeUserRow(i: number) {
  userIdInputs.value.splice(i, 1)
}

function buildConfig(): AllowlistConfig {
  const allowedDiscordRoleIds = roleIdInputs.value
    .map(s => s.trim())
    .filter(Boolean)
  const allowedDiscordUserIds = userIdInputs.value
    .map(s => s.trim())
    .filter(Boolean)
  return { allowedDiscordRoleIds, allowedDiscordUserIds }
}

async function load() {
  loading.value = true
  error.value = null
  try {
    const res = await fetchPermissionsConfig()
    config.value = res
    roleIdInputs.value
      = res.allowedDiscordRoleIds.length > 0
        ? [...res.allowedDiscordRoleIds]
        : ['']
    userIdInputs.value
      = res.allowedDiscordUserIds.length > 0
        ? [...res.allowedDiscordUserIds]
        : ['']
  }
  catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load'
  }
  finally {
    loading.value = false
  }
}

async function save() {
  saving.value = true
  error.value = null
  toast.value = null
  try {
    const newConfig = buildConfig()
    await updatePermissionsConfig(newConfig)
    config.value = newConfig
    toast.value = 'Saved. Empty list = no one can use the bot until you add role or user IDs.'
    setTimeout(() => {
      toast.value = null
    }, 4000)
  }
  catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to save'
  }
  finally {
    saving.value = false
  }
}

onMounted(() => load())
</script>

<template>
  <main class="permissions-page">
    <header class="page-header">
      <div>
        <p class="eyebrow">
          Settings
        </p>
        <h1>Who can use the bot</h1>
      </div>
      <div class="header-actions">
        <button
          type="button"
          class="btn btn-ghost"
          :disabled="loading"
          @click="load"
        >
          {{ loading ? 'Loading…' : 'Refresh' }}
        </button>
        <button
          type="button"
          class="btn btn-primary"
          :disabled="loading || saving"
          @click="save"
        >
          {{ saving ? 'Saving…' : 'Save' }}
        </button>
      </div>
    </header>

    <p v-if="toast" class="toast toast-success">
      {{ toast }}
    </p>
    <p v-if="error" class="toast toast-error">
      {{ error }}
    </p>

    <p v-if="loading" class="panel-message">
      Loading…
    </p>

    <template v-else>
      <section class="panel">
        <h2 class="panel-header">
          Allowed Discord role IDs
        </h2>
        <p class="panel-desc">
          Users with any of these roles can use the bot. Get role IDs from Discord (Developer Mode → right‑click role → Copy ID). If both lists are empty, no one can use the bot.
        </p>
        <ul class="id-list">
          <li v-for="(id, i) in roleIdInputs" :key="`role-${i}`" class="id-row">
            <input
              v-model="roleIdInputs[i]"
              type="text"
              class="input"
              placeholder="e.g. 123456789"
            >
            <button
              type="button"
              class="btn btn-ghost btn-sm btn-icon"
              title="Remove"
              @click="removeRoleRow(i)"
            >
              ×
            </button>
          </li>
        </ul>
        <button type="button" class="btn btn-ghost btn-sm" @click="addRoleRow">
          + Add role ID
        </button>
      </section>

      <section class="panel">
        <h2 class="panel-header">
          Allowed Discord user IDs
        </h2>
        <p class="panel-desc">
          These users can use the bot even without an allowed role. Leave empty if you only use roles.
        </p>
        <ul class="id-list">
          <li v-for="(id, i) in userIdInputs" :key="`user-${i}`" class="id-row">
            <input
              v-model="userIdInputs[i]"
              type="text"
              class="input"
              placeholder="e.g. 987654321"
            >
            <button
              type="button"
              class="btn btn-ghost btn-sm btn-icon"
              title="Remove"
              @click="removeUserRow(i)"
            >
              ×
            </button>
          </li>
        </ul>
        <button type="button" class="btn btn-ghost btn-sm" @click="addUserRow">
          + Add user ID
        </button>
      </section>
    </template>
  </main>
</template>

<style scoped>
.permissions-page {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  max-width: 560px;
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

.header-actions {
  display: flex;
  gap: 0.5rem;
}

.btn {
  border: none;
  border-radius: var(--radius-md);
  padding: 0.5rem 1rem;
  font-size: 0.9rem;
  font-weight: 500;
  transition: background var(--transition), opacity var(--transition);
}

.btn-sm {
  padding: 0.35rem 0.75rem;
  font-size: 0.85rem;
}

.btn-icon {
  padding: 0.35rem 0.5rem;
  min-width: 32px;
}

.btn-ghost {
  background: var(--color-bg-elevated);
  color: var(--color-text-muted);
  border: 1px solid var(--color-border);
}

.btn-ghost:hover:not(:disabled) {
  background: var(--color-border);
  color: var(--color-text);
}

.btn-primary {
  background: var(--color-accent);
  color: #0c0c0e;
}

.btn-primary:hover:not(:disabled) {
  background: var(--color-accent-hover);
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.toast {
  padding: 0.75rem 1rem;
  border-radius: var(--radius-md);
  margin: 0;
  font-size: 0.9rem;
}

.toast-success {
  background: var(--color-success-muted);
  color: var(--color-success);
}

.toast-error {
  background: var(--color-error-muted);
  color: var(--color-error);
}

.panel {
  background: var(--color-bg-card);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  padding: 1.5rem;
  box-shadow: var(--shadow-card);
}

.panel-header {
  margin: 0 0 0.5rem;
  font-size: 1.1rem;
  font-weight: 600;
}

.panel-desc {
  margin: 0 0 1rem;
  font-size: 0.9rem;
  color: var(--color-text-muted);
  line-height: 1.5;
}

.panel-message {
  margin: 0;
  font-size: 0.9rem;
  color: var(--color-text-muted);
}

.id-list {
  list-style: none;
  margin: 0 0 0.75rem;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.id-row {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

.input {
  flex: 1;
  min-width: 0;
  padding: 0.4rem 0.6rem;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  color: var(--color-text);
}

.input:focus {
  outline: none;
  border-color: var(--color-border-focus);
}
</style>
