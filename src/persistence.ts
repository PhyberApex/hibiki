import type { Config } from './config'
import { dirname, join, resolve } from 'node:path'
import { createJsonFileStore, isPlainObject } from './json-file'

const CONFIG_FILENAME = 'app-config.json'

/**
 * Only the main process can build a real codec (it wraps Electron's
 * `safeStorage`), so it's injected rather than imported — this keeps
 * `src/` loadable under Jest without Electron present.
 */
export interface SecretCodec {
  available: boolean
  encrypt: (plaintext: string) => string
  decrypt: (ciphertext: string) => string
}

const NOOP_CODEC: SecretCodec = {
  available: false,
  encrypt: value => value,
  decrypt: value => value,
}

/** The only keys ever written to disk encrypted — see `agent-docs` issue #412. */
const SECRET_KEYS = new Set(['discord.token', 'vision.apiKey'])

const ENCRYPTED_PREFIX = 'enc:v1:'

function getConfigFilePath(config: Config): string {
  const dbPath = config.database.path
  const dir = resolve(process.cwd(), dirname(dbPath))
  return join(dir, CONFIG_FILENAME)
}

export function createAppConfig(config: Config, codec: SecretCodec = NOOP_CODEC) {
  const filePath = getConfigFilePath(config)
  const store = createJsonFileStore<Record<string, string>>(filePath, { defaultValue: {}, isValid: isPlainObject })

  return {
    async get(key: string): Promise<string | null> {
      const data = await store.read()
      const raw = data[key]
      if (raw == null)
        return null
      if (!SECRET_KEYS.has(key))
        return raw

      if (raw.startsWith(ENCRYPTED_PREFIX)) {
        try {
          return codec.decrypt(raw.slice(ENCRYPTED_PREFIX.length))
        }
        catch {
          // Undecryptable (e.g. written on another machine/user) — treat as not configured, not a crash.
          return null
        }
      }

      // Legacy plaintext value: hand it back as-is, and migrate it to encrypted storage if we can.
      if (codec.available) {
        const encrypted = ENCRYPTED_PREFIX + codec.encrypt(raw)
        await store.update(latest => ({ next: { ...latest, [key]: encrypted }, result: undefined }))
      }
      return raw
    },
    async set(key: string, value: string): Promise<void> {
      const toStore = SECRET_KEYS.has(key) && codec.available
        ? ENCRYPTED_PREFIX + codec.encrypt(value)
        : value
      return store.update(data => ({ next: { ...data, [key]: toStore }, result: undefined }))
    },
    /** Whether secret keys (`discord.token`, `vision.apiKey`) are being encrypted at rest right now. */
    secretsEncrypted: codec.available,
  }
}
