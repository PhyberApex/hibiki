import { Module } from '@nestjs/common';
import { PermissionConfigService } from './permission-config.service';

@Module({
  providers: [PermissionConfigService],
  exports: [PermissionConfigService],
})
export class PermissionsModule {}
