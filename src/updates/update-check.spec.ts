import type { FetchLike } from './update-check'
import { createUpdateCheck, isNewerVersion, LATEST_RELEASE_URL } from './update-check'

function release(tag: string, url = `https://github.com/PhyberApex/hibiki/releases/tag/${tag}`) {
  return { tag_name: tag, html_url: url }
}

function respond(body: unknown, status = 200): FetchLike {
  return jest.fn(async () => ({ ok: status >= 200 && status < 300, status, json: async () => body }))
}

function setup({ currentVersion = '1.6.0', fetch = respond(release('v1.7.0')), initial = {} as Record<string, string>, timeoutMs = 5000 } = {}) {
  const data = new Map(Object.entries(initial))
  const updates = createUpdateCheck({
    store: {
      get: async k => data.get(k) ?? null,
      set: async (k, v) => {
        data.set(k, v)
      },
    },
    currentVersion,
    fetch,
    timeoutMs,
  })
  return { data, updates, fetch }
}

describe('isNewerVersion', () => {
  it.each([
    ['1.7.0', '1.6.0', true],
    ['1.6.1', '1.6.0', true],
    ['2.0.0', '1.12.3', true],
    ['1.10.0', '1.9.0', true],
    ['1.6.0', '1.6.0', false],
    ['1.5.9', '1.6.0', false],
    ['1.6.0', '1.6.0-beta.1', true],
    ['1.6.0-beta.2', '1.6.0', false],
    ['not-a-version', '1.6.0', false],
  ])('%s newer than %s: %s', (candidate, current, expected) => {
    expect(isNewerVersion(candidate, current)).toBe(expected)
  })
})

describe('update check', () => {
  it('is enabled by default on a fresh install', async () => {
    expect(await setup().updates.getSettings()).toEqual({ enabled: true })
  })

  it('reports a newer release with its version and release page', async () => {
    const { updates, fetch } = setup()
    expect(await updates.check()).toEqual({
      version: '1.7.0',
      url: 'https://github.com/PhyberApex/hibiki/releases/tag/v1.7.0',
    })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(jest.mocked(fetch).mock.calls[0][0]).toBe(LATEST_RELEASE_URL)
  })

  it('reports nothing when already on the latest release', async () => {
    expect(await setup({ fetch: respond(release('v1.6.0')) }).updates.check()).toBeNull()
  })

  it('makes no request at all when turned off', async () => {
    const { updates, fetch } = setup()
    await updates.setEnabled(false)
    expect(await updates.getSettings()).toEqual({ enabled: false })
    expect(await updates.check()).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('stays quiet about a dismissed version, but not about a later one', async () => {
    const first = setup()
    await first.updates.dismiss('1.7.0')
    expect(await first.updates.check()).toBeNull()

    const later = setup({ initial: Object.fromEntries(first.data), fetch: respond(release('v1.8.0')) })
    expect(await later.updates.check()).toEqual(expect.objectContaining({ version: '1.8.0' }))
  })

  it('keeps the dismissed version when the toggle changes', async () => {
    const { updates } = setup()
    await updates.dismiss('1.7.0')
    await updates.setEnabled(false)
    await updates.setEnabled(true)
    expect(await updates.check()).toBeNull()
  })

  it('reports nothing when the request fails, errors or returns junk', async () => {
    const failing: FetchLike = jest.fn(async () => {
      throw new Error('offline')
    })
    expect(await setup({ fetch: failing }).updates.check()).toBeNull()
    expect(await setup({ fetch: respond({ message: 'rate limited' }, 403) }).updates.check()).toBeNull()
    expect(await setup({ fetch: respond({ nope: true }) }).updates.check()).toBeNull()
  })

  it('never links anywhere but GitHub', async () => {
    const fetch = respond(release('v1.7.0', 'https://evil.example/hibiki'))
    expect(await setup({ fetch }).updates.check()).toBeNull()
  })

  it('gives up after the timeout instead of hanging', async () => {
    const hanging: FetchLike = jest.fn((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new Error('aborted')))
    }))
    const { updates } = setup({ fetch: hanging, timeoutMs: 20 })
    expect(await updates.check()).toBeNull()
  })

  it('falls back to the default on a malformed stored setting', async () => {
    expect(await setup({ initial: { updates: '{nope' } }).updates.getSettings()).toEqual({ enabled: true })
  })
})
