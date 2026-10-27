import type { RegistryEntry, RegistryIndex } from '@/api/registry'
import type { Scene } from '@/api/scenes'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getRegistryIndex, installFromRegistry } from '@/api/registry'
import { trackUsage } from '@/api/usage-stats'
import RegistryBrowser from './RegistryBrowser.vue'

vi.mock('@/api/registry', () => ({
  getRegistryIndex: vi.fn(),
  installFromRegistry: vi.fn(),
}))

vi.mock('@/api/usage-stats', () => ({
  trackUsage: vi.fn(),
}))

function entry(slug: string, overrides: Partial<RegistryEntry> = {}): RegistryEntry {
  return {
    name: slug.toUpperCase(),
    slug,
    description: `${slug} description`,
    author: 'someone',
    version: '1.0.0',
    tags: [],
    category: 'fantasy',
    audioBundled: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    scene: { music: [], ambience: [], effects: [] },
    ...overrides,
  }
}

function index(scenes: RegistryEntry[]): RegistryIndex {
  return { version: 1, updatedAt: '2026-01-01T00:00:00Z', scenes }
}

function scene(id: string, name: string): Scene {
  return {
    id,
    name,
    ambience: [],
    music: [],
    effects: [],
    createdAt: '',
    updatedAt: '',
  }
}

const tavern = entry('tavern', {
  name: 'Cozy Tavern',
  author: 'Bard',
  description: 'Fireplace and lute.',
  tags: ['town', 'calm'],
})
const dungeon = entry('dungeon', {
  name: 'Dark Dungeon',
  author: 'Lich',
  description: 'Dripping water.',
  tags: ['underground'],
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

async function mountLoaded(scenes: RegistryEntry[] = [tavern, dungeon]) {
  vi.mocked(getRegistryIndex).mockResolvedValue(index(scenes))
  const wrapper = mount(RegistryBrowser)
  await flushPromises()
  return wrapper
}

function entryNames(wrapper: ReturnType<typeof mount>) {
  return wrapper.findAll('.registry-entry-name').map(n => n.text())
}

function refreshButton(wrapper: ReturnType<typeof mount>) {
  return wrapper.find('.registry-toolbar button')
}

function installButton(wrapper: ReturnType<typeof mount>, name: string) {
  const row = wrapper.findAll('.registry-entry').find(r => r.find('.registry-entry-name').text() === name)
  if (!row)
    throw new Error(`no entry named ${name}`)
  return row.find('.btn-install')
}

describe('registryBrowser', () => {
  beforeEach(() => {
    vi.mocked(getRegistryIndex).mockReset()
    vi.mocked(installFromRegistry).mockReset()
    vi.mocked(trackUsage).mockReset()
  })

  it('is a labelled dialog', async () => {
    const wrapper = await mountLoaded()
    expect(wrapper.find('[role="dialog"]').attributes('aria-label')).toBe('Browse Community Scenes')
  })

  it('shows a loading state until the index arrives', async () => {
    const pending = deferred<RegistryIndex>()
    vi.mocked(getRegistryIndex).mockReturnValue(pending.promise)
    const wrapper = mount(RegistryBrowser)
    await flushPromises()
    expect(getRegistryIndex).toHaveBeenCalledWith(false)
    expect(wrapper.text()).toContain('Loading registry...')
    const refresh = refreshButton(wrapper)
    expect(refresh.text()).toBe('...')
    expect(refresh.attributes('disabled')).toBeDefined()

    pending.resolve(index([tavern]))
    await flushPromises()
    expect(wrapper.text()).not.toContain('Loading registry...')
    expect(refresh.text()).toBe('Refresh')
    expect(refresh.attributes('disabled')).toBeUndefined()
  })

  it('renders each entry with its name, author, description and tags', async () => {
    const wrapper = await mountLoaded()
    expect(entryNames(wrapper)).toEqual(['Cozy Tavern', 'Dark Dungeon'])
    const first = wrapper.findAll('.registry-entry')[0]!
    expect(first.find('.registry-entry-author').text()).toBe('by Bard')
    expect(first.find('.registry-entry-desc').text()).toBe('Fireplace and lute.')
    expect(first.findAll('.registry-tag').map(t => t.text())).toEqual(['town', 'calm'])
  })

  it('omits the tag row for an entry without tags', async () => {
    const wrapper = await mountLoaded([
      entry('bare'),
    ])
    expect(wrapper.find('.registry-entry-tags').exists()).toBe(false)
  })

  it('shows an empty state when the registry has no scenes', async () => {
    const wrapper = await mountLoaded([])
    expect(wrapper.text()).toContain('No scenes in the registry yet.')
    expect(wrapper.find('.registry-list').exists()).toBe(false)
  })

  describe('search', () => {
    it.each([
      [
        'name',
        'tavern',
        ['Cozy Tavern'],
      ],
      [
        'author',
        'LICH',
        ['Dark Dungeon'],
      ],
      [
        'description',
        'lute',
        ['Cozy Tavern'],
      ],
      [
        'tag',
        'undergr',
        ['Dark Dungeon'],
      ],
    ])('filters by %s, case-insensitively', async (_field, query, expected) => {
      const wrapper = await mountLoaded()
      await wrapper.find('.registry-search').setValue(query)
      expect(entryNames(wrapper)).toEqual(expected)
    })

    it('ignores surrounding whitespace and treats a blank query as no filter', async () => {
      const wrapper = await mountLoaded()
      await wrapper.find('.registry-search').setValue('  dungeon  ')
      expect(entryNames(wrapper)).toEqual(['Dark Dungeon'])
      await wrapper.find('.registry-search').setValue('   ')
      expect(entryNames(wrapper)).toEqual(['Cozy Tavern', 'Dark Dungeon'])
    })

    it('says so when nothing matches', async () => {
      const wrapper = await mountLoaded()
      await wrapper.find('.registry-search').setValue('spaceship')
      expect(wrapper.text()).toContain('No scenes match your search.')
      expect(wrapper.text()).not.toContain('No scenes in the registry yet.')
    })
  })

  describe('load errors', () => {
    it('shows the error message and retries with a forced refresh', async () => {
      vi.mocked(getRegistryIndex).mockRejectedValueOnce(new Error('Network down'))
      const wrapper = mount(RegistryBrowser)
      await flushPromises()
      expect(wrapper.find('.registry-empty').text()).toContain('Network down')
      expect(wrapper.find('.registry-list').exists()).toBe(false)

      vi.mocked(getRegistryIndex).mockResolvedValueOnce(index([tavern]))
      const retry = wrapper.findAll('button').find(b => b.text() === 'Retry')!
      await retry.trigger('click')
      await flushPromises()
      expect(getRegistryIndex).toHaveBeenLastCalledWith(true)
      expect(wrapper.text()).not.toContain('Network down')
      expect(entryNames(wrapper)).toEqual(['Cozy Tavern'])
    })

    it('falls back to a generic message for a non-Error rejection', async () => {
      vi.mocked(getRegistryIndex).mockRejectedValueOnce('nope')
      const wrapper = mount(RegistryBrowser)
      await flushPromises()
      expect(wrapper.find('.registry-empty').text()).toContain('Failed to load registry')
    })
  })

  it('refresh re-fetches the index bypassing the cache', async () => {
    const wrapper = await mountLoaded([tavern])
    vi.mocked(getRegistryIndex).mockResolvedValueOnce(index([tavern, dungeon]))
    await refreshButton(wrapper).trigger('click')
    await flushPromises()
    expect(getRegistryIndex).toHaveBeenLastCalledWith(true)
    expect(entryNames(wrapper)).toEqual(['Cozy Tavern', 'Dark Dungeon'])
  })

  it('keeps showing the current entries while a refresh is in flight', async () => {
    const wrapper = await mountLoaded([tavern])
    const pending = deferred<RegistryIndex>()
    vi.mocked(getRegistryIndex).mockReturnValueOnce(pending.promise)
    await refreshButton(wrapper).trigger('click')
    expect(wrapper.text()).not.toContain('Loading registry...')
    expect(entryNames(wrapper)).toEqual(['Cozy Tavern'])
    expect(refreshButton(wrapper).text()).toBe('...')
    expect(refreshButton(wrapper).attributes('disabled')).toBeDefined()
    pending.resolve(index([tavern]))
    await flushPromises()
  })

  describe('install', () => {
    it('installs the entry, tracks it, reports success and emits the new scene id', async () => {
      const wrapper = await mountLoaded()
      vi.mocked(installFromRegistry).mockResolvedValue(scene('scene-1', 'Cozy Tavern'))
      await installButton(wrapper, 'Cozy Tavern').trigger('click')
      await flushPromises()
      expect(installFromRegistry).toHaveBeenCalledWith('tavern')
      expect(trackUsage).toHaveBeenCalledWith({
        name: 'registry-install',
        data: { entryId: 'tavern' },
      })
      const message = wrapper.find('.status-message')
      expect(message.text()).toBe('Installed "Cozy Tavern"')
      expect(message.classes()).toContain('status-message-success')
      expect(wrapper.emitted('installed')).toEqual([
        ['scene-1'],
      ])
    })

    it('disables only the pending entry\'s button until the install settles', async () => {
      const wrapper = await mountLoaded()
      const pending = deferred<Scene>()
      vi.mocked(installFromRegistry).mockReturnValue(pending.promise)
      await installButton(wrapper, 'Cozy Tavern').trigger('click')

      expect(installButton(wrapper, 'Cozy Tavern').text()).toBe('...')
      expect(installButton(wrapper, 'Cozy Tavern').attributes('disabled')).toBeDefined()
      expect(installButton(wrapper, 'Dark Dungeon').text()).toBe('Install')
      expect(installButton(wrapper, 'Dark Dungeon').attributes('disabled')).toBeUndefined()

      pending.resolve(scene('scene-1', 'Cozy Tavern'))
      await flushPromises()
      expect(installButton(wrapper, 'Cozy Tavern').text()).toBe('Install')
      expect(installButton(wrapper, 'Cozy Tavern').attributes('disabled')).toBeUndefined()
    })

    it('reports a failed install with the error message and emits nothing', async () => {
      const wrapper = await mountLoaded()
      vi.mocked(installFromRegistry).mockRejectedValue(new Error('Bundle is corrupt'))
      await installButton(wrapper, 'Dark Dungeon').trigger('click')
      await flushPromises()
      const message = wrapper.find('.status-message')
      expect(message.text()).toBe('Bundle is corrupt')
      expect(message.classes()).toContain('status-message-error')
      expect(wrapper.emitted('installed')).toBeUndefined()
      expect(trackUsage).not.toHaveBeenCalled()
      expect(installButton(wrapper, 'Dark Dungeon').attributes('disabled')).toBeUndefined()
    })

    it('falls back to a generic message for a non-Error rejection', async () => {
      const wrapper = await mountLoaded()
      vi.mocked(installFromRegistry).mockRejectedValue('nope')
      await installButton(wrapper, 'Dark Dungeon').trigger('click')
      await flushPromises()
      expect(wrapper.find('.status-message').text()).toBe('Install failed')
    })

    it('clears the previous message when a new install starts', async () => {
      const wrapper = await mountLoaded()
      vi.mocked(installFromRegistry).mockRejectedValueOnce(new Error('Bundle is corrupt'))
      await installButton(wrapper, 'Dark Dungeon').trigger('click')
      await flushPromises()
      expect(wrapper.find('.status-message').exists()).toBe(true)

      const pending = deferred<Scene>()
      vi.mocked(installFromRegistry).mockReturnValueOnce(pending.promise)
      await installButton(wrapper, 'Cozy Tavern').trigger('click')
      expect(wrapper.find('.status-message').exists()).toBe(false)
      pending.resolve(scene('scene-1', 'Cozy Tavern'))
      await flushPromises()
    })
  })

  describe('closing', () => {
    it('emits close from the close button', async () => {
      const wrapper = await mountLoaded()
      await wrapper.find('button[aria-label="Close"]').trigger('click')
      expect(wrapper.emitted('close')).toHaveLength(1)
    })

    it('emits close when the backdrop is clicked, not the modal', async () => {
      const wrapper = await mountLoaded()
      await wrapper.find('.registry-modal').trigger('click')
      expect(wrapper.emitted('close')).toBeUndefined()
      await wrapper.find('.registry-overlay').trigger('click')
      expect(wrapper.emitted('close')).toHaveLength(1)
    })
  })
})
