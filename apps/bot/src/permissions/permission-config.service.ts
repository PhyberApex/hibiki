import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  CommandPermissionMap,
  DashboardPermissionMap,
  DiscordRolePermissionMap,
  PermissionConfig,
  PermissionRole,
} from './permission.types'

@Injectable()
export class PermissionConfigService {
  private config: PermissionConfig

  constructor(private readonly configService: ConfigService) {
    this.config = this.loadConfig()
  }

  private loadConfig(): PermissionConfig {
    const configPath = this.configService.get<string>('permissions.file')
    const resolvedPath = configPath ? resolve(configPath) : resolve(__dirname, 'permission-config.json')
    if (!existsSync(resolvedPath)) {
      return { discordRoles: {}, dashboardUsers: {}, commands: {} }
    }
    const raw = readFileSync(resolvedPath, 'utf-8')
    const parsed = JSON.parse(raw) as PermissionConfig
    return {
      discordRoles: parsed.discordRoles ?? {},
      dashboardUsers: parsed.dashboardUsers ?? {},
      commands: parsed.commands ?? {},
    }
  }

  getConfig(): PermissionConfig {
    return this.config
  }

  getRolesForDiscordMember(roleIds: string[]): Set<PermissionRole> {
    const roles = new Set<PermissionRole>()
    roleIds.forEach((roleId) => {
      const perms = this.config.discordRoles[roleId]
      perms?.forEach((role) => roles.add(role))
    })
    return roles
  }

  getRolesForDashboardUser(email: string): Set<PermissionRole> {
    const roles = new Set<PermissionRole>()
    const perms = this.config.dashboardUsers[email.toLowerCase()]
    perms?.forEach((role) => roles.add(role))
    return roles
  }

  hasPermission(commandKey: string, roles: Iterable<PermissionRole>): boolean {
    const required = this.config.commands[commandKey]
    if (!required || required.length === 0) {
      return true
    }
    const roleSet = new Set(roles)
    return required.some((role) => roleSet.has(role))
  }
}
