import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { UpdateProfileDto } from './update-profile.dto.js';

/**
 * Validates a request body the way the global ValidationPipe does.
 *
 * @param body - Raw request body.
 * @returns The transformed DTO and the names of the failing properties.
 */
function check(body: Record<string, unknown>): {
  dto: UpdateProfileDto;
  failed: string[];
} {
  const dto = plainToInstance(UpdateProfileDto, body);
  const failed = validateSync(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  }).map((error) => error.property);
  return { dto, failed };
}

describe('UpdateProfileDto', () => {
  it('accepts valid values and trims the name', () => {
    const { dto, failed } = check({
      fullName: '  Ada Lovelace  ',
      avatarUrl: 'https://example.com/ada.png',
    });
    expect(failed).toEqual([]);
    expect(dto.fullName).toBe('Ada Lovelace');
  });

  it('accepts an empty body and null to clear', () => {
    expect(check({}).failed).toEqual([]);
    expect(check({ fullName: null, avatarUrl: null }).failed).toEqual([]);
  });

  it.each([
    ['blank name', { fullName: '   ' }, 'fullName'],
    ['too long name', { fullName: 'x'.repeat(101) }, 'fullName'],
    ['non-string name', { fullName: 42 }, 'fullName'],
    ['http avatar', { avatarUrl: 'http://example.com/a.png' }, 'avatarUrl'],
    ['javascript avatar', { avatarUrl: 'javascript:alert(1)' }, 'avatarUrl'],
    ['not a URL', { avatarUrl: 'avatar.png' }, 'avatarUrl'],
    [
      'too long avatar',
      { avatarUrl: `https://example.com/${'a'.repeat(2048)}` },
      'avatarUrl',
    ],
    ['email (not editable)', { email: 'x@example.com' }, 'email'],
  ])('rejects %s', (_name, body, property) => {
    expect(check(body).failed).toEqual([property]);
  });
});
