import { CanActivate, ExecutionContext, Injectable, mixin, Type } from '@nestjs/common'
import { PermissionConfigService } from './permission-config.service'
import { PermissionRole } from './permission.types'

type RoleExtractor = (context: ExecutionContext) => Iterable<PermissionRole>

export function PermissionGuard(commandKey: string, roleExtractor?: RoleExtractor): Type<CanActivate> {
  @Injectable()
  class PermissionGuardMixin implements CanActivate {
    constructor(private readonly permissions: PermissionConfigService) {}

    canActivate(context: ExecutionContext): boolean {
      const roles = roleExtractor?.(context) ?? context.switchToHttp().getRequest().user?.roles ?? []
      return this.permissions.hasPermission(commandKey, roles)
    }
  }

  return mixin(PermissionGuardMixin)
}
