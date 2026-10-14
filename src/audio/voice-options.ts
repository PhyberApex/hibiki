export interface VoiceOptions {
  /**
   * Whether to negotiate Discord's end-to-end voice encryption (DAVE). When
   * off, Discord downgrades the call to transport encryption only, which
   * every client still understands; this is a diagnostic switch for "bot is
   * speaking but nobody hears it", not something a GM should need to touch.
   */
  daveEncryption: boolean
}

export function resolveVoiceOptions(env: NodeJS.ProcessEnv = process.env): VoiceOptions {
  return {
    daveEncryption: (env.HIBIKI_DAVE_ENCRYPTION ?? '').trim().toLowerCase() !== 'off',
  }
}
