export type PermissionRole = 'admin' | 'moderator' | 'dj'

export interface CommandPermissionMap {
  [command: string]: PermissionRole[]
}

export interface DiscordRolePermissionMap {
  [discordRoleId: string]: PermissionRole[]
}

export interface DashboardPermissionMap {
  [email: string]: PermissionRole[]
}

export interface PermissionConfig {
  discordRoles: DiscordRolePermissionMap
  dashboardUsers: DashboardPermissionMap
  commands: CommandPermissionMap
}
