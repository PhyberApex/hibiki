import { ConfigService } from '@nestjs/config';
import { PermissionConfigService } from './permission-config.service';

const mockFile = JSON.stringify({
  discordRoles: {
    'role-admin': ['admin'],
    'role-dj': ['dj'],
  },
  dashboardUsers: {
    'admin@example.com': ['admin'],
    'mixed@example.com': ['admin', 'moderator'],
  },
  commands: {
    'player.play': ['dj'],
    'player.stop': ['admin'],
    unrestricted: [],
  },
});

jest.mock('node:fs', () => ({
  existsSync: () => true,
  readFileSync: () => mockFile,
}));

describe('PermissionConfigService', () => {
  const configService = {
    get: jest.fn().mockReturnValue(undefined),
  } as unknown as ConfigService;

  const service = new PermissionConfigService(configService);

  it('collects roles for guild members', () => {
    const roles = service.getRolesForDiscordMember(['role-admin', 'role-dj']);
    expect(Array.from(roles)).toEqual(expect.arrayContaining(['admin', 'dj']));
  });

  it('returns dashboard roles case-insensitively', () => {
    const roles = service.getRolesForDashboardUser('MIXED@example.com');
    expect(Array.from(roles)).toEqual(
      expect.arrayContaining(['admin', 'moderator']),
    );
  });

  it('grants access when requirement met', () => {
    const roles = new Set(['dj']);
    expect(service.hasPermission('player.play', roles)).toBe(true);
  });

  it('denies access when requirement missing', () => {
    const roles = new Set(['dj']);
    expect(service.hasPermission('player.stop', roles)).toBe(false);
  });

  it('allows unrestricted commands', () => {
    expect(service.hasPermission('unrestricted', new Set())).toBe(true);
    expect(service.hasPermission('unknown', new Set())).toBe(true);
  });
});
