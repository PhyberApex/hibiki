import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common'
import { PermissionConfigService, PermissionRole } from '..'

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly permissionService: PermissionConfigService,
    private readonly commandKey: string,
    private readonly roleExtractor?: (context: ExecutionContext) => Iterable<PermissionRole>,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.roleExtractor?.(context) ?? context.switchToHttp().getRequest().user?.roles ?? []
    return this.permissionService.hasPermission(this.commandKey, roles)
  }
}
