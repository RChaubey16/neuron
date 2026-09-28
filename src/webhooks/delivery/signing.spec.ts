import { generateWebhookSecret, signWebhook } from './signing';

describe('webhook signing', () => {
  it('matches the Standard Webhooks reference test vector', () => {
    expect(
      signWebhook(
        'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw',
        'msg_p5jXN8AQM9LWM0D4loKWxJek',
        1614265330,
        '{"test": 2432232314}',
      ),
    ).toBe('v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=');
  });

  it('generates distinct whsec_-prefixed secrets with 24 bytes of key material', () => {
    const first = generateWebhookSecret();
    const second = generateWebhookSecret();

    expect(first).toMatch(/^whsec_[A-Za-z0-9+/]{32}$/);
    expect(first).not.toBe(second);
    expect(Buffer.from(first.slice('whsec_'.length), 'base64')).toHaveLength(
      24,
    );
  });
});
