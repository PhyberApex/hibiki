import type { Config } from './config'
import { dirname, join, resolve } from 'node:path'
import { createJsonFileStore, isPlainObject } from './json-file'

const CONFIG_FILENAME = 'app-config.json'

function getConfigFilePath(config: Config): string {
  const dbPath = config.database.path
  const dir = resolve(process.cwd(), dirname(dbPath))
  return join(dir, CONFIG_FILENAME)
}

export function createAppConfig(config: Config) {
  const filePath = getConfigFilePath(config)
  const store = createJsonFileStore<Record<string, string>>(filePath, { defaultValue: {}, isValid: isPlainObject })

  return {
    async get(key: string): Promise<string | null> {
      const data = await store.read()
      return data[key] ?? null
    },
    async set(key: string, value: string): Promise<void> {
      return store.update(data => ({ next: { ...data, [key]: value }, result: undefined }))
    },
  }
}
