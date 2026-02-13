import * as Joi from 'joi'

export const validationSchema = Joi.object({
  DISCORD_TOKEN: Joi.string().min(1).required(),
  DISCORD_CLIENT_ID: Joi.string().min(1).required(),
  DISCORD_GUILD_ID: Joi.string().optional(),
  HIBIKI_PREFIX: Joi.string().min(1).default('!'),
  HIBIKI_STORAGE_PATH: Joi.string().default('storage'),
  HIBIKI_MUSIC_DIR: Joi.string().default('storage/music'),
  HIBIKI_EFFECTS_DIR: Joi.string().default('storage/effects'),
  HIBIKI_WEB_DIST: Joi.string().default('apps/bot/web-dist'),
  HIBIKI_DB_PATH: Joi.string().default('storage/data/hibiki.sqlite'),
})
