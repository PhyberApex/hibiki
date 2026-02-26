import type { BotStatus, GuildDirectoryEntry, PlayerStateItem } from '@/api/player'
import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import {
  fetchBotStatus,
  fetchGuildDirectory,
  fetchPlayerState,
  joinChannel,
  leaveGuild,
  reconnectBot,
} from '@/api/player'

export const usePlayerStore = defineStore('player', () => {
  const playerState = ref<PlayerStateItem[]>([])
  const botStatus = ref<BotStatus | null>(null)
  const directory = ref<GuildDirectoryEntry[]>([])
  const directoryError = ref<string | null>(null)
  const guildId = ref('')
  const channelId = ref('')
  const channelJoinBusy = ref(false)
  const browserStreamingCount = ref(0)
  const scenePlaying = ref(false)

  const channels = computed(() => {
    const guild = directory.value.find(entry => entry.guildId === guildId.value)
    return guild?.channels ?? []
  })

  const selectedGuildState = computed(() =>
    playerState.value.find(g => g.guildId === guildId.value),
  )
  const isJoined = computed(() => !!selectedGuildState.value?.connectedChannelId)
  const connectedGuildId = computed(() =>
    playerState.value.find(g => g.connectedChannelId)?.guildId ?? '',
  )

  async function loadState() {
    try {
      const [stateRes, botRes] = await Promise.all([
        fetchPlayerState(),
        fetchBotStatus().catch(() => ({ ready: false } as BotStatus)),
      ])
      playerState.value = stateRes
      botStatus.value = botRes
    }
    catch {
      // Expected when running outside Electron (e.g. tests or Vite dev)
    }
  }

  function syncSelectionFromConnectedState() {
    const connected = playerState.value.find(g => g.connectedChannelId)
    if (!connected)
      return
    const guild = directory.value.find(g => g.guildId === connected.guildId)
    if (!guild || !guild.channels.some(c => c.id === connected.connectedChannelId))
      return
    if (guildId.value !== connected.guildId)
      guildId.value = connected.guildId
    if (channelId.value !== connected.connectedChannelId)
      channelId.value = connected.connectedChannelId!
  }

  async function loadDirectory() {
    directoryError.value = null
    try {
      const data = await fetchGuildDirectory()
      directory.value = data
      ensureChannelSelection()
    }
    catch (err) {
      directoryError.value
        = err instanceof Error ? err.message : 'Failed to load guilds'
    }
  }

  function ensureChannelSelection() {
    if (!channels.value.length) {
      channelId.value = ''
      return
    }
    const connectedId = selectedGuildState.value?.connectedChannelId
    if (connectedId && channels.value.some(c => c.id === connectedId)) {
      channelId.value = connectedId
      return
    }
    if (!channels.value.some(channel => channel.id === channelId.value))
      channelId.value = ''
  }

  async function selectChannel(gid: string, cid: string) {
    if (!gid || !cid)
      return
    guildId.value = gid
    channelId.value = cid
    const connected = selectedGuildState.value?.connectedChannelId
    if (connected === cid)
      return
    channelJoinBusy.value = true
    try {
      await joinChannel(gid, cid)
      await loadState()
    }
    finally {
      channelJoinBusy.value = false
    }
  }

  async function doLeave(gid?: string) {
    const targetGuildId = gid ?? guildId.value ?? connectedGuildId.value
    if (!targetGuildId)
      return
    await leaveGuild(targetGuildId)
    playerState.value = playerState.value.filter(g => g.guildId !== targetGuildId)
    if (guildId.value === targetGuildId)
      channelId.value = ''
  }

  const reconnecting = ref(false)

  async function doReconnect() {
    reconnecting.value = true
    try {
      await reconnectBot()
      playerState.value = []
      directory.value = []
      guildId.value = ''
      channelId.value = ''

      const deadline = Date.now() + 15_000
      while (Date.now() < deadline) {
        await loadState()
        if (botStatus.value?.ready)
          break
        await new Promise<void>(r => setTimeout(r, 1_000))
      }
      if (botStatus.value?.ready)
        await loadDirectory()
    }
    finally {
      reconnecting.value = false
    }
  }

  watch(
    () => botStatus.value?.ready,
    (ready, wasReady) => {
      if (ready && !wasReady)
        loadDirectory()
    },
  )

  watch(guildId, () => {
    ensureChannelSelection()
  })

  watch(
    () => selectedGuildState.value?.connectedChannelId,
    (connectedId) => {
      if (connectedId && channels.value.some(c => c.id === connectedId))
        channelId.value = connectedId
    },
  )

  watch(
    () => [playerState.value, directory.value] as const,
    () => {
      syncSelectionFromConnectedState()
    },
    { deep: true },
  )

  return {
    playerState,
    botStatus,
    directory,
    directoryError,
    guildId,
    channelId,
    channels,
    selectedGuildState,
    isJoined,
    channelJoinBusy,
    loadState,
    loadDirectory,
    selectChannel,
    doLeave,
    doReconnect,
    reconnecting,
    connectedGuildId,
    browserStreamingCount,
    scenePlaying,
  }
})
