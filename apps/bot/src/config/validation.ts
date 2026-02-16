import * as Joi from 'joi'

export const validationSchema = Joi.object({
  DISCORD_TOKEN: Joi.string().min(1).required(),
  DISCORD_CLIENT_ID: Joi.string().min(1).required(),
  DISCORD_GUILD_ID: Joi.string().optional(),
  HIBIKI_PREFIX: Joi.string().min(1).default('!'),
  HIBIKI_E2E_ALLOW_BOT_ID: Joi.string().min(1).optional(),
  /** Comma-separated Discord user IDs to add to the allowlist (e.g. for E2E/CI without using the web UI). */
  HIBIKI_ALLOWED_DISCORD_USER_IDS: Joi.string().optional(),
  HIBIKI_STORAGE_PATH: Joi.string().default('storage'),
  HIBIKI_MUSIC_DIR: Joi.string().default('storage/music'),
  HIBIKI_EFFECTS_DIR: Joi.string().default('storage/effects'),
  HIBIKI_WEB_DIST: Joi.string().default('web-dist'),
  HIBIKI_DB_PATH: Joi.string().default('storage/data/hibiki.sqlite'),
})
