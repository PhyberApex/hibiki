<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
import { RouterLink, RouterView, useRoute } from 'vue-router'
import { usePlayerStore } from '@/stores/player'

declare const __APP_VERSION__: string
const appVersion = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0'

const route = useRoute()
const player = usePlayerStore()
let pollTimer: ReturnType<typeof setInterval> | null = null

const tabs = [
  { path: '/media', label: 'Media' },
  { path: '/scenes', label: 'Scenes' },
  { path: '/browser', label: 'Browser' },
  { path: '/settings', label: 'Settings' },
]

function isTabActive(path: string) {
  if (path === '/scenes')
    return route.path === '/scenes' || route.path.startsWith('/scenes/')
  return route.path.startsWith(path)
}

function startPollingWhenDisconnected() {
  if (pollTimer)
    return
  pollTimer = setInterval(() => {
    if (player.botStatus?.ready) {
      if (pollTimer) {
        clearInterval(pollTimer)
        pollTimer = null
      }
      return
    }
    player.loadState()
  }, 2000)
}

onMounted(() => {
  player.loadState().then(() => {
    if (player.botStatus?.ready)
      player.loadDirectory()
    if (!player.botStatus?.ready)
      startPollingWhenDisconnected()
  })
})

onUnmounted(() => {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
})

const connectedGuild = computed(() =>
  player.directory.find(g => g.guildId === player.connectedGuildId) ?? null,
)
const isWelcome = computed(() => route.path === '/')
</script>

<template>
  <div v-if="isWelcome" class="welcome-layout">
    <RouterView />
  </div>
  <div v-else class="layout">
    <aside class="sidebar">
      <div class="brand-mini">
        <img src="/logo.png" alt="Hibiki" class="brand-logo" width="28" height="28">
        <span class="brand-title">Hibiki</span>
      </div>

      <nav v-if="player.botStatus?.ready" class="sidebar-guild">
        <div
          v-for="guild in player.directory"
          :key="guild.guildId"
          class="guild-group"
        >
          <div class="guild-header" :title="guild.guildName">
            <img
              v-if="guild.iconUrl"
              :src="guild.iconUrl"
              :alt="guild.guildName"
              class="guild-icon"
            >
            <span v-else class="guild-icon guild-icon-placeholder">
              {{ guild.guildName.charAt(0).toUpperCase() }}
            </span>
            <span class="guild-name">{{ guild.guildName }}</span>
          </div>
          <div class="channel-list">
            <button
              v-for="ch in guild.channels"
              :key="ch.id"
              type="button"
              class="channel-item"
              :class="{
                'channel-item-connected': player.connectedGuildId === guild.guildId && player.channelId === ch.id,
              }"
              :disabled="player.channelJoinBusy"
              :title="ch.name"
              @click="player.selectChannel(guild.guildId, ch.id)"
            >
              <span class="channel-dot" aria-hidden="true" />
              {{ ch.name }}
            </button>
          </div>
        </div>
        <button
          v-if="player.connectedGuildId"
          type="button"
          class="btn-disconnect"
          :title="`Leave ${connectedGuild?.guildName ?? 'voice'}`"
          aria-label="Leave voice channel"
          @click="player.doLeave(player.connectedGuildId)"
        >
          Leave
        </button>
      </nav>

      <nav class="sidebar-tabs">
        <RouterLink
          v-for="tab in tabs"
          :key="tab.path"
          :to="tab.path"
          class="sidebar-tab"
          :class="{ 'sidebar-tab-active': isTabActive(tab.path) }"
        >
          {{ tab.label }}
          <span
            v-if="tab.path === '/scenes' && player.scenePlaying"
            class="streaming-badge"
            title="Scene is playing"
          >LIVE</span>
          <span
            v-if="tab.path === '/browser' && player.browserStreamingCount > 0"
            class="streaming-badge"
            title="Streaming audio to Discord"
          >LIVE</span>
        </RouterLink>
      </nav>

      <div class="sidebar-status">
        <span
          class="bot-status"
          :class="[player.botStatus?.ready ? 'bot-status-connected' : 'bot-status-disconnected']"
          :title="player.botStatus?.ready ? `Connected as ${player.botStatus?.userTag ?? 'bot'}` : 'Discord bot not connected'"
        >
          <span class="bot-status-dot" aria-hidden="true" />
          {{ player.botStatus?.ready ? (player.botStatus?.userTag ?? 'Connected') : 'Disconnected' }}
        </span>
        <button
          type="button"
          class="btn-reconnect"
          :disabled="player.reconnecting"
          :title="player.reconnecting ? 'Reconnecting…' : 'Restart Discord bot'"
          :aria-label="player.reconnecting ? 'Reconnecting' : 'Restart Discord bot'"
          @click="player.doReconnect"
        >
          ↻
        </button>
      </div>
    </aside>

    <div class="main-area">
      <main class="content">
        <RouterView v-slot="{ Component }">
          <KeepAlive>
            <component :is="Component" />
          </KeepAlive>
        </RouterView>
      </main>
      <footer class="footer">
        <RouterLink to="/about" class="footer-link">
          About
        </RouterLink>
        <span class="version" title="Hibiki version">v{{ appVersion }}</span>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.welcome-layout {
  min-height: 100vh;
}

.layout {
  display: flex;
  min-height: 100vh;
  background: var(--color-bg);
}

.sidebar {
  display: flex;
  flex-direction: column;
  width: 220px;
  min-width: 220px;
  background: var(--color-bg-elevated);
  border-right: 1px solid var(--color-border);
  padding: 1rem 0.75rem;
  gap: 1.25rem;
}

.brand-mini {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.25rem 0.5rem;
  color: var(--color-text);
  flex-shrink: 0;
}

.brand-logo {
  width: 28px;
  height: 28px;
  border-radius: var(--radius-sm);
  object-fit: contain;
}

.brand-title {
  font-size: 1.1rem;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.sidebar-guild {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  overflow-y: auto;
}

.guild-group {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.guild-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.4rem 0.5rem;
  font-size: 0.85rem;
  color: var(--color-text);
  font-weight: 600;
}

.guild-icon {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  object-fit: cover;
  flex-shrink: 0;
}

.guild-icon-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.9rem;
  font-weight: 600;
  background: var(--color-accent-muted);
  color: var(--color-accent);
}

.guild-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.channel-list {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  padding-left: 0.25rem;
  border-left: 2px solid var(--color-border);
}

.channel-item {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.3rem 0.5rem;
  font-size: 0.8rem;
  color: var(--color-text-muted);
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  text-align: left;
  width: 100%;
  transition: background var(--transition), color var(--transition);
}

.channel-item:hover:not(:disabled) {
  color: var(--color-text);
  background: var(--color-bg);
}

.channel-item-connected {
  color: var(--color-accent);
  font-weight: 500;
  background: var(--color-accent-muted);
  box-shadow: inset 3px 0 0 var(--color-accent);
}

.channel-dot {
  width: 0.35rem;
  height: 0.35rem;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.6;
  flex-shrink: 0;
}

.btn-disconnect {
  margin-top: 0.25rem;
  padding: 0.35rem 0.6rem;
  font-size: 0.8rem;
  font-weight: 500;
  color: var(--color-text-muted);
  background: transparent;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background var(--transition), color var(--transition), border-color var(--transition);
}

.btn-disconnect:hover {
  background: var(--color-error-muted);
  color: var(--color-error);
  border-color: var(--color-error);
}

.sidebar-tabs {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.sidebar-tab {
  display: flex;
  align-items: center;
  padding: 0.5rem 0.75rem;
  font-size: 0.9rem;
  color: var(--color-text-muted);
  text-decoration: none;
  border-radius: var(--radius-sm);
  transition: background var(--transition), color var(--transition);
}

.sidebar-tab:hover {
  color: var(--color-text);
  background: var(--color-bg);
}

.sidebar-tab-active {
  color: var(--color-accent);
  font-weight: 500;
  background: var(--color-accent-muted);
}

.streaming-badge {
  font-size: 0.65rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  padding: 0.1rem 0.35rem;
  border-radius: var(--radius-full);
  background: var(--color-live);
  color: var(--color-on-accent-bg);
  margin-left: auto;
  line-height: 1;
  animation: live-pulse 2s ease-in-out infinite;
}

@keyframes live-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}

.sidebar-status {
  margin-top: auto;
  display: flex;
  align-items: center;
  gap: 0.35rem;
}

.btn-reconnect {
  width: 1.75rem;
  height: 1.75rem;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.85rem;
  color: var(--color-text-muted);
  background: transparent;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  cursor: pointer;
  flex-shrink: 0;
  transition: background var(--transition), color var(--transition);
}

.btn-reconnect:hover:not(:disabled) {
  color: var(--color-text);
  background: var(--color-bg);
}

.btn-reconnect:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.bot-status {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.75rem;
  font-weight: 500;
  padding: 0.25rem 0.5rem;
  border-radius: var(--radius-full);
  border: 1px solid transparent;
}

.bot-status-dot {
  width: 0.4rem;
  height: 0.4rem;
  border-radius: 50%;
  flex-shrink: 0;
}

.bot-status-connected {
  background: var(--color-success-muted);
  color: var(--color-live);
  border-color: var(--color-live);
}

.bot-status-connected .bot-status-dot {
  background: var(--color-live);
  animation: heartbeat 2.5s ease-in-out infinite;
}

@keyframes heartbeat {
  0%, 100% { transform: scale(1); opacity: 1; }
  40% { transform: scale(1.3); opacity: 0.8; }
  60% { transform: scale(1); opacity: 1; }
}

.bot-status-disconnected {
  background: var(--color-error-muted);
  color: var(--color-error);
  border-color: var(--color-error);
}

.bot-status-disconnected .bot-status-dot {
  background: var(--color-error);
}

.main-area {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}

.content {
  flex: 1;
  padding: 1.5rem;
  overflow: auto;
  min-height: 0;
}

.content:has(.browser-view) {
  padding: 0;
  overflow: hidden;
}

.footer {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.5rem 1rem;
  border-top: 1px solid var(--color-border);
  background: var(--color-bg-elevated);
}

.footer-link {
  font-size: 0.8rem;
  color: var(--color-text-muted);
  text-decoration: none;
}

.footer-link:hover {
  color: var(--color-accent);
}

.version {
  font-size: 0.75rem;
  color: var(--color-text-dim);
}

/* Narrow window: compact sidebar */
@media (max-width: 960px) {
  .sidebar {
    width: 180px;
    min-width: 180px;
    padding: 0.75rem 0.5rem;
    gap: 1rem;
  }

  .guild-header {
    padding: 0.3rem 0.4rem;
    font-size: 0.8rem;
  }

  .guild-icon {
    width: 22px;
    height: 22px;
  }

  .channel-item {
    padding: 0.25rem 0.4rem;
    font-size: 0.75rem;
  }

  .sidebar-tab {
    padding: 0.4rem 0.6rem;
    font-size: 0.85rem;
  }

  .content {
    padding: 1rem;
  }
}
</style>
