import type { ConfigService } from '@nestjs/config'
import { AppConfigService } from '../persistence/app-config.service'
import { PermissionConfigService } from './permission-config.service'

jest.mock('../persistence/app-config.service', () => ({
  AppConfigService: class MockAppConfigService {
    get = jest.fn().mockResolvedValue(null)
    set = jest.fn().mockResolvedValue(undefined)
  },
}))

const mockFile = JSON.stringify({
  allowedDiscordRoleIds: ['role-1', 'role-2'],
  allowedDiscordUserIds: ['user-1'],
})

jest.mock('node:fs', () => ({
  existsSync: () => true,
  readFileSync: () => mockFile,
}))

describe('permissionConfigService', () => {
  const configService = {
    get: jest.fn().mockReturnValue(undefined),
  } as unknown as ConfigService

  const appConfig = new (AppConfigService as unknown as new () => AppConfigService)()

  let service: PermissionConfigService

  beforeAll(async () => {
    service = new PermissionConfigService(configService, appConfig)
    await service.reload()
  })

  it('returns config with allowlists', () => {
    const config = service.getConfig()
    expect(config.allowedDiscordRoleIds).toEqual(['role-1', 'role-2'])
    expect(config.allowedDiscordUserIds).toEqual(['user-1'])
  })

  it('allows user when they have an allowed role', () => {
    expect(service.isAllowed(['role-1'], null)).toBe(true)
    expect(service.isAllowed(['other', 'role-2'], null)).toBe(true)
  })

  it('allows user when their id is in allowlist', () => {
    expect(service.isAllowed([], 'user-1')).toBe(true)
    expect(service.isAllowed(['any'], 'user-1')).toBe(true)
  })

  it('denies user when neither role nor user id is allowed', () => {
    expect(service.isAllowed(['other-role'], null)).toBe(false)
    expect(service.isAllowed([], 'other-user')).toBe(false)
  })

  it('allows no one when both allowlists are empty', async () => {
    const emptyService = new PermissionConfigService(configService, appConfig);
    (appConfig.get as jest.Mock).mockResolvedValueOnce(
      JSON.stringify({ allowedDiscordRoleIds: [], allowedDiscordUserIds: [] }),
    )
    await emptyService.reload()
    expect(emptyService.isAllowed([], null)).toBe(false)
    expect(emptyService.isAllowed(['any'], 'anyone')).toBe(false)
  })

  it('merges HIBIKI_E2E_ALLOW_BOT_ID and HIBIKI_ALLOWED_DISCORD_USER_IDS into allowlist', async () => {
    const configWithE2E = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'discord.e2eAllowBotId')
          return 'e2e-sidecar-id'
        return undefined
      }),
    } as unknown as ConfigService
    const origEnv = process.env.HIBIKI_ALLOWED_DISCORD_USER_IDS
    process.env.HIBIKI_ALLOWED_DISCORD_USER_IDS = 'extra-user-1, extra-user-2 '
    ;(appConfig.get as jest.Mock).mockResolvedValueOnce(
      JSON.stringify({ allowedDiscordRoleIds: [], allowedDiscordUserIds: [] }),
    )
    const svc = new PermissionConfigService(configWithE2E, appConfig)
    await svc.reload()
    const config = svc.getConfig()
    expect(config.allowedDiscordUserIds).toContain('e2e-sidecar-id')
    expect(config.allowedDiscordUserIds).toContain('extra-user-1')
    expect(config.allowedDiscordUserIds).toContain('extra-user-2')
    expect(svc.isAllowed([], 'e2e-sidecar-id')).toBe(true)
    expect(svc.isAllowed([], 'extra-user-1')).toBe(true)
    if (origEnv !== undefined)
      process.env.HIBIKI_ALLOWED_DISCORD_USER_IDS = origEnv
    else delete process.env.HIBIKI_ALLOWED_DISCORD_USER_IDS
  })
})
