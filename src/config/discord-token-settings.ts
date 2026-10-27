import type { OutputTargetKind } from '../player/output-target'
import { createLogger } from '../logger'

const log = createLogger('config')

const TOKEN_KEY = 'discord.token'

export interface DiscordTokenStore {
  get: (key: string) => Promise<string | null>
  set: (key: string, value: string) => Promise<void>
  delete: (key: string) => Promise<void>
}

export interface DiscordStatus {
  tokenConfigured: boolean
  encrypted: boolean
  /** The token comes from `DISCORD_TOKEN`, which the app cannot remove. */
  fromEnvironment: boolean
}

export interface DiscordTokenSettingsDeps {
  store: DiscordTokenStore
  /** `DISCORD_TOKEN` from the environment; it wins over the stored token and cannot be cleared from the app. */
  envToken: string
  encrypted: boolean
  outputTargets: {
    getActive: () => Promise<OutputTargetKind>
    setActive: (kind: OutputTargetKind) => Promise<void>
  }
  discord: { logout: () => Promise<void> }
  player: { disconnectAllVoice: () => Promise<void> }
}

/** Whether the bot has a token to log in with, from the environment or the store. */
export async function isDiscordTokenConfigured(store: Pick<DiscordTokenStore, 'get'>, envToken: string): Promise<boolean> {
  return Boolean(envToken) || Boolean(await store.get(TOKEN_KEY))
}

export function createDiscordTokenSettings(deps: DiscordTokenSettingsDeps) {
  const { store, envToken, encrypted, outputTargets, discord, player } = deps

  async function getStatus(): Promise<DiscordStatus> {
    return {
      tokenConfigured: await isDiscordTokenConfigured(store, envToken),
      encrypted,
      fromEnvironment: Boolean(envToken),
    }
  }

  /** Stores a token; an empty or blank one is ignored, so a blank field never removes a token (that is `clearToken`). */
  async function setToken(token: unknown): Promise<DiscordStatus> {
    if (typeof token === 'string' && token.trim())
      await store.set(TOKEN_KEY, token.trim())
    else
      log.info('Ignored an empty Discord token; use Remove to clear the stored one')
    return getStatus()
  }

  /**
   * Removes the stored token: ends every voice connection, disconnects the
   * bot, deletes the key and makes Local the active Target if Discord was.
   * The Discord Target's master volume stays for the next token. Refused
   * while `DISCORD_TOKEN` is set: the bot would keep using it.
   */
  async function clearToken(): Promise<DiscordStatus> {
    if (envToken) {
      log.warn('Refused to remove the Discord token: it comes from DISCORD_TOKEN in the environment')
      throw new Error('The Discord token comes from the DISCORD_TOKEN environment variable. Unset it and restart Hibiki to remove it.')
    }
    log.info('Removing the Discord token')
    const wasActive = await outputTargets.getActive()
    try {
      await player.disconnectAllVoice()
    }
    catch (err) {
      log.error('Failed to end voice connections while removing the Discord token:', err)
    }
    try {
      await discord.logout()
    }
    catch (err) {
      log.error('Failed to disconnect the bot while removing the Discord token:', err)
    }
    await store.delete(TOKEN_KEY)
    if (wasActive === 'discord')
      await outputTargets.setActive('local')
    log.info(`Discord token removed${wasActive === 'discord'
      ? '; Local is now the active Output Target'
      : ''}`)
    return getStatus()
  }

  return { getStatus, setToken, clearToken }
}
