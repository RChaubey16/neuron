import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { ConfigService } from '@nestjs/config';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EnvironmentVariables } from '../config/env.validation.js';
import { ResendApiError, ResendProvider } from './resend.provider.js';

const API_KEY = 're_test_123456789';

const email = {
  messageId: '01a21263-cdd8-77cd-85c2-ccfbbb92bbef',
  from: 'Neuron <noreply@neuron.test>',
  to: 'someone@example.com',
  subject: 'Hi',
  html: '<p>Hi</p>',
  text: 'Hi',
};

interface Received {
  method?: string;
  url?: string;
  headers: IncomingMessage['headers'];
  body: unknown;
}

type Handler = (received: Received) => { status: number; body: string } | 'hang';

/** A stand-in for the Resend API on a local port; the SDK is pointed at it with RESEND_BASE_URL. */
async function fakeResend(handler: Handler): Promise<{ server: Server; requests: Received[] }> {
  const requests: Received[] = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => (raw += chunk.toString()));
    req.on('end', () => {
      const received = {
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: JSON.parse(raw) as unknown,
      };
      requests.push(received);
      const answer = handler(received);
      if (answer === 'hang') return;
      res.writeHead(answer.status, { 'content-type': 'application/json' }).end(answer.body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  vi.stubEnv('RESEND_BASE_URL', `http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  return { server, requests };
}

class FastTimeoutResendProvider extends ResendProvider {
  protected override readonly timeoutMs = 200;
}

function config(): ConfigService<EnvironmentVariables, true> {
  return { get: () => API_KEY } as unknown as ConfigService<EnvironmentVariables, true>;
}

describe('ResendProvider', () => {
  let server: Server | undefined;

  beforeEach(() => {
    // The SDK logs API errors to the console; keep test output clean.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    server?.closeAllConnections();
    server?.close();
    server = undefined;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('sends the email with an idempotency key and returns Resend’s ID', async () => {
    const fake = await fakeResend(() => ({ status: 200, body: '{"id":"resend-email-id"}' }));
    server = fake.server;

    const result = await new ResendProvider(config()).send(email);

    expect(result).toEqual({ providerMessageId: 'resend-email-id' });
    expect(fake.requests).toHaveLength(1);
    const [request] = fake.requests;
    expect(request?.method).toBe('POST');
    expect(request?.url).toBe('/emails');
    expect(request?.headers['authorization']).toBe(`Bearer ${API_KEY}`);
    expect(request?.headers['idempotency-key']).toBe(`neuron-message/${email.messageId}`);
    expect(request?.body).toEqual({
      from: email.from,
      to: email.to,
      subject: email.subject,
      html: email.html,
      text: email.text,
      headers: { 'X-Neuron-Message-Id': email.messageId },
    });
  });

  it('leaves out the text version when there is none', async () => {
    const fake = await fakeResend(() => ({ status: 200, body: '{"id":"x"}' }));
    server = fake.server;

    await new ResendProvider(config()).send({ ...email, text: null });

    expect(fake.requests[0]?.body).not.toHaveProperty('text');
  });

  it('throws a ResendApiError with the status and code when Resend rejects the email', async () => {
    server = (
      await fakeResend(() => ({
        status: 422,
        body: JSON.stringify({
          statusCode: 422,
          name: 'validation_error',
          message: 'The `to` field must be a valid email address.',
        }),
      }))
    ).server;

    const error = await new ResendProvider(config()).send(email).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ResendApiError);
    expect(error).toMatchObject({
      statusCode: 422,
      code: 'validation_error',
      message:
        'Resend rejected the email (422 validation_error): The `to` field must be a valid email address.',
    });
  });

  it('handles an error answer that isn’t JSON', async () => {
    server = (await fakeResend(() => ({ status: 502, body: '<html>Bad gateway</html>' }))).server;

    await expect(new ResendProvider(config()).send(email)).rejects.toMatchObject({
      statusCode: 502,
      code: 'application_error',
    });
  });

  it('fails when Resend can’t be reached', async () => {
    const fake = await fakeResend(() => ({ status: 200, body: '{}' }));
    // Close it again, so nothing listens on the port the SDK was pointed at.
    await new Promise<void>((resolve) => fake.server.close(() => resolve()));

    await expect(new ResendProvider(config()).send(email)).rejects.toMatchObject({
      statusCode: null,
      message: expect.stringMatching(/^Could not reach Resend/) as unknown,
    });
  });

  it('gives up when Resend doesn’t answer in time', async () => {
    server = (await fakeResend(() => 'hang')).server;

    await expect(new FastTimeoutResendProvider(config()).send(email)).rejects.toMatchObject({
      code: 'timeout',
      message: 'Resend did not answer within 200ms',
    });
  });
});
