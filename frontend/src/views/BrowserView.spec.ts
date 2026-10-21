import type { VueWrapper } from '@vue/test-utils'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, KeepAlive, nextTick, ref } from 'vue'
import { setEffectStreamVolume, startEffectStream, stopEffectStream } from '@/api/audio-stream'
import {
  browserViewGoBack,
  browserViewGoForward,
  browserViewReload,
  createBrowserView,
  destroyBrowserView,
  getBrowserViewMediaSourceId,
  hideBrowserView,
  loadBrowserViewURL,
  setBrowserViewAudioMuted,
  setBrowserViewBounds,
  showBrowserView,
} from '@/api/browser-view'
import { listBookmarks, saveBookmarks } from '@/api/config'
import { captureFromMediaStream, captureTabStream } from '@/audio/browser-audio-capture'
import { createRoutedTabLocalPlayback } from '@/audio/routed-tab-local-playback'
import { usePlayerStore } from '@/stores/player'
import { useRoutedTabsStore } from '@/stores/routed-tabs'
import { useScenePlaybackStore } from '@/stores/scene-playback'
import BrowserView from './BrowserView.vue'

const browserEvents = new Map<string, (...args: unknown[]) => void>()

vi.mock('@/api/browser-view', () => ({
  createBrowserView: vi.fn(),
  destroyBrowserView: vi.fn().mockResolvedValue(undefined),
  setBrowserViewBounds: vi.fn().mockResolvedValue(undefined),
  loadBrowserViewURL: vi.fn().mockResolvedValue(undefined),
  browserViewGoBack: vi.fn().mockResolvedValue(undefined),
  browserViewGoForward: vi.fn().mockResolvedValue(undefined),
  browserViewReload: vi.fn().mockResolvedValue(undefined),
  getBrowserViewMediaSourceId: vi.fn((id: number) => Promise.resolve(`source-${id}`)),
  setBrowserViewAudioMuted: vi.fn().mockResolvedValue(undefined),
  showBrowserView: vi.fn().mockResolvedValue(undefined),
  hideBrowserView: vi.fn().mockResolvedValue(undefined),
  onBrowserViewEvent: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
    browserEvents.set(event, cb)
    return () => browserEvents.delete(event)
  }),
}))
vi.mock('@/api/config', () => ({
  listBookmarks: vi.fn(),
  saveBookmarks: vi.fn().mockResolvedValue(undefined),
  fetchSceneFadeLength: vi.fn().mockResolvedValue(0),
  fetchMasterVolume: vi.fn().mockResolvedValue(50),
  updateMasterVolume: vi.fn().mockResolvedValue(undefined),
  fetchActiveOutputTarget: vi.fn().mockResolvedValue('local'),
  updateActiveOutputTarget: vi.fn().mockResolvedValue(undefined),
  LOCAL_TARGET_ID: 'local',
}))
vi.mock('@/api/audio-stream', () => ({
  sendEffectChunk: vi.fn(),
  startEffectStream: vi.fn().mockResolvedValue(undefined),
  stopEffectStream: vi.fn().mockResolvedValue(undefined),
  setEffectStreamVolume: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/audio/browser-audio-capture', () => ({
  captureTabStream: vi.fn(),
  captureFromMediaStream: vi.fn(),
}))
vi.mock('@/audio/routed-tab-local-playback', () => ({
  createRoutedTabLocalPlayback: vi.fn(),
}))
vi.mock('@/api/scenes', () => ({ getScene: vi.fn() }))
vi.mock('@/api/usage-stats', () => ({ trackUsage: vi.fn() }))
vi.mock('@/api/sounds', () => ({ soundStreamUrl: vi.fn(), canDecode: vi.fn().mockResolvedValue(true) }))
vi.mock('@/api/player', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/player')>()
  return {
    ...actual,
    stopMusic: vi.fn().mockResolvedValue(undefined),
    stopAmbience: vi.fn().mockResolvedValue(undefined),
    stopEffects: vi.fn().mockResolvedValue(undefined),
  }
})

const DEFAULT_URL = 'https://phyberapex.github.io/hibiki/'
const captureStop = vi.fn()
const localStop = vi.fn()
const localSetLevel = vi.fn()
let resizeCallback: (() => void) | null = null

class ResizeObserverStub {
  constructor(cb: () => void) {
    resizeCallback = cb
  }

  observe() {}
  disconnect() {}
}

function flush() {
  return new Promise(resolve => setTimeout(resolve, 0))
}

function joinDiscord(guildId = 'g1') {
  const player = usePlayerStore()
  player.activeTarget = 'discord'
  player.guildId = guildId
  player.playerState = [{ guildId, connectedChannelId: 'c1' } as never]
}

const showBrowser = ref(true)
const Host = defineComponent({
  setup() {
    return () => h(KeepAlive, null, [showBrowser.value ? h(BrowserView) : h('div', 'Elsewhere')])
  },
})

let wrapper: VueWrapper | null = null

/** Mounts the view the way the router does (inside KeepAlive), which opens the default tab on activation. */
async function mountBrowser() {
  showBrowser.value = true
  wrapper = mount(Host, { attachTo: document.body })
  await flush()
  return wrapper
}

function tabPills() {
  return wrapper!.findAll('.browser-tab-pill')
}

function button(label: string) {
  return wrapper!.find(`button[aria-label="${label}"]`)
}

function routeButton() {
  return wrapper!.find('.toolbar-btn-stream')
}

async function openNewTab(id: number) {
  vi.mocked(createBrowserView).mockResolvedValueOnce(id)
  await button('New tab').trigger('click')
  await flush()
}

describe('browserView', () => {
  let nextId: number

  beforeEach(() => {
    vi.clearAllMocks()
    browserEvents.clear()
    setActivePinia(createPinia())
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
      { x: 10.4, y: 80.6, width: 799.5, height: 600.2 } as DOMRect,
    )
    nextId = 1
    vi.mocked(createBrowserView).mockImplementation(() => Promise.resolve(nextId++))
    vi.mocked(listBookmarks).mockResolvedValue([])
    const track = { stop: vi.fn() }
    vi.mocked(captureTabStream).mockResolvedValue({ getTracks: () => [track] } as unknown as MediaStream)
    vi.mocked(captureFromMediaStream).mockResolvedValue({ stop: captureStop })
    vi.mocked(createRoutedTabLocalPlayback).mockResolvedValue({ stop: localStop, setLevel: localSetLevel })
    useScenePlaybackStore().masterVolume = 50
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  describe('tabs', () => {
    it('opens the default tab on first activation, shows it and reports its bounds', async () => {
      await mountBrowser()

      expect(createBrowserView).toHaveBeenCalledWith(DEFAULT_URL)
      expect(showBrowserView).toHaveBeenCalledWith(1)
      expect(setBrowserViewBounds).toHaveBeenCalledWith(1, { x: 10, y: 81, width: 800, height: 600 })
      expect(tabPills()).toHaveLength(1)
      expect((wrapper!.find('.url-input').element as HTMLInputElement).value).toBe(DEFAULT_URL)
      // The default tab cannot be closed.
      expect(tabPills()[0]!.find('.browser-tab-close').exists()).toBe(false)
    })

    it('opens a new blank tab, hides the previous one and makes the new one active', async () => {
      await mountBrowser()

      await openNewTab(2)

      expect(createBrowserView).toHaveBeenLastCalledWith('about:blank')
      expect(hideBrowserView).toHaveBeenCalledWith(1)
      expect(showBrowserView).toHaveBeenCalledWith(2)
      expect(tabPills()).toHaveLength(2)
      expect(tabPills()[1]!.classes()).toContain('browser-tab-pill-active')
    })

    it('switching tabs hides the old view, shows the new one and updates the URL bar', async () => {
      await mountBrowser()
      await openNewTab(2)
      vi.mocked(hideBrowserView).mockClear()
      vi.mocked(showBrowserView).mockClear()
      vi.mocked(setBrowserViewBounds).mockClear()

      await tabPills()[0]!.trigger('click')
      await flush()

      expect(hideBrowserView).toHaveBeenCalledWith(2)
      expect(showBrowserView).toHaveBeenCalledWith(1)
      expect(setBrowserViewBounds).toHaveBeenCalledWith(1, expect.any(Object))
      expect(tabPills()[0]!.classes()).toContain('browser-tab-pill-active')
      expect((wrapper!.find('.url-input').element as HTMLInputElement).value).toBe(DEFAULT_URL)
    })

    it('clicking the already active tab does nothing', async () => {
      await mountBrowser()
      vi.mocked(hideBrowserView).mockClear()

      await tabPills()[0]!.trigger('click')
      await flush()

      expect(hideBrowserView).not.toHaveBeenCalled()
    })

    it('closing the active tab destroys its view and falls back to the last remaining tab', async () => {
      await mountBrowser()
      await openNewTab(2)

      await tabPills()[1]!.find('.browser-tab-close').trigger('click')
      await flush()

      expect(destroyBrowserView).toHaveBeenCalledWith(2)
      expect(tabPills()).toHaveLength(1)
      expect(tabPills()[0]!.classes()).toContain('browser-tab-pill-active')
      expect(showBrowserView).toHaveBeenLastCalledWith(1)
    })

    it('closing an inactive tab keeps the active one', async () => {
      await mountBrowser()
      await openNewTab(2)
      await tabPills()[0]!.trigger('click')
      await flush()

      await tabPills()[1]!.find('.browser-tab-close').trigger('click')
      await flush()

      expect(destroyBrowserView).toHaveBeenCalledWith(2)
      expect(tabPills()).toHaveLength(1)
      expect(tabPills()[0]!.classes()).toContain('browser-tab-pill-active')
    })

    it('reports the active tab\'s bounds again on resize', async () => {
      await mountBrowser()
      vi.mocked(setBrowserViewBounds).mockClear()

      resizeCallback!()
      await flush()

      expect(setBrowserViewBounds).toHaveBeenCalledWith(1, { x: 10, y: 81, width: 800, height: 600 })
    })

    it('hides the active view when leaving the Browser and shows it again on return', async () => {
      await mountBrowser()
      vi.mocked(showBrowserView).mockClear()

      showBrowser.value = false
      await flush()
      expect(hideBrowserView).toHaveBeenCalledWith(1)

      showBrowser.value = true
      await flush()
      expect(showBrowserView).toHaveBeenCalledWith(1)
      expect(createBrowserView).toHaveBeenCalledTimes(1)
    })

    it('destroys every tab on unmount', async () => {
      await mountBrowser()
      await openNewTab(2)

      wrapper!.unmount()
      wrapper = null
      await flush()

      expect(destroyBrowserView).toHaveBeenCalledWith(1)
      expect(destroyBrowserView).toHaveBeenCalledWith(2)
    })

    it('follows navigation, title, favicon and media events for its tabs', async () => {
      await mountBrowser()

      browserEvents.get('browserView:didNavigate')!(1, 'https://example.com/a')
      browserEvents.get('browserView:titleUpdated')!('1', 'Example')
      browserEvents.get('browserView:faviconUpdated')!(1, 'https://example.com/icon.png')
      browserEvents.get('browserView:mediaPlaying')!(1, true)
      // Events for unknown tabs are ignored.
      browserEvents.get('browserView:titleUpdated')!(99, 'Other')
      browserEvents.get('browserView:didNavigate')!('not-a-number', 'https://nope.test')
      await nextTick()

      const pill = tabPills()[0]!
      expect(pill.find('.browser-tab-title').text()).toBe('Example')
      expect(pill.find('img.browser-tab-favicon').attributes('src')).toBe('https://example.com/icon.png')
      expect((wrapper!.find('.url-input').element as HTMLInputElement).value).toBe('https://example.com/a')

      browserEvents.get('browserView:titleUpdated')!(1, '')
      browserEvents.get('browserView:faviconUpdated')!(1, null)
      await nextTick()
      expect(pill.find('.browser-tab-title').text()).toBe('https://example.com/a')
      expect(pill.find('img.browser-tab-favicon').exists()).toBe(false)
    })

    it('logs a [browser] error when a tab cannot be opened', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => {})
      vi.mocked(createBrowserView).mockRejectedValueOnce(new Error('boom'))

      await mountBrowser()

      expect(error).toHaveBeenCalledWith('[browser] Failed to open tab:', expect.any(Error))
      expect(tabPills()).toHaveLength(0)
      expect(wrapper!.find('.browser-empty-text').text()).toContain('Browse the web')
    })

    it.each([
      ['.btn-open-tab:not(.btn-open-tab-secondary)', 'https://www.youtube.com'],
      ['.btn-open-tab-secondary', 'https://open.spotify.com'],
    ])('opens a site from the empty state (%s)', async (selector, url) => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      vi.mocked(createBrowserView).mockRejectedValueOnce(new Error('boom'))
      await mountBrowser()

      await wrapper!.find(selector).trigger('click')
      await flush()

      expect(createBrowserView).toHaveBeenLastCalledWith(url)
      expect(tabPills()).toHaveLength(1)
    })
  })

  describe('navigation', () => {
    it('back, forward and reload act on the active tab', async () => {
      await mountBrowser()

      await button('Go back').trigger('click')
      await button('Go forward').trigger('click')
      await button('Reload page').trigger('click')

      expect(browserViewGoBack).toHaveBeenCalledWith(1)
      expect(browserViewGoForward).toHaveBeenCalledWith(1)
      expect(browserViewReload).toHaveBeenCalledWith(1)
    })

    it('submitting a URL with a scheme loads it as typed', async () => {
      await mountBrowser()

      await wrapper!.find('.url-input').setValue('http://example.com/page')
      await wrapper!.find('.url-form').trigger('submit')

      expect(loadBrowserViewURL).toHaveBeenCalledWith(1, 'http://example.com/page')
    })

    it('submitting a URL without a scheme prefixes https://', async () => {
      await mountBrowser()

      await wrapper!.find('.url-input').setValue('  example.com  ')
      await wrapper!.find('.url-form').trigger('submit')

      expect(loadBrowserViewURL).toHaveBeenCalledWith(1, 'https://example.com')
      expect((wrapper!.find('.url-input').element as HTMLInputElement).value).toBe('https://example.com')
    })

    it('submitting an empty URL does nothing', async () => {
      await mountBrowser()

      await wrapper!.find('.url-input').setValue('   ')
      await wrapper!.find('.url-form').trigger('submit')

      expect(loadBrowserViewURL).not.toHaveBeenCalled()
    })
  })

  describe('bookmarks', () => {
    const saved = [
      { name: 'Tabletop Audio', url: 'https://tabletopaudio.com', favicon: 'https://tabletopaudio.com/icon.png' },
      { name: 'Example', url: 'https://example.com' },
    ]

    it('shows stored bookmarks with their favicons', async () => {
      vi.mocked(listBookmarks).mockResolvedValue(saved)
      await mountBrowser()

      const items = wrapper!.findAll('.bookmark-item')
      expect(items).toHaveLength(2)
      expect(items[0]!.find('.bookmark-name').text()).toBe('Tabletop Audio')
      expect(items[0]!.find('img.bookmark-favicon').attributes('src')).toBe('https://tabletopaudio.com/icon.png')
      expect(items[1]!.find('img.bookmark-favicon').exists()).toBe(false)
    })

    it('treats a failed bookmark load as no bookmarks', async () => {
      vi.mocked(listBookmarks).mockRejectedValue(new Error('nope'))
      await mountBrowser()

      expect(wrapper!.find('.bookmarks-bar').exists()).toBe(false)
    })

    it('bookmarks the current page with its title and favicon, then removes it again', async () => {
      await mountBrowser()
      browserEvents.get('browserView:titleUpdated')!(1, 'Hibiki')
      browserEvents.get('browserView:faviconUpdated')!(1, 'https://phyberapex.github.io/favicon.ico')
      await nextTick()

      await button('Bookmark this page').trigger('click')
      await flush()

      expect(saveBookmarks).toHaveBeenLastCalledWith([
        { name: 'Hibiki', url: DEFAULT_URL, favicon: 'https://phyberapex.github.io/favicon.ico' },
      ])
      expect(button('Remove bookmark').text()).toBe('★')
      expect(wrapper!.find('.bookmark-name').text()).toBe('Hibiki')

      await wrapper!.find('.toolbar-btn-bookmark').trigger('click')
      await flush()

      expect(saveBookmarks).toHaveBeenLastCalledWith([])
      expect(wrapper!.find('.bookmarks-bar').exists()).toBe(false)
    })

    it('removing a bookmark from the bar persists the rest', async () => {
      vi.mocked(listBookmarks).mockResolvedValue(saved.map(b => ({ ...b })))
      await mountBrowser()

      await wrapper!.findAll('.bookmark-remove')[0]!.trigger('click')
      await flush()

      expect(saveBookmarks).toHaveBeenCalledWith([{ name: 'Example', url: 'https://example.com', favicon: undefined }])
      expect(wrapper!.findAll('.bookmark-item')).toHaveLength(1)
    })

    it('swallows a failed save', async () => {
      vi.mocked(listBookmarks).mockResolvedValue(saved.map(b => ({ ...b })))
      vi.mocked(saveBookmarks).mockRejectedValue(new Error('disk full'))
      await mountBrowser()

      await wrapper!.findAll('.bookmark-remove')[0]!.trigger('click')
      await flush()

      expect(wrapper!.findAll('.bookmark-item')).toHaveLength(1)
    })

    it('clicking a bookmark opens it in a new tab', async () => {
      vi.mocked(listBookmarks).mockResolvedValue(saved.map(b => ({ ...b })))
      await mountBrowser()

      await wrapper!.findAll('.bookmark-item-main')[1]!.trigger('click')
      await flush()

      expect(createBrowserView).toHaveBeenLastCalledWith('https://example.com')
      expect(tabPills()).toHaveLength(2)
    })

    it('renames a bookmark on Enter and persists it', async () => {
      vi.mocked(listBookmarks).mockResolvedValue(saved.map(b => ({ ...b })))
      await mountBrowser()

      await wrapper!.findAll('.bookmark-edit')[1]!.trigger('click')
      await flush()
      const input = wrapper!.find('.bookmark-rename-input')
      expect(document.activeElement).toBe(input.element)
      // Clicking the bookmark while renaming does not open it.
      await wrapper!.findAll('.bookmark-item-main')[1]!.trigger('click')
      expect(createBrowserView).toHaveBeenCalledTimes(1)

      await input.setValue('  Renamed  ')
      await input.trigger('keydown', { key: 'Enter' })
      await flush()

      expect(saveBookmarks).toHaveBeenLastCalledWith([
        saved[0],
        { name: 'Renamed', url: 'https://example.com', favicon: undefined },
      ])
      expect(wrapper!.find('.bookmark-rename-input').exists()).toBe(false)
      expect(wrapper!.findAll('.bookmark-name')[1]!.text()).toBe('Renamed')
    })

    it('a blank rename falls back to the URL', async () => {
      vi.mocked(listBookmarks).mockResolvedValue(saved.map(b => ({ ...b })))
      await mountBrowser()

      await wrapper!.findAll('.bookmark-edit')[1]!.trigger('click')
      const input = wrapper!.find('.bookmark-rename-input')
      await input.setValue('   ')
      await input.trigger('blur')
      await flush()

      expect(wrapper!.findAll('.bookmark-name')[1]!.text()).toBe('https://example.com')
    })

    it('escape cancels a rename without saving', async () => {
      vi.mocked(listBookmarks).mockResolvedValue(saved.map(b => ({ ...b })))
      await mountBrowser()

      await wrapper!.findAll('.bookmark-edit')[0]!.trigger('click')
      const input = wrapper!.find('.bookmark-rename-input')
      await input.setValue('Nope')
      await input.trigger('keydown', { key: 'Escape' })
      await flush()

      expect(saveBookmarks).not.toHaveBeenCalled()
      expect(wrapper!.findAll('.bookmark-name')[0]!.text()).toBe('Tabletop Audio')
    })

    it('removing the bookmark being renamed ends the rename', async () => {
      vi.mocked(listBookmarks).mockResolvedValue(saved.map(b => ({ ...b })))
      await mountBrowser()

      await wrapper!.findAll('.bookmark-edit')[0]!.trigger('click')
      await wrapper!.findAll('.bookmark-remove')[0]!.trigger('click')
      await flush()

      expect(wrapper!.find('.bookmark-rename-input').exists()).toBe(false)
      expect(wrapper!.findAll('.bookmark-item')).toHaveLength(1)
    })

    it('offers bookmarks in the empty state, renamable and openable', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      vi.mocked(listBookmarks).mockResolvedValue(saved.map(b => ({ ...b })))
      vi.mocked(createBrowserView).mockRejectedValueOnce(new Error('boom'))
      await mountBrowser()

      const items = wrapper!.findAll('.empty-bookmark-item')
      expect(items).toHaveLength(2)
      expect(items[0]!.find('img.empty-bookmark-favicon').attributes('src')).toBe('https://tabletopaudio.com/icon.png')

      await wrapper!.findAll('.empty-bookmark-edit')[0]!.trigger('click')
      const input = wrapper!.find('.empty-bookmark-rename-input')
      await input.setValue('TTA')
      await input.trigger('keydown', { key: 'Enter' })
      await flush()
      expect(wrapper!.findAll('.empty-bookmark-name')[0]!.text()).toBe('TTA')

      await wrapper!.findAll('.empty-bookmark-item')[1]!.trigger('click')
      await flush()
      expect(createBrowserView).toHaveBeenLastCalledWith('https://example.com')
    })
  })

  describe('routed Tabs under a Discord Target', () => {
    beforeEach(() => joinDiscord())

    it('routing the active tab streams that tab\'s capture as browser-<tabId>', async () => {
      await mountBrowser()
      expect(routeButton().text()).toContain('Stream')
      expect(routeButton().attributes('title')).toBe('Stream audio to Discord')

      await routeButton().trigger('click')
      await flush()

      expect(getBrowserViewMediaSourceId).toHaveBeenCalledWith(1)
      expect(startEffectStream).toHaveBeenCalledWith('g1', 'browser-1', 50)
      expect(captureTabStream).toHaveBeenCalledWith('source-1')
      expect(captureFromMediaStream).toHaveBeenCalledTimes(1)
      expect(routeButton().text()).toContain('Stop')
      expect(routeButton().attributes('title')).toBe('Stop streaming audio')
      expect(tabPills()[0]!.find('.browser-tab-streaming').attributes('title')).toBe('Streaming to Discord')
    })

    it('routing a second tab keeps the first one routed with its own stream', async () => {
      await mountBrowser()
      await routeButton().trigger('click')
      await flush()
      await openNewTab(2)

      await routeButton().trigger('click')
      await flush()

      expect(startEffectStream).toHaveBeenCalledWith('g1', 'browser-2', 50)
      expect(captureTabStream).toHaveBeenCalledWith('source-2')
      expect(stopEffectStream).not.toHaveBeenCalled()
      expect(useRoutedTabsStore().routedCount).toBe(2)
      expect(wrapper!.findAll('.browser-tab-streaming')).toHaveLength(2)
    })

    it('un-routing stops the capture and the stream', async () => {
      await mountBrowser()
      await routeButton().trigger('click')
      await flush()

      await routeButton().trigger('click')
      await flush()

      expect(captureStop).toHaveBeenCalled()
      expect(stopEffectStream).toHaveBeenCalledWith('g1', 'browser-1')
      expect(tabPills()[0]!.find('.browser-tab-streaming').exists()).toBe(false)
    })

    it('a Tab Volume change applies Tab Volume × master to the routed stream', async () => {
      await mountBrowser()
      await routeButton().trigger('click')
      await flush()

      await wrapper!.find('input[aria-label="Tab Volume"]').setValue('40')

      expect(setEffectStreamVolume).toHaveBeenCalledWith('g1', 'browser-1', 20)
      expect(wrapper!.find('.tab-volume-value').text()).toBe('40')
    })

    it('keeps a separate Tab Volume per tab', async () => {
      await mountBrowser()
      await wrapper!.find('input[aria-label="Tab Volume"]').setValue('30')
      await openNewTab(2)

      expect(wrapper!.find('.tab-volume-value').text()).toBe('100')
      await tabPills()[0]!.trigger('click')
      await flush()
      expect(wrapper!.find('.tab-volume-value').text()).toBe('30')
    })

    it('leaving the view keeps a routed tab streaming', async () => {
      await mountBrowser()
      await routeButton().trigger('click')
      await flush()

      showBrowser.value = false
      await flush()

      expect(captureStop).not.toHaveBeenCalled()
      expect(stopEffectStream).not.toHaveBeenCalled()
      expect(useRoutedTabsStore().isRouted(1)).toBe(true)
    })

    it('closing a routed tab ends its stream', async () => {
      await mountBrowser()
      await openNewTab(2)
      await routeButton().trigger('click')
      await flush()

      await tabPills()[1]!.find('.browser-tab-close').trigger('click')
      await flush()

      expect(captureStop).toHaveBeenCalled()
      expect(stopEffectStream).toHaveBeenCalledWith('g1', 'browser-2')
      expect(destroyBrowserView).toHaveBeenCalledWith(2)
    })

    it('a routing failure logs a [browser] error and leaves the tab un-routed', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => {})
      vi.mocked(startEffectStream).mockRejectedValueOnce(new Error('no voice'))
      await mountBrowser()

      await routeButton().trigger('click')
      await flush()

      expect(error).toHaveBeenCalledWith('[browser] could not route tab 1 to g1:', expect.any(Error))
      expect(routeButton().text()).toContain('Stream')
      expect(tabPills()[0]!.find('.browser-tab-streaming').exists()).toBe(false)
    })
  })

  describe('routed Tabs under the Local Target', () => {
    beforeEach(() => {
      usePlayerStore().activeTarget = 'local'
    })

    it('an un-routed tab plays raw: nothing is captured or muted', async () => {
      await mountBrowser()

      expect(routeButton().text()).toContain('Mix locally')
      expect(routeButton().attributes('title')).toBe('Mix this tab into the local output at Tab Volume × master')
      expect(captureTabStream).not.toHaveBeenCalled()
      expect(setBrowserViewAudioMuted).not.toHaveBeenCalled()
    })

    it('routing mixes the tab locally without a Discord stream', async () => {
      await mountBrowser()

      await routeButton().trigger('click')
      await flush()

      expect(captureTabStream).toHaveBeenCalledWith('source-1')
      expect(createRoutedTabLocalPlayback).toHaveBeenCalledWith(expect.anything(), 0.5)
      expect(setBrowserViewAudioMuted).toHaveBeenCalledWith(1, true)
      expect(startEffectStream).not.toHaveBeenCalled()
      expect(routeButton().attributes('title')).toBe('Play this tab raw again')
      expect(tabPills()[0]!.find('.browser-tab-streaming').attributes('title')).toBe('Mixed locally')

      await wrapper!.find('input[aria-label="Tab Volume"]').setValue('60')
      expect(localSetLevel).toHaveBeenCalledWith(0.3)
    })
  })

  it('disables routing while the active Target cannot play', async () => {
    const player = usePlayerStore()
    player.activeTarget = 'discord'
    await mountBrowser()

    expect(routeButton().attributes('disabled')).toBeDefined()
    expect(routeButton().attributes('title')).toBe('Join a voice channel first')
  })
})
