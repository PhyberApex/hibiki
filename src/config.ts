import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import Joi from 'joi'
import { configuration } from './config/configuration'
import { validationSchema } from './config/validation'
import { createLogger } from './logger'

const log = createLogger('config')

export interface LoadEnvFileOptions {
  /** `app.isPackaged`, injected by main: a packaged app reads no `.env` at all. */
  packaged: boolean
}

/**
 * Loads the repository-root `.env` for development builds and returns the path
 * it consulted (null in a packaged build). Never `process.cwd()`: a packaged
 * app's working directory is whatever the launcher left it as, and a `.env`
 * dropped there could repoint secrets and endpoints (#776). Values already in
 * the environment win, as `dotenv` never overrides them.
 */
export function loadEnvFile(options: LoadEnvFileOptions): string | null {
  if (options.packaged) {
    log.info('Packaged build: no .env file is read; settings come from Settings and the process environment')
    return null
  }
  // Compiled to dist/config.js and run as src/config.ts under Jest: one level up is the repo root either way.
  const path = resolve(__dirname, '..', '.env')
  if (!existsSync(path)) {
    log.info(`No .env at ${path}`)
    return path
  }
  try {
    // eslint-disable-next-line ts/no-require-imports -- optional dependency
    const { config } = require('dotenv')
    const result = config({ path, quiet: true })
    const keys = Object.keys(result.parsed ?? {})
    // Names only: values may be secrets.
    log.info(`Loaded .env from ${path} (${keys.length
      ? keys.join(', ')
      : 'no entries'}); variables already set in the environment keep their value`)
  }
  catch (err) {
    log.warn(`Could not load .env from ${path}:`, err)
  }
  return path
}

export type Config = ReturnType<typeof configuration>

/** Names (never values) of the secrets the environment supplies; each one wins over its stored counterpart. */
export function secretsFromEnvironment(config: Config): string[] {
  return [
    config.discord.token && 'DISCORD_TOKEN',
    config.vision.apiKey && 'HIBIKI_VISION_API_KEY',
    config.vision.openaiApiKey && 'HIBIKI_VISION_OPENAI_API_KEY',
  ].filter((name): name is string => Boolean(name))
}

let cachedConfig: Config | null = null

/**
 * The backend config, read once. The first call decides whether the
 * repository-root `.env` is loaded; without `packaged: false` it is not.
 */
export function getConfig(options: LoadEnvFileOptions = { packaged: true }): Config {
  if (!cachedConfig) {
    loadEnvFile(options)
    try {
      Joi.attempt(process.env, validationSchema, { stripUnknown: true })
    }
    catch {
      // Validation failed — proceed with raw process.env values
    }
    cachedConfig = configuration()
    const fromEnv = secretsFromEnvironment(cachedConfig)
    if (fromEnv.length)
      log.info(`Secrets from the environment, overriding Settings: ${fromEnv.join(', ')}`)
  }
  return cachedConfig
}
