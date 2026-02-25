<script setup lang="ts">
import type { Bookmark } from '@/api/config'
import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue'
import { sendEffectChunk, startEffectStream, stopEffectStream } from '@/api/audio-stream'
import {
  browserViewGoBack,
  browserViewGoForward,
  browserViewReload,
  createBrowserView,
  destroyBrowserView,
  getBrowserViewMediaSourceId,
  hideBrowserView,
  loadBrowserViewURL,
  onBrowserViewEvent,
  setBrowserViewBounds,
  showBrowserView,
} from '@/api/browser-view'
import { listBookmarks, saveBookmarks } from '@/api/config'
import { captureFromMediaStream } from '@/audio/browser-audio-capture'
import { usePlayerStore } from '@/stores/player'

interface BrowserTab {
  id: number
  url: string
  title: string
  favicon: string | null
  mediaPlaying: boolean
  streaming: boolean
}

const DEFAULT_BROWSER_URL = 'https://phyberapex.github.io/hibiki/'

const player = usePlayerStore()
const tabs = ref<BrowserTab[]>([])
const activeTabId = ref<number | null>(null)
const defaultTabId = ref<number | null>(null)
const urlInput = ref('')
const containerEl = ref<HTMLElement | null>(null)
const captureSessions = new Map<number, { stop: () => void }>()
const cleanups: (() => void)[] = []
const bookmarks = ref<Bookmark[]>([])
const editingBookmarkUrl = ref<string | null>(null)
const editingBookmarkName = ref('')
const editingInputEl = ref<HTMLInputElement | null>(null)
const isInitializing = ref(false)

const activeTab = computed(() => tabs.value.find(t => t.id === activeTabId.value) ?? null)
const isCurrentPageBookmarked = computed(() =>
  activeTab.value ? bookmarks.value.some(b => b.url === activeTab.value!.url) : false,
)

async function loadBookmarks() {
  try {
    bookmarks.value = await listBookmarks()
  }
  catch {
    bookmarks.value = []
  }
}

async function toggleBookmark() {
  const tab = activeTab.value
  if (!tab)
    return
  const idx = bookmarks.value.findIndex(b => b.url === tab.url)
  if (idx >= 0) {
    bookmarks.value.splice(idx, 1)
  }
  else {
    bookmarks.value.push({
      name: tab.title || tab.url,
      url: tab.url,
      favicon: tab.favicon ?? undefined,
    })
  }
  await saveBookmarks(bookmarks.value).catch(() => {})
}

function removeBookmark(url: string) {
  if (editingBookmarkUrl.value === url)
    editingBookmarkUrl.value = null
  bookmarks.value = bookmarks.value.filter(b => b.url !== url)
  saveBookmarks(bookmarks.value).catch(() => {})
}

function renameBookmark(url: string, newName: string) {
  const b = bookmarks.value.find(bm => bm.url === url)
  if (b) {
    b.name = newName.trim() || url
    saveBookmarks(bookmarks.value).catch(() => {})
  }
}

function startEditing(bm: Bookmark) {
  editingBookmarkUrl.value = bm.url
  editingBookmarkName.value = bm.name
  nextTick(() => {
    const el = Array.isArray(editingInputEl.value) ? editingInputEl.value[0] : editingInputEl.value
    ;(el as HTMLInputElement | undefined)?.focus()
  })
}

function commitRename() {
  if (!editingBookmarkUrl.value)
    return
  renameBookmark(editingBookmarkUrl.value, editingBookmarkName.value)
  editingBookmarkUrl.value = null
}

function cancelRename() {
  editingBookmarkUrl.value = null
}

function normalizeUrl(input: string): string {
  let url = input.trim()
  if (!url)
    return ''
  if (!/^https?:\/\//i.test(url))
    url = `https://${url}`
  return url
}

async function openTab(url?: string) {
  const target = url === undefined ? DEFAULT_BROWSER_URL : (url || 'about:blank')
  const isDefaultTab = tabs.value.length === 0 && target === DEFAULT_BROWSER_URL
  try {
    const id = await createBrowserView(target)
    if (isDefaultTab)
      defaultTabId.value = id
    tabs.value.push({
      id,
      url: target,
      title: 'Loading…',
      favicon: null,
      mediaPlaying: false,
      streaming: false,
    })
    activeTabId.value = id
    urlInput.value = target
    await nextTick()
    await updateViewBounds()
    await showBrowserView(id)
  }
  catch (e) {
    console.error('[browser] Failed to open tab:', e)
  }
}

async function closeTab(id: number) {
  if (id === defaultTabId.value)
    return
  await stopStreaming(id)
  await destroyBrowserView(id).catch(() => {})
  tabs.value = tabs.value.filter(t => t.id !== id)
  if (activeTabId.value === id) {
    const next = tabs.value.length > 0 ? tabs.value[tabs.value.length - 1]! : null
    activeTabId.value = next?.id ?? null
    urlInput.value = next?.url ?? ''
  }
  await updateViewBounds()
}

async function switchTab(id: number) {
  if (activeTabId.value === id)
    return
  if (activeTabId.value != null)
    await hideBrowserView(activeTabId.value).catch(() => {})
  activeTabId.value = id
  const tab = tabs.value.find(t => t.id === id)
  if (tab)
    urlInput.value = tab.url
  await showBrowserView(id).catch(() => {})
  await updateViewBounds()
}

async function navigateTo() {
  const url = normalizeUrl(urlInput.value)
  if (!url || activeTabId.value == null)
    return
  urlInput.value = url
  await loadBrowserViewURL(activeTabId.value, url)
}

async function goBack() {
  if (activeTabId.value != null)
    await browserViewGoBack(activeTabId.value)
}

async function goForward() {
  if (activeTabId.value != null)
    await browserViewGoForward(activeTabId.value)
}

async function reload() {
  if (activeTabId.value != null)
    await browserViewReload(activeTabId.value)
}

async function toggleStreaming(tabId: number) {
  const tab = tabs.value.find(t => t.id === tabId)
  if (!tab)
    return
  if (tab.streaming) {
    await stopStreaming(tabId)
  }
  else {
    await startStreaming(tabId)
  }
}

async function startStreaming(tabId: number) {
  const tab = tabs.value.find(t => t.id === tabId)
  if (!tab || !player.guildId || !player.isJoined)
    return

  try {
    const mediaSourceId = await getBrowserViewMediaSourceId(tabId)
    const streamId = `browser-${tabId}`
    await startEffectStream(player.guildId, streamId)

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: mediaSourceId,
        },
      } as any,
      video: false,
    })

    const captureGuildId = player.guildId
    const session = await captureFromMediaStream(stream, (pcm) => {
      sendEffectChunk(captureGuildId!, pcm, streamId)
    })

    captureSessions.set(tabId, {
      stop: () => {
        session.stop()
        stopEffectStream(captureGuildId!, streamId).catch(() => {})
      },
    })

    tab.streaming = true
    player.browserStreamingCount++
  }
  catch (e) {
    console.error('[browser] Failed to start streaming:', e)
  }
}

async function stopStreaming(tabId: number) {
  const sess = captureSessions.get(tabId)
  if (sess) {
    sess.stop()
    captureSessions.delete(tabId)
  }
  const tab = tabs.value.find(t => t.id === tabId)
  if (tab && tab.streaming) {
    tab.streaming = false
    player.browserStreamingCount = Math.max(0, player.browserStreamingCount - 1)
  }
}

async function updateViewBounds() {
  if (!containerEl.value || activeTabId.value == null)
    return
  const rect = containerEl.value.getBoundingClientRect()
  await setBrowserViewBounds(activeTabId.value, {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  })
}

let resizeObserver: ResizeObserver | null = null

onMounted(() => {
  loadBookmarks()
  function tabById(id: unknown): BrowserTab | undefined {
    const n = typeof id === 'number' ? id : Number(id)
    return Number.isNaN(n) ? undefined : tabs.value.find(t => t.id === n)
  }
  cleanups.push(onBrowserViewEvent('browserView:didNavigate', (id: unknown, url: unknown) => {
    const tab = tabById(id)
    if (tab) {
      tab.url = url as string
      if (activeTabId.value === tab.id)
        urlInput.value = url as string
    }
  }))
  cleanups.push(onBrowserViewEvent('browserView:titleUpdated', (id: unknown, title: unknown) => {
    const tab = tabById(id)
    if (tab)
      tab.title = (title as string) || tab.url || 'New tab'
  }))
  cleanups.push(onBrowserViewEvent('browserView:faviconUpdated', (id: unknown, faviconUrl: unknown) => {
    const tab = tabById(id)
    if (tab) {
      tab.favicon = typeof faviconUrl === 'string' ? faviconUrl : null
    }
  }))
  cleanups.push(onBrowserViewEvent('browserView:mediaPlaying', (id: unknown, playing: unknown) => {
    const tab = tabById(id)
    if (tab)
      tab.mediaPlaying = playing as boolean
  }))

  resizeObserver = new ResizeObserver(() => updateViewBounds())
  if (containerEl.value)
    resizeObserver.observe(containerEl.value)
})

onActivated(async () => {
  if (tabs.value.length === 0) {
    isInitializing.value = true
    await openTab(DEFAULT_BROWSER_URL)
    isInitializing.value = false
    return
  }
  if (activeTabId.value != null) {
    await showBrowserView(activeTabId.value).catch(() => {})
    await nextTick()
    await updateViewBounds()
  }
})

onDeactivated(async () => {
  if (activeTabId.value != null)
    await hideBrowserView(activeTabId.value).catch(() => {})
})

onBeforeUnmount(async () => {
  cleanups.forEach(fn => fn())
  cleanups.length = 0
  if (resizeObserver) {
    resizeObserver.disconnect()
    resizeObserver = null
  }
  for (const tab of tabs.value) {
    await stopStreaming(tab.id)
    await destroyBrowserView(tab.id).catch(() => {})
  }
})

watch(activeTabId, async (newId, oldId) => {
  if (oldId != null && oldId !== newId)
    await hideBrowserView(oldId).catch(() => {})
  if (newId != null) {
    await showBrowserView(newId).catch(() => {})
    await updateViewBounds()
  }
})
</script>

<template>
  <div class="browser-view">
    <div class="browser-tabs-bar">
      <div class="browser-tabs-list">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          type="button"
          class="browser-tab-pill"
          :class="{ 'browser-tab-pill-active': activeTabId === tab.id }"
          :title="tab.title"
          @click="switchTab(tab.id)"
        >
          <img v-if="tab.favicon" :src="tab.favicon" class="browser-tab-favicon" alt="">
          <span class="browser-tab-title">{{ tab.title || 'New tab' }}</span>
          <span
            v-if="tab.streaming"
            class="browser-tab-streaming"
            title="Streaming to Discord"
          >●</span>
          <button
            v-if="tab.id !== defaultTabId"
            type="button"
            class="browser-tab-close"
            title="Close tab"
            @click.stop="closeTab(tab.id)"
          >
            ×
          </button>
        </button>
      </div>
      <button type="button" class="browser-tab-new" title="New tab" @click="openTab('')">
        +
      </button>
    </div>

    <div v-if="activeTabId != null" class="browser-toolbar">
      <button type="button" class="toolbar-btn" title="Back" @click="goBack">
        ◀
      </button>
      <button type="button" class="toolbar-btn" title="Forward" @click="goForward">
        ▶
      </button>
      <button type="button" class="toolbar-btn" title="Reload" @click="reload">
        ↻
      </button>
      <form class="url-form" @submit.prevent="navigateTo">
        <input
          v-model="urlInput"
          class="url-input"
          type="text"
          placeholder="Enter URL…"
        >
      </form>
      <button
        type="button"
        class="toolbar-btn toolbar-btn-bookmark"
        :class="{ 'toolbar-btn-bookmark-active': isCurrentPageBookmarked }"
        title="Bookmark this page"
        @click="toggleBookmark"
      >
        {{ isCurrentPageBookmarked ? '★' : '☆' }}
      </button>
      <button
        type="button"
        class="toolbar-btn toolbar-btn-stream"
        :class="{ 'toolbar-btn-stream-active': activeTab?.streaming }"
        :disabled="!player.isJoined"
        :title="player.isJoined ? (activeTab?.streaming ? 'Stop streaming audio' : 'Stream audio to Discord') : 'Join a voice channel first'"
        @click="activeTabId != null && toggleStreaming(activeTabId)"
      >
        {{ activeTab?.streaming ? '🔊 Stop' : '🔈 Stream' }}
      </button>
    </div>

    <div v-if="bookmarks.length > 0" class="bookmarks-bar">
      <div
        v-for="bm in bookmarks"
        :key="bm.url"
        class="bookmark-item"
        :title="bm.url"
      >
        <button
          type="button"
          class="bookmark-item-main"
          @click="editingBookmarkUrl === bm.url ? undefined : openTab(bm.url)"
        >
          <img v-if="bm.favicon" :src="bm.favicon" class="bookmark-favicon" alt="">
          <span v-if="editingBookmarkUrl !== bm.url" class="bookmark-name">{{ bm.name }}</span>
          <input
            v-else
            ref="editingInputEl"
            v-model="editingBookmarkName"
            type="text"
            class="bookmark-rename-input"
            @click.stop
            @blur="commitRename"
            @keydown.enter="commitRename"
            @keydown.escape="cancelRename"
          >
        </button>
        <button
          v-if="editingBookmarkUrl !== bm.url"
          type="button"
          class="bookmark-edit"
          title="Rename bookmark"
          @click.stop="startEditing(bm)"
        >
          ✎
        </button>
        <button
          type="button"
          class="bookmark-remove"
          title="Remove bookmark"
          @click.stop="removeBookmark(bm.url)"
        >
          ×
        </button>
      </div>
    </div>

    <div
      ref="containerEl"
      class="browser-content"
      :class="{ 'browser-content-empty': activeTabId == null }"
    >
      <div v-if="tabs.length === 0" class="browser-empty">
        <p v-if="isInitializing" class="browser-empty-text">
          Loading...
        </p>
        <template v-else>
          <p class="browser-empty-text">
            Open a tab to browse the web and stream audio to Discord.
          </p>
          <div v-if="bookmarks.length > 0" class="empty-bookmarks">
            <div
              v-for="bm in bookmarks"
              :key="bm.url"
              class="empty-bookmark-item-wrap"
            >
              <button
                type="button"
                class="empty-bookmark-item"
                :title="bm.url"
                @click="editingBookmarkUrl === bm.url ? undefined : openTab(bm.url)"
              >
                <img v-if="bm.favicon" :src="bm.favicon" class="empty-bookmark-favicon" alt="">
                <span v-if="editingBookmarkUrl !== bm.url" class="empty-bookmark-name">{{ bm.name }}</span>
                <input
                  v-else
                  v-model="editingBookmarkName"
                  type="text"
                  class="empty-bookmark-rename-input"
                  @click.stop
                  @blur="commitRename"
                  @keydown.enter="commitRename"
                  @keydown.escape="cancelRename"
                >
              </button>
              <button
                v-if="editingBookmarkUrl !== bm.url"
                type="button"
                class="empty-bookmark-edit"
                title="Rename bookmark"
                @click.stop="startEditing(bm)"
              >
                ✎
              </button>
            </div>
          </div>
          <div class="empty-defaults">
            <button type="button" class="btn-open-tab" @click="openTab()">
              Open YouTube
            </button>
            <button type="button" class="btn-open-tab btn-open-tab-secondary" @click="openTab('https://open.spotify.com')">
              Open Spotify
            </button>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.browser-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.browser-tabs-bar {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.4rem 0.75rem;
  background: var(--color-bg-elevated);
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}

.browser-tabs-list {
  display: flex;
  gap: 0.25rem;
  overflow-x: auto;
  flex: 1;
  min-width: 0;
}

.browser-tab-pill {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.3rem 0.5rem;
  font-size: 0.8rem;
  color: var(--color-text-muted);
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  cursor: pointer;
  max-width: 180px;
  flex-shrink: 0;
  transition: background var(--transition), color var(--transition);
}

.browser-tab-pill:hover {
  color: var(--color-text);
}

.browser-tab-pill-active {
  color: var(--color-text);
  background: var(--color-bg-elevated);
  border-color: var(--color-accent);
}

.browser-tab-favicon {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  border-radius: 2px;
}

.browser-tab-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.browser-tab-streaming {
  color: var(--color-accent);
  font-size: 0.6rem;
  flex-shrink: 0;
}

.browser-tab-close {
  font-size: 1rem;
  line-height: 1;
  color: var(--color-text-muted);
  background: none;
  border: none;
  cursor: pointer;
  padding: 0 0.15rem;
  flex-shrink: 0;
}

.browser-tab-close:hover {
  color: var(--color-error);
}

.browser-tab-new {
  width: 1.75rem;
  height: 1.75rem;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.1rem;
  color: var(--color-text-muted);
  background: transparent;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  cursor: pointer;
  flex-shrink: 0;
}

.browser-tab-new:hover {
  color: var(--color-text);
  background: var(--color-bg);
}

.browser-toolbar {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.35rem 0.75rem;
  background: var(--color-bg-elevated);
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}

.toolbar-btn {
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
}

.toolbar-btn:hover {
  color: var(--color-text);
  background: var(--color-bg);
}

.toolbar-btn-stream {
  padding: 0.25rem 0.6rem;
  width: auto;
  font-size: 0.8rem;
  font-weight: 500;
}

.toolbar-btn-stream:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.toolbar-btn-stream-active {
  color: var(--color-accent);
  border-color: var(--color-accent);
  background: var(--color-accent-muted);
}

.toolbar-btn-bookmark {
  font-size: 1rem;
}

.toolbar-btn-bookmark-active {
  color: #f5a623;
}

.url-form {
  flex: 1;
  min-width: 0;
}

.url-input {
  width: 100%;
  padding: 0.35rem 0.6rem;
  font-size: 0.85rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-bg);
  color: var(--color-text);
}

.url-input:focus {
  outline: none;
  border-color: var(--color-accent);
}

.bookmarks-bar {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.25rem 0.75rem;
  background: var(--color-bg-elevated);
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
  overflow-x: auto;
}

.bookmark-item {
  display: flex;
  align-items: center;
  gap: 0.2rem;
  max-width: 180px;
  flex-shrink: 0;
}

.bookmark-item-main {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.2rem 0.5rem;
  font-size: 0.75rem;
  color: var(--color-text-muted);
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
  text-align: left;
  transition: background var(--transition), color var(--transition);
}

.bookmark-item-main:hover {
  background: var(--color-bg);
  color: var(--color-text);
}

.bookmark-rename-input {
  flex: 1;
  min-width: 0;
  font-size: inherit;
  color: var(--color-text);
  background: var(--color-bg);
  border: 1px solid var(--color-accent);
  border-radius: var(--radius-sm);
  padding: 0.1rem 0.25rem;
}

.bookmark-rename-input:focus {
  outline: none;
}

.bookmark-edit {
  display: none;
  font-size: 0.75rem;
  line-height: 1;
  color: var(--color-text-muted);
  background: none;
  border: none;
  cursor: pointer;
  padding: 0.15rem;
  flex-shrink: 0;
}

.bookmark-item:hover .bookmark-edit {
  display: inline;
}

.bookmark-edit:hover {
  color: var(--color-accent);
}

.bookmark-favicon {
  width: 12px;
  height: 12px;
  flex-shrink: 0;
  border-radius: 2px;
}

.bookmark-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bookmark-remove {
  display: none;
  font-size: 0.85rem;
  line-height: 1;
  color: var(--color-text-muted);
  background: none;
  border: none;
  cursor: pointer;
  padding: 0 0.1rem;
  flex-shrink: 0;
}

.bookmark-item:hover .bookmark-edit,
.bookmark-item:hover .bookmark-remove {
  display: inline;
}

.bookmark-remove:hover {
  color: var(--color-error);
}

.browser-content {
  flex: 1;
  min-height: 0;
  position: relative;
  background: var(--color-bg);
}

.browser-content-empty {
  display: flex;
  align-items: center;
  justify-content: center;
}

.browser-empty {
  text-align: center;
  padding: 3rem 2rem;
}

.browser-empty-text {
  font-size: 1rem;
  color: var(--color-text-muted);
  margin-bottom: 1.5rem;
}

.empty-bookmarks {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.5rem;
  margin-bottom: 1.5rem;
}

.empty-bookmark-item-wrap {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.empty-bookmark-item {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.5rem 0.9rem;
  font-size: 0.85rem;
  color: var(--color-text);
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: background var(--transition), border-color var(--transition);
}

.empty-bookmark-item:hover {
  background: var(--color-bg);
  border-color: var(--color-accent);
}

.empty-bookmark-rename-input {
  min-width: 120px;
  font-size: inherit;
  color: var(--color-text);
  background: var(--color-bg);
  border: 1px solid var(--color-accent);
  border-radius: var(--radius-sm);
  padding: 0.25rem 0.4rem;
}

.empty-bookmark-rename-input:focus {
  outline: none;
}

.empty-bookmark-edit {
  font-size: 0.85rem;
  color: var(--color-text-muted);
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  cursor: pointer;
  padding: 0.4rem 0.5rem;
  transition: color var(--transition), border-color var(--transition);
}

.empty-bookmark-edit:hover {
  color: var(--color-accent);
  border-color: var(--color-accent);
}

.empty-bookmark-favicon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  border-radius: 2px;
}

.empty-bookmark-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 200px;
}

.empty-defaults {
  display: flex;
  gap: 0.5rem;
  justify-content: center;
}

.btn-open-tab {
  padding: 0.6rem 1.5rem;
  font-size: 0.95rem;
  font-weight: 500;
  border: none;
  border-radius: var(--radius-md);
  background: var(--color-accent);
  color: #0c0c0e;
  cursor: pointer;
  margin: 0.25rem;
  transition: background var(--transition);
}

.btn-open-tab:hover {
  background: var(--color-accent-hover);
}

.btn-open-tab-secondary {
  background: transparent;
  color: var(--color-text-muted);
  border: 1px solid var(--color-border);
}

.btn-open-tab-secondary:hover {
  color: var(--color-text);
  background: var(--color-bg-elevated);
}
</style>
