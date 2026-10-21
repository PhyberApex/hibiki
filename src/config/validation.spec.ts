import Joi from 'joi'
import { validationSchema } from './validation'

describe('validationSchema', () => {
  it('validates empty env', () => {
    const result = Joi.attempt({}, validationSchema)
    expect(result.HIBIKI_STORAGE_PATH).toBe('storage')
    expect(result.HIBIKI_DATA_PATH).toBe('storage/data/hibiki.json')
  })

  it('accepts DISCORD_TOKEN', () => {
    const result = Joi.attempt({ DISCORD_TOKEN: 'abc' }, validationSchema)
    expect(result.DISCORD_TOKEN).toBe('abc')
  })

  it('accepts custom storage path', () => {
    const result = Joi.attempt(
      { HIBIKI_STORAGE_PATH: '/custom' },
      validationSchema,
    )
    expect(result.HIBIKI_STORAGE_PATH).toBe('/custom')
  })

  it('ignores env keys it does not own', () => {
    const { error, value } = validationSchema.validate({ PATH: '/usr/bin', HOME: 42 })
    expect(error).toBeUndefined()
    expect(value).toMatchObject({ PATH: '/usr/bin', HOME: 42 })
  })

  it.each([
    'DISCORD_TOKEN',
    'HIBIKI_STORAGE_PATH',
    'HIBIKI_MUSIC_DIR',
    'HIBIKI_EFFECTS_DIR',
    'HIBIKI_WEB_DIST',
    'HIBIKI_DATA_PATH',
  ])('rejects a non-string or empty %s', (key) => {
    for (const value of [42, true, {}, ['a'], '']) {
      const { error } = validationSchema.validate({ [key]: value })
      expect(error?.details[0]?.path).toEqual([key])
    }
  })
})
