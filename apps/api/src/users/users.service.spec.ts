import { UnauthorizedException } from '@nestjs/common';
import type { AuthUser } from '@/common/interfaces/auth-user.interface.js';
import type { Profile } from '@/generated/prisma/client.js';
import type { PrismaService } from '@/prisma/prisma.service.js';
import { UsersService } from './users.service.js';

const USER: AuthUser = {
  id: '6f1c2a4e-8b3d-4c5e-9f7a-1b2c3d4e5f60',
  email: 'ada@example.com',
  fullName: 'Ada Lovelace',
  avatarUrl: 'https://example.com/ada.png',
};

const PROFILE: Profile = {
  id: USER.id,
  email: USER.email,
  fullName: 'Edited Name',
  avatarUrl: null,
  createdAt: new Date('2026-11-11T09:00:00Z'),
  updatedAt: new Date('2026-11-11T09:00:00Z'),
};

describe('UsersService', () => {
  const profile = { findUnique: vi.fn(), update: vi.fn() };
  const executeRaw = vi.fn();
  const service = new UsersService({
    profile,
    $executeRaw: executeRaw,
  } as unknown as PrismaService);

  /**
   * Joins the SQL text of the last raw query, without its parameters.
   *
   * @returns The query text with whitespace collapsed.
   */
  function lastRawSql(): string {
    const [strings] = executeRaw.mock.lastCall as [TemplateStringsArray];
    return strings.join('?').replace(/\s+/g, ' ');
  }

  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('getOrCreateProfile', () => {
    it('creates the profile from the token on first use', async () => {
      profile.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(PROFILE);
      executeRaw.mockResolvedValue(1);

      await expect(service.getOrCreateProfile(USER)).resolves.toBe(PROFILE);
      expect(profile.findUnique).toHaveBeenCalledWith({
        where: { id: USER.id },
      });
      expect(executeRaw.mock.lastCall?.slice(1)).toEqual([
        USER.id,
        USER.email,
        USER.fullName,
        USER.avatarUrl,
        USER.id,
      ]);
      expect(lastRawSql()).toContain(
        'WHERE EXISTS (SELECT 1 FROM auth.users WHERE id = ?::uuid) ON CONFLICT (id) DO NOTHING',
      );
    });

    it('returns the profile a concurrent request created', async () => {
      profile.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(PROFILE);
      executeRaw.mockResolvedValue(0);

      await expect(service.getOrCreateProfile(USER)).resolves.toBe(PROFILE);
    });

    it('rejects a user that no longer exists in Supabase', async () => {
      profile.findUnique.mockResolvedValue(null);
      executeRaw.mockResolvedValue(0);

      await expect(service.getOrCreateProfile(USER)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('returns an existing profile without writing', async () => {
      profile.findUnique.mockResolvedValue(PROFILE);

      await expect(service.getOrCreateProfile(USER)).resolves.toBe(PROFILE);
      expect(executeRaw).not.toHaveBeenCalled();
      expect(profile.update).not.toHaveBeenCalled();
    });

    it('syncs a changed email but not the name or avatar', async () => {
      const updated = { ...PROFILE, email: 'new@example.com' };
      profile.findUnique.mockResolvedValue(PROFILE);
      profile.update.mockResolvedValue(updated);

      await expect(
        service.getOrCreateProfile({ ...USER, email: 'new@example.com' }),
      ).resolves.toBe(updated);
      expect(profile.update).toHaveBeenCalledWith({
        where: { id: USER.id },
        data: { email: 'new@example.com' },
      });
    });

    it('keeps the stored email when the token has none', async () => {
      profile.findUnique.mockResolvedValue(PROFILE);

      await service.getOrCreateProfile({ ...USER, email: null });
      expect(profile.update).not.toHaveBeenCalled();
    });

    it('rethrows database errors', async () => {
      const failure = new Error('connection lost');
      profile.findUnique.mockResolvedValue(null);
      executeRaw.mockRejectedValue(failure);

      await expect(service.getOrCreateProfile(USER)).rejects.toBe(failure);
    });
  });

  describe('updateProfile', () => {
    it('ensures the profile exists, then updates only the given fields', async () => {
      const updated = { ...PROFILE, fullName: 'New Name' };
      profile.findUnique.mockResolvedValue(PROFILE);
      profile.update.mockResolvedValue(updated);

      await expect(
        service.updateProfile(USER, { fullName: 'New Name' }),
      ).resolves.toBe(updated);
      expect(profile.update).toHaveBeenCalledWith({
        where: { id: USER.id },
        data: { fullName: 'New Name', avatarUrl: undefined },
      });
    });

    it('creates the profile first when it does not exist', async () => {
      profile.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(PROFILE);
      executeRaw.mockResolvedValue(1);
      profile.update.mockResolvedValue(PROFILE);

      await service.updateProfile(USER, { avatarUrl: null });
      expect(executeRaw).toHaveBeenCalledOnce();
      expect(profile.update).toHaveBeenCalledWith({
        where: { id: USER.id },
        data: { fullName: undefined, avatarUrl: null },
      });
    });

    it('does not update when the Supabase user no longer exists', async () => {
      profile.findUnique.mockResolvedValue(null);
      executeRaw.mockResolvedValue(0);

      await expect(
        service.updateProfile(USER, { fullName: 'X' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(profile.update).not.toHaveBeenCalled();
    });
  });
});
