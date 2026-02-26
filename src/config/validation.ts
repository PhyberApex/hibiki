import * as Joi from 'joi'

/** Validates only our env keys; other keys (e.g. PATH, HOME) are ignored so we can pass process.env. */
export const validationSchema = Joi.object({
  /** Optional when token is set via app Settings (stored in DB). */
  DISCORD_TOKEN: Joi.string().optional(),
  HIBIKI_STORAGE_PATH: Joi.string().default('storage'),
  HIBIKI_MUSIC_DIR: Joi.string().default('storage/music'),
  HIBIKI_EFFECTS_DIR: Joi.string().default('storage/effects'),
  HIBIKI_WEB_DIST: Joi.string().default('web-dist'),
  HIBIKI_DATA_PATH: Joi.string().default('storage/data/hibiki.json'),
}).unknown(true)
