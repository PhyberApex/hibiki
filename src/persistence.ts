import type { Config } from './config'
import { dirname, join, resolve } from 'node:path'
import { createJsonFileStore, isPlainObject } from './json-file'
import { createLogger } from './logger'

const CONFIG_FILENAME = 'app-config.json'

/**
 * Only the main process can build a real codec (it wraps Electron's async
 * `safeStorage` API), so it's injected rather than imported — this keeps
 * `src/` loadable under Jest without Electron present. `available` is
 * resolved once at boot, before the codec is handed over.
 */
export interface SecretCodec {
  available: boolean
  encrypt: (plaintext: string) => Promise<string>
  decrypt: (ciphertext: string) => Promise<DecryptedSecret>
}

/** Mirrors `safeStorage.decryptStringAsync`: `shouldReEncrypt` means the key rotated, so the plaintext should be written back through `encrypt`. */
export interface DecryptedSecret {
  result: string
  shouldReEncrypt: boolean
}

const NOOP_CODEC: SecretCodec = {
  available: false,
  encrypt: async value => value,
  decrypt: async value => ({ result: value, shouldReEncrypt: false }),
}

/** The only keys ever written to disk encrypted — see `agent-docs` issue #412. */
const SECRET_KEYS = new Set(['discord.token', 'vision.apiKey', 'vision.openai.apiKey'])

/**
 * Keys whose values `set` may print to `hibiki.log`: settings, toggles and
 * ids a GM would not mind in a bug report. Everything else (secrets,
 * bookmarks, keys added later) is logged by name and length only (#639).
 */
const LOGGABLE_VALUE_KEYS = new Set([
  'accessibility',
  'hotkeys',
  'output.activeTarget',
  'output.local.device',
  'player.masterVolume.discord',
  'player.masterVolume.local',
  'scene.fadeLength',
  'storage.path',
  'updates',
  'usageStats',
  'vision.enabled',
  'vision.openai.baseUrl',
  'vision.openai.model',
  'vision.provider',
])

function describeSetForLog(key: string, value: string): string {
  if (SECRET_KEYS.has(key))
    return `Set "${key}" (secret, ${value ? 'non-empty' : 'cleared'})`
  if (!LOGGABLE_VALUE_KEYS.has(key))
    return `Set "${key}" (${value.length} chars)`
  return `Set "${key}" = ${value.length > 120
    ? `${value.slice(0, 117)}...`
    : value}`
}

const ENCRYPTED_PREFIX = 'enc:v1:'

function getConfigFilePath(config: Config): string {
  const dbPath = config.database.path
  const dir = resolve(process.cwd(), dirname(dbPath))
  return join(dir, CONFIG_FILENAME)
}

const log = createLogger('app-config')

export function createAppConfig(config: Config, codec: SecretCodec = NOOP_CODEC) {
  const filePath = getConfigFilePath(config)
  const store = createJsonFileStore<Record<string, string>>(filePath, { defaultValue: {}, isValid: isPlainObject })
  const encryptForStorage = async (plaintext: string) => ENCRYPTED_PREFIX + await codec.encrypt(plaintext)
  /** Writes `replacement` only if `key` still holds `expected`, so a `set` that landed meanwhile wins. */
  const replaceIfUnchanged = (key: string, expected: string, replacement: string) =>
    store.update(latest => latest[key] === expected
      ? {
          next: { ...latest, [key]: replacement },
          result: true,
        }
      : { next: latest, result: false, skipWrite: true })

  return {
    async get(key: string): Promise<string | null> {
      const data = await store.read()
      const raw = data[key]
      if (raw == null)
        return null
      if (!SECRET_KEYS.has(key))
        return raw

      if (raw.startsWith(ENCRYPTED_PREFIX)) {
        let decrypted: DecryptedSecret
        try {
          decrypted = await codec.decrypt(raw.slice(ENCRYPTED_PREFIX.length))
        }
        catch {
          // Undecryptable (e.g. written on another machine/user) — treat as not configured, not a crash.
          log.warn(`Stored secret "${key}" could not be decrypted on this machine; treating it as not configured`)
          return null
        }
        if (decrypted.shouldReEncrypt && codec.available) {
          try {
            const reEncrypted = await encryptForStorage(decrypted.result)
            if (await replaceIfUnchanged(key, raw, reEncrypted))
              log.info(`Re-encrypted secret "${key}" after an encryption key rotation`)
          }
          catch (err) {
            log.warn(`Could not re-encrypt secret "${key}" after an encryption key rotation; keeping the stored value`, err)
          }
        }
        return decrypted.result
      }

      // Legacy plaintext value: hand it back as-is, and migrate it to encrypted storage if we can.
      if (codec.available) {
        log.info(`Migrating plaintext secret "${key}" to encrypted storage`)
        const encrypted = await encryptForStorage(raw)
        if (await replaceIfUnchanged(key, raw, encrypted))
          log.info(`Migrated plaintext secret "${key}" to encrypted storage`)
        else
          log.info(`Skipped migrating plaintext secret "${key}": it was changed while being encrypted`)
      }
      return raw
    },
    async set(key: string, value: string): Promise<void> {
      const toStore = SECRET_KEYS.has(key) && codec.available
        ? await encryptForStorage(value)
        : value
      log.info(describeSetForLog(key, value))
      return store.update(data => ({
        next: { ...data, [key]: toStore },
        result: undefined,
      }))
    },
    /** Removes the key entirely (absent afterwards, not empty). */
    async delete(key: string): Promise<void> {
      log.info(`Deleted "${key}"`)
      return store.update((data) => {
        const { [key]: _removed, ...next } = data
        return { next, result: undefined }
      })
    },
    /** Whether secret keys (`discord.token`, `vision.apiKey`, `vision.openai.apiKey`) are being encrypted at rest right now. */
    secretsEncrypted: codec.available,
  }
}
