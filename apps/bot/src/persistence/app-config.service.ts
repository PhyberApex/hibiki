import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppConfig } from './app-config.entity';

@Injectable()
export class AppConfigService {
  constructor(
    @InjectRepository(AppConfig)
    private readonly repo: Repository<AppConfig>,
  ) {}

  async get(key: string): Promise<string | null> {
    const row = await this.repo.findOne({ where: { key } });
    return row?.value ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    const existing = await this.repo.findOne({ where: { key } });
    if (existing) {
      existing.value = value;
      await this.repo.save(existing);
    } else {
      await this.repo.save(this.repo.create({ key, value }));
    }
  }
}
