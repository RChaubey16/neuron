'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

/** A copyable `<pre>` block for a curl command or example payload. */
export function CodeBlock({
  label,
  code,
  copyable = false,
}: {
  label: string;
  code: string;
  copyable?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium tracking-wide text-fg-3">
          {label}
        </span>
        {copyable && (
          <button
            onClick={copy}
            className="inline-flex items-center gap-1 text-xs font-medium text-fg-2 hover:text-fg"
          >
            {copied ? (
              <Check className="h-3 w-3" />
            ) : (
              <Copy className="h-3 w-3" />
            )}
            {copied ? 'Copied' : 'Copy'}
          </button>
        )}
      </div>
      <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-lg border border-border bg-surface-2 px-3 py-2.5 font-mono text-xs text-fg">
        {code}
      </pre>
    </div>
  );
}
