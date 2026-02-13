import {
  CanActivate,
  ExecutionContext,
  Injectable,
  mixin,
  Type,
} from '@nestjs/common';
import type { Request } from 'express';
import { PermissionConfigService } from './permission-config.service';
import { PermissionRole } from './permission.types';

type RoleExtractor = (context: ExecutionContext) => Iterable<PermissionRole>;

export function PermissionGuard(
  commandKey: string,
  roleExtractor?: RoleExtractor,
): Type<CanActivate> {
  @Injectable()
  class PermissionGuardMixin implements CanActivate {
    constructor(private readonly permissions: PermissionConfigService) {}

    canActivate(context: ExecutionContext): boolean {
      const request = context.switchToHttp().getRequest();
      const extracted = (roleExtractor?.(context) ??
        request.user?.roles ??
        []) as Iterable<PermissionRole>;
      return this.permissions.hasPermission(commandKey, extracted);
    }
  }

  return mixin(PermissionGuardMixin);
}
