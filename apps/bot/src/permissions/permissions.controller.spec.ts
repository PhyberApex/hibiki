import type { TestingModule } from '@nestjs/testing'
import { BadRequestException } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { AppConfigService } from '../persistence/app-config.service'
import { PermissionConfigService } from './permission-config.service'
import { PermissionsController } from './permissions.controller'

describe('permissionsController', () => {
  let controller: PermissionsController
  let permissionConfig: jest.Mocked<PermissionConfigService>
  let appConfig: jest.Mocked<AppConfigService>

  const validConfig = {
    allowedDiscordRoleIds: ['role-1'],
    allowedDiscordUserIds: ['user-1'],
  }

  beforeEach(async () => {
    permissionConfig = {
      getConfig: jest.fn().mockReturnValue(validConfig),
      reload: jest.fn().mockResolvedValue(undefined),
      isAllowed: jest.fn(),
    } as unknown as jest.Mocked<PermissionConfigService>

    appConfig = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<AppConfigService>

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PermissionsController],
      providers: [
        { provide: PermissionConfigService, useValue: permissionConfig },
        { provide: AppConfigService, useValue: appConfig },
      ],
    }).compile()

    controller = module.get(PermissionsController)
  })

  it('getConfig returns config from PermissionConfigService', () => {
    const result = controller.getConfig()
    expect(result).toEqual(validConfig)
    expect(permissionConfig.getConfig).toHaveBeenCalled()
  })

  it('updateConfig validates body and updates config', async () => {
    const result = await controller.updateConfig(validConfig)
    expect(appConfig.set).toHaveBeenCalledWith(
      'permissions',
      JSON.stringify(validConfig),
    )
    expect(permissionConfig.reload).toHaveBeenCalled()
    expect(result).toEqual(validConfig)
    expect(permissionConfig.getConfig).toHaveBeenCalled()
  })

  it('updateConfig throws BadRequestException when body is null', async () => {
    await expect(controller.updateConfig(null)).rejects.toThrow(BadRequestException)
    await expect(controller.updateConfig(null)).rejects.toThrow(/Invalid config/)
    expect(appConfig.set).not.toHaveBeenCalled()
  })

  it('updateConfig throws when allowedDiscordRoleIds is not an array', async () => {
    await expect(
      controller.updateConfig({ allowedDiscordRoleIds: 'x', allowedDiscordUserIds: [] }),
    ).rejects.toThrow(BadRequestException)
    expect(appConfig.set).not.toHaveBeenCalled()
  })

  it('updateConfig throws when allowedDiscordUserIds is not an array', async () => {
    await expect(
      controller.updateConfig({ allowedDiscordRoleIds: [], allowedDiscordUserIds: 'y' }),
    ).rejects.toThrow(BadRequestException)
    expect(appConfig.set).not.toHaveBeenCalled()
  })

  it('updateConfig throws when role ids are not all strings', async () => {
    await expect(
      controller.updateConfig({
        allowedDiscordRoleIds: ['a', 123],
        allowedDiscordUserIds: [],
      }),
    ).rejects.toThrow(BadRequestException)
    expect(appConfig.set).not.toHaveBeenCalled()
  })

  it('updateConfig throws when user ids are not all strings', async () => {
    await expect(
      controller.updateConfig({
        allowedDiscordRoleIds: [],
        allowedDiscordUserIds: ['u', true],
      }),
    ).rejects.toThrow(BadRequestException)
    expect(appConfig.set).not.toHaveBeenCalled()
  })
})
