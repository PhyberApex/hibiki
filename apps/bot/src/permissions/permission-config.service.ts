import type { OnModuleInit } from '@nestjs/common'
import type { ConfigService } from '@nestjs/config'
import type { AppConfigService } from '../persistence/app-config.service'
import type { AllowlistConfig } from './permission.types'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Injectable } from '@nestjs/common'

const PERMISSIONS_KEY = 'permissions'

function normalizeAllowlist(raw: unknown): AllowlistConfig {
  if (!raw || typeof raw !== 'object') {
    return { allowedDiscordRoleIds: [], allowedDiscordUserIds: [] }
  }
  const o = raw as Record<string, unknown>
  let roleIds: string[]
  let userIds: string[]
  if (Array.isArray(o.allowedDiscordRoleIds) || Array.isArray(o.allowedDiscordUserIds)) {
    roleIds = Array.isArray(o.allowedDiscordRoleIds)
      ? (o.allowedDiscordRoleIds as string[]).filter(id => typeof id === 'string')
      : []
    userIds = Array.isArray(o.allowedDiscordUserIds)
      ? (o.allowedDiscordUserIds as string[]).filter(id => typeof id === 'string')
      : []
  }
  else if (o.discordRoles && typeof o.discordRoles === 'object') {
    // Migrate from old config: role IDs that had any permission are now allowed
    roleIds = Object.keys(o.discordRoles as Record<string, unknown>)
    userIds = []
  }
  else {
    roleIds = []
    userIds = []
  }
  return { allowedDiscordRoleIds: roleIds, allowedDiscordUserIds: userIds }
}

@Injectable()
export class PermissionConfigService implements OnModuleInit {
  private config: AllowlistConfig = {
    allowedDiscordRoleIds: [],
    allowedDiscordUserIds: [],
  }

  constructor(
    private readonly configService: ConfigService,
    private readonly appConfig: AppConfigService,
  ) {}

  async onModuleInit() {
    await this.reload()
  }

  async reload(): Promise<void> {
    this.config = await this.loadConfig()
  }

  getConfig(): AllowlistConfig {
    return {
      allowedDiscordRoleIds: [...this.config.allowedDiscordRoleIds],
      allowedDiscordUserIds: [...this.config.allowedDiscordUserIds],
    }
  }

  /** User allowed if their role or user ID is in the allowlist. Empty list = nobody. */
  isAllowed(memberRoleIds: string[], userId?: string | null): boolean {
    const { allowedDiscordRoleIds, allowedDiscordUserIds } = this.config
    if (allowedDiscordRoleIds.length === 0 && allowedDiscordUserIds.length === 0) {
      return false
    }
    if (userId && allowedDiscordUserIds.includes(userId))
      return true
    if (memberRoleIds.some(id => allowedDiscordRoleIds.includes(id)))
      return true
    return false
  }

  private async loadConfig(): Promise<AllowlistConfig> {
    const stored = await this.appConfig.get(PERMISSIONS_KEY)
    if (stored) {
      try {
        return normalizeAllowlist(JSON.parse(stored))
      }
      catch {
        // invalid or missing; use file/defaults below
      }
    }
    const fromFile = this.loadConfigFromFile()
    const hasAny = fromFile.allowedDiscordRoleIds.length > 0 || fromFile.allowedDiscordUserIds.length > 0
    if (hasAny) {
      await this.appConfig.set(PERMISSIONS_KEY, JSON.stringify(fromFile))
    }
    return fromFile
  }

  private loadConfigFromFile(): AllowlistConfig {
    const configPath = this.configService.get<string>('permissions.file')
    const resolved = configPath
      ? resolve(configPath)
      : resolve(__dirname, 'permission-config.json')
    if (!existsSync(resolved)) {
      return { allowedDiscordRoleIds: [], allowedDiscordUserIds: [] }
    }
    try {
      const parsed = JSON.parse(readFileSync(resolved, 'utf-8')) as unknown
      return normalizeAllowlist(parsed)
    }
    catch {
      return { allowedDiscordRoleIds: [], allowedDiscordUserIds: [] }
    }
  }
}
