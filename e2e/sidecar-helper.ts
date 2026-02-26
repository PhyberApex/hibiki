import type { Client, TextChannel } from 'discord.js'
import { Client as DiscordClient, Events, GatewayIntentBits } from 'discord.js'
import { e2eEnv, isSidecarConfigured } from './setup.js'

export async function createSidecarClient(): Promise<Client | null> {
  if (!isSidecarConfigured())
    return null
  const { sidecarToken } = e2eEnv
  const client = new DiscordClient({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildVoiceStates,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  })
  await client.login(sidecarToken)
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Sidecar login timeout')), 25_000)
    client.once(Events.ClientReady, () => {
      clearTimeout(t)
      resolve()
    })
  })
  return client
}

export function destroySidecarClient(client: Client | null): void {
  if (client)
    client.destroy()
}

/**
 * Send a command in the text channel and return Hibiki's reply content.
 * Requires Hibiki to be run with HIBIKI_E2E_ALLOW_BOT_ID set to the sidecar bot's user ID.
 */
export async function sendCommandAndGetReply(
  sidecar: Client,
  textChannelId: string,
  hibikiUserId: string,
  command: string,
  timeoutMs = 12_000,
): Promise<string> {
  const channel = (await sidecar.channels.fetch(textChannelId)) as TextChannel
  const ourMessage = await channel.send({ content: command })
  return new Promise<string>((resolve, reject) => {
    const collector = channel.createMessageCollector({
      filter: m =>
        m.author.id === hibikiUserId && m.reference?.messageId === ourMessage.id,
      max: 1,
      time: timeoutMs,
    })
    collector.on('collect', m => resolve(m.content))
    collector.on('end', (collected) => {
      if (collected.size === 0)
        reject(new Error(`No reply from Hibiki to "${command}" within ${timeoutMs}ms`))
    })
  })
}
