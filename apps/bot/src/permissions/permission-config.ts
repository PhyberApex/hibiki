import permissionConfigJson from './permission-config.json'

type PermissionConfigFile = {
  discordRoles: DiscordRolePermissionMap
  dashboardUsers: DashboardPermissionMap
  commands: CommandPermissionMap
}

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

export const permissionConfig: PermissionConfig = {
  discordRoles: { ...permissionConfigJson.discordRoles },
  dashboardUsers: { ...permissionConfigJson.dashboardUsers },
  commands: { ...permissionConfigJson.commands },
}

export const getRolesForDiscordMember = (
  roleIds: string[],
): Set<PermissionRole> => {
  const roles = new Set<PermissionRole>()

  roleIds.forEach((roleId) => {
    const rolePermissions = permissionConfig.discordRoles[roleId]
    rolePermissions?.forEach((permissionRole) => roles.add(permissionRole))
  })

  return roles
}

export const getRolesForDashboardUser = (email: string): Set<PermissionRole> => {
  const roles = new Set<PermissionRole>()
  const configuredRoles = permissionConfig.dashboardUsers[email.toLowerCase()]

  configuredRoles?.forEach((permissionRole) => roles.add(permissionRole))

  return roles
}

export const hasPermission = (
  commandKey: string,
  roles: Iterable<PermissionRole>,
): boolean => {
  const requiredRoles = permissionConfig.commands[commandKey]
  if (!requiredRoles || requiredRoles.length === 0) {
    return true
  }

  const roleSet = new Set(roles)
  return requiredRoles.some((role) => roleSet.has(role))
}
