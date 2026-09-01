'use client';

import { useState } from 'react';
import type { CreatedApiKey } from '@/lib/api';

export function CreatedKeyModal({
  apiKey,
  onClose,
}: {
  apiKey: CreatedApiKey;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(apiKey.key);
    setCopied(true);
  }

  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/40 p-4">
      <div className="flex w-full max-w-md flex-col gap-4 rounded-xl bg-white p-6 dark:bg-zinc-900">
        <h3 className="text-lg font-medium text-zinc-900 dark:text-zinc-50">
          API key created
        </h3>
        <p className="text-sm text-red-600">
          Copy this key now — you won&apos;t be able to see it again.
        </p>
        <code className="break-all rounded-md bg-zinc-100 p-3 font-mono text-sm dark:bg-zinc-800">
          {apiKey.key}
        </code>
        <div className="flex justify-end gap-2">
          <button
            onClick={copy}
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm dark:border-zinc-700"
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
          <button
            onClick={onClose}
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm text-white dark:bg-white dark:text-zinc-900"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
