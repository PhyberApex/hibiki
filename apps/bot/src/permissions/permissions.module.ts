import { Module } from '@nestjs/common'
import { PersistenceModule } from '../persistence/persistence.module'
import { PermissionConfigService } from './permission-config.service'
import { PermissionsController } from './permissions.controller'

@Module({
  imports: [PersistenceModule],
  providers: [PermissionConfigService],
  controllers: [PermissionsController],
  exports: [PermissionConfigService],
})
export class PermissionsModule {}
