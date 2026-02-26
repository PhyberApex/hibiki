import { resolve } from 'node:path'
import Joi from 'joi'
import { configuration } from './config/configuration'
import { validationSchema } from './config/validation'

function loadEnvFiles(): void {
  try {
    // eslint-disable-next-line ts/no-require-imports -- optional dependency
    const { config } = require('dotenv')
    const paths = [
      resolve(__dirname, '../../.env'),
      resolve(process.cwd(), '.env'),
    ]
    for (const p of paths)
      config({ path: p })
  }
  catch {
    // dotenv is optional — ignored when not installed
  }
}

export type Config = ReturnType<typeof configuration>

let cachedConfig: Config | null = null

export function getConfig(): Config {
  if (!cachedConfig) {
    loadEnvFiles()
    try {
      Joi.attempt(process.env, validationSchema, { stripUnknown: true })
    }
    catch {
      // Validation failed — proceed with raw process.env values
    }
    cachedConfig = configuration()
  }
  return cachedConfig
}
