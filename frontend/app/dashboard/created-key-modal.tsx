'use client';

import { useState } from 'react';
import type { CreatedApiKey } from '@/lib/api';
import { Check, Copy, ShieldCheck, TriangleAlert } from 'lucide-react';

export function CreatedKeyModal({
  apiKey,
  onClose,
}: {
  apiKey: CreatedApiKey;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [stored, setStored] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(apiKey.key);
    setCopied(true);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="created-key-heading"
      className="fixed inset-0 z-10 flex items-center justify-center bg-black/50 p-4"
    >
      <div className="flex w-full max-w-md flex-col overflow-hidden rounded-xl border border-border bg-elevated shadow-xl">
        <div className="flex items-center gap-2 bg-warning-soft px-5 py-2.5 text-sm font-medium text-warning">
          <TriangleAlert className="h-4 w-4 shrink-0" />
          Shown once — this key cannot be retrieved again.
        </div>

        <div className="flex flex-col gap-4 px-6 py-6">
          <div>
            <h3
              id="created-key-heading"
              className="font-display text-lg font-semibold text-fg"
            >
              Copy your API key now
            </h3>
            <p className="mt-1 text-sm text-fg-2">
              Neuron stores only a hash of this key. If you close this dialog
              without saving it, you will have to generate a new one and
              update your deployment.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            {apiKey.name && (
              <span className="text-xs font-medium text-fg-2">
                {apiKey.name}
              </span>
            )}
            <div className="flex gap-2">
              <code className="min-w-0 flex-1 break-all rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-fg">
                {apiKey.key}
              </code>
              <button
                onClick={copy}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-white hover:bg-accent-hover"
              >
                {copied ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-fg-2">
            <input
              type="checkbox"
              checked={stored}
              onChange={(e) => setStored(e.target.checked)}
              className="h-4 w-4 rounded border-border-strong accent-accent"
            />
            <ShieldCheck className="h-4 w-4 shrink-0 text-fg-3" />
            I have stored this key somewhere safe.
          </label>
        </div>

        <div className="flex items-center justify-between border-t border-border px-6 py-3">
          <span className="font-mono text-xs text-fg-3">
            {apiKey.keyPrefix} · created{' '}
            {new Date(apiKey.createdAt).toLocaleDateString('en-US', {
              month: 'short',
              day: '2-digit',
              year: 'numeric',
            })}
          </span>
          <button
            onClick={onClose}
            disabled={!stored}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
