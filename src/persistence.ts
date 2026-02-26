import type { Config } from './config'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

const CONFIG_FILENAME = 'app-config.json'

function getConfigFilePath(config: Config): string {
  const dbPath = config.database.path
  const dir = resolve(process.cwd(), dirname(dbPath))
  return join(dir, CONFIG_FILENAME)
}

async function readData(filePath: string): Promise<Record<string, string>> {
  try {
    const raw = await readFile(filePath, 'utf-8')
    const data = JSON.parse(raw) as Record<string, string>
    return typeof data === 'object' && data !== null ? data : {}
  }
  catch {
    return {}
  }
}

async function writeData(filePath: string, data: Record<string, string>): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8')
}

export function createAppConfig(config: Config) {
  const filePath = getConfigFilePath(config)

  return {
    async get(key: string): Promise<string | null> {
      const data = await readData(filePath)
      return data[key] ?? null
    },
    async set(key: string, value: string): Promise<void> {
      const data = await readData(filePath)
      data[key] = value
      await writeData(filePath, data)
    },
  }
}
