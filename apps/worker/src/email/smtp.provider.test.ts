import { createServer, type AddressInfo } from 'node:net';
import type { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';
import type { EnvironmentVariables } from '../config/env.validation.js';
import { SmtpProvider } from './smtp.provider.js';

function providerFor(port: number): SmtpProvider {
  const values: Record<string, unknown> = {
    SMTP_HOST: '127.0.0.1',
    SMTP_PORT: port,
    SMTP_SECURE: false,
  };
  const config = { get: (key: string) => values[key] } as unknown as ConfigService<
    EnvironmentVariables,
    true
  >;
  return new SmtpProvider(config);
}

const email = {
  messageId: '01a21263-cdd8-77cd-85c2-ccfbbb92bbef',
  from: 'Neuron <noreply@neuron.test>',
  to: 'someone@example.com',
  subject: 'Hi',
  html: '<p>Hi</p>',
  text: null,
};

/** A port with nothing listening on it. */
async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

describe('SmtpProvider', () => {
  it('fails when the SMTP server is unreachable', async () => {
    const provider = providerFor(await closedPort());

    await expect(provider.send(email)).rejects.toThrow(/ECONNREFUSED/);
    provider.close();
  });

  it('fails instead of waiting forever when the server never greets', async () => {
    // Accepts connections but never says anything: a hung SMTP server.
    const silent = createServer(() => undefined);
    await new Promise<void>((resolve) => silent.listen(0, '127.0.0.1', resolve));
    const { port } = silent.address() as AddressInfo;
    const provider = providerFor(port);

    try {
      await expect(provider.send(email)).rejects.toThrow(/Greeting never received|timeout/i);
    } finally {
      provider.close();
      silent.close();
    }
  }, 15_000);
});
