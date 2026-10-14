import { createLogger } from './logger'

describe('createLogger', () => {
  const spies = {
    debug: jest.spyOn(console, 'debug').mockImplementation(() => {}),
    info: jest.spyOn(console, 'info').mockImplementation(() => {}),
    warn: jest.spyOn(console, 'warn').mockImplementation(() => {}),
    error: jest.spyOn(console, 'error').mockImplementation(() => {}),
  }

  afterEach(() => jest.clearAllMocks())
  afterAll(() => jest.restoreAllMocks())

  it.each(['debug', 'info', 'warn', 'error'] as const)('routes %s to the console method of the same level with the module tag', (level) => {
    const log = createLogger('player')

    log[level]('joined', { guildId: 'g1' })

    expect(spies[level]).toHaveBeenCalledWith('[player]', 'joined', { guildId: 'g1' })
    for (const other of Object.keys(spies).filter(k => k !== level) as (keyof typeof spies)[])
      expect(spies[other]).not.toHaveBeenCalled()
  })
})
