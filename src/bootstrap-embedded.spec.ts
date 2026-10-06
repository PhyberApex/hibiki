import type { createDiscordClient } from './discord/discord-client'
import type { createPlayer } from './player/player'
import { createShutdownHandler } from './bootstrap-embedded'

type FakePlayer = Pick<ReturnType<typeof createPlayer>, 'destroyAll'>
type FakeDiscord = Pick<ReturnType<typeof createDiscordClient>, 'destroy'>

function createFakePlayer(destroyAll: jest.Mock = jest.fn().mockResolvedValue(undefined)): FakePlayer {
  return { destroyAll }
}

function createFakeDiscord(destroy: jest.Mock = jest.fn().mockResolvedValue(undefined)): FakeDiscord {
  return { destroy }
}

describe('createShutdownHandler', () => {
  // Per-guild error isolation during teardown (one manager's destroy()
  // throwing must not stop the rest) is `destroyAll`'s own contract — see
  // player.spec.ts's "destroyAll" tests. This only needs to check the
  // orchestration this handler adds on top: ordering and idempotency.
  it('destroys every guild manager before destroying the Discord client', async () => {
    const callOrder: string[] = []
    const player = createFakePlayer(jest.fn().mockImplementation(async () => {
      callOrder.push('player.destroyAll')
    }))
    const discord = createFakeDiscord(jest.fn().mockImplementation(async () => {
      callOrder.push('discord.destroy')
    }))

    await createShutdownHandler(player, discord)()

    expect(callOrder).toEqual(['player.destroyAll', 'discord.destroy'])
  })

  it('runs teardown exactly once and resolves every caller when called twice or concurrently', async () => {
    const player = createFakePlayer()
    const discord = createFakeDiscord()
    const close = createShutdownHandler(player, discord)

    const [first, second] = await Promise.all([close(), close()])
    await close()

    expect(first).toBeUndefined()
    expect(second).toBeUndefined()
    expect(player.destroyAll).toHaveBeenCalledTimes(1)
    expect(discord.destroy).toHaveBeenCalledTimes(1)
  })
})
