import { Controller, Get, UseGuards } from '@nestjs/common';
import { PlayerService } from './player.service';
import { PermissionGuard } from '../permissions';

@Controller('player')
export class PlayerController {
  constructor(private readonly player: PlayerService) {}

  @Get('state')
  @UseGuards(new PermissionGuard('player.state.view'))
  getState() {
    return this.player.getState();
  }
}
