import * as http from 'node:http';
import * as https from 'node:https';
import type { Provider } from '@nestjs/common';
import { guardedLookup } from './target-guard';

export const WEBHOOK_HTTP_CLIENT = 'WEBHOOK_HTTP_CLIENT';

const REQUEST_TIMEOUT_MS = 10_000;

export interface WebhookHttpClient {
  /**
   * Sends one webhook POST and resolves with the response status once
   * headers arrive, without reading the body. Never follows redirects.
   * Rejects on a network error, a timeout, or (unless
   * `allowPrivateTargets`) a `BlockedTargetError` from `guardedLookup`.
   */
  post(
    url: string,
    headers: Record<string, string>,
    body: string,
    options: { allowPrivateTargets: boolean },
  ): Promise<{ status: number }>;
}

/**
 * Built on `http(s).request` rather than `fetch` because only the former
 * accepts a custom `lookup`, which is how every connection gets checked
 * against private address ranges (see `guardedLookup`).
 */
const nodeWebhookHttpClient: WebhookHttpClient = {
  post(url, headers, body, { allowPrivateTargets }) {
    return new Promise((resolve, reject) => {
      const target = new URL(url);
      const transport = target.protocol === 'https:' ? https : http;
      const request = transport.request(
        target,
        {
          method: 'POST',
          headers: {
            ...headers,
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(body),
            'user-agent': 'Neuron-Webhooks/1.0',
          },
          timeout: REQUEST_TIMEOUT_MS,
          lookup: allowPrivateTargets ? undefined : guardedLookup,
        },
        (response) => {
          resolve({ status: response.statusCode ?? 0 });
          // Only the status matters — drop the body rather than buffer
          // whatever the receiver sends back.
          response.destroy();
        },
      );
      request.on('timeout', () =>
        request.destroy(
          new Error(`Timed out after ${REQUEST_TIMEOUT_MS / 1000}s`),
        ),
      );
      request.on('error', reject);
      request.end(body);
    });
  },
};

export const webhookHttpClientProvider: Provider = {
  provide: WEBHOOK_HTTP_CLIENT,
  useValue: nodeWebhookHttpClient,
};
