import type { AllowlistConfig } from './permission.types'
import { BadRequestException, Body, Controller, Get, Put } from '@nestjs/common'
import { AppConfigService } from '../persistence/app-config.service' // eslint-disable-line ts/consistent-type-imports
import { PermissionConfigService } from './permission-config.service' // eslint-disable-line ts/consistent-type-imports

const PERMISSIONS_KEY = 'permissions'

function validateAllowlist(candidate: unknown): candidate is AllowlistConfig {
  if (!candidate || typeof candidate !== 'object')
    return false
  const o = candidate as Record<string, unknown>
  if (!Array.isArray(o.allowedDiscordRoleIds))
    return false
  if (!Array.isArray(o.allowedDiscordUserIds))
    return false
  if (!o.allowedDiscordRoleIds.every(id => typeof id === 'string'))
    return false
  if (!o.allowedDiscordUserIds.every(id => typeof id === 'string'))
    return false
  return true
}

@Controller('permissions')
export class PermissionsController {
  constructor(
    private readonly permissionConfig: PermissionConfigService,
    private readonly appConfig: AppConfigService,
  ) {}

  @Get('config')
  getConfig() {
    return this.permissionConfig.getConfig()
  }

  @Put('config')
  async updateConfig(@Body() body: unknown) {
    if (!validateAllowlist(body)) {
      throw new BadRequestException(
        'Invalid config: expected { allowedDiscordRoleIds: string[], allowedDiscordUserIds: string[] }',
      )
    }
    await this.appConfig.set(PERMISSIONS_KEY, JSON.stringify(body))
    await this.permissionConfig.reload()
    return this.permissionConfig.getConfig()
  }
}
