import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { hasPermission, PermissionRole } from './permission-config';

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly commandKey: string) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const roles: Iterable<PermissionRole> = request.user?.roles || [];
    return hasPermission(this.commandKey, roles);
  }
}
