import * as Joi from 'joi'
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
})
