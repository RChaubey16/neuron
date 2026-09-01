import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Profile } from 'passport-google-oauth20';
import { GoogleStrategy } from './google.strategy';

describe('GoogleStrategy', () => {
  let strategy: GoogleStrategy;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GoogleStrategy,
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: (key: string) =>
              ({
                GOOGLE_CLIENT_ID: 'client-id',
                GOOGLE_CLIENT_SECRET: 'client-secret',
                GOOGLE_CALLBACK_URL:
                  'http://localhost:3000/auth/google/callback',
              })[key],
          },
        },
      ],
    }).compile();

    strategy = module.get(GoogleStrategy);
  });

  it('maps a verified Google profile to { sub, email }', () => {
    const done = jest.fn();
    const profile = {
      id: 'google-sub-1',
      emails: [{ value: 'user@example.com', verified: true }],
    } as unknown as Profile;

    strategy.validate('access-token', 'refresh-token', profile, done);

    expect(done).toHaveBeenCalledWith(null, {
      sub: 'google-sub-1',
      email: 'user@example.com',
    });
  });

  it('fails when the Google profile has no email', () => {
    const done = jest.fn();
    const profile = { id: 'google-sub-1', emails: [] } as unknown as Profile;

    strategy.validate('access-token', 'refresh-token', profile, done);

    expect(done).toHaveBeenCalledWith(expect.any(Error), false);
  });

  it('fails when the Google profile email is not verified', () => {
    const done = jest.fn();
    const profile = {
      id: 'google-sub-1',
      emails: [{ value: 'user@example.com', verified: false }],
    } as unknown as Profile;

    strategy.validate('access-token', 'refresh-token', profile, done);

    expect(done).toHaveBeenCalledWith(expect.any(Error), false);
  });
});
