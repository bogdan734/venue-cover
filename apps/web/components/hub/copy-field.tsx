'use client';

import { Check, Copy } from 'lucide-react';
import { useEffect, useState } from 'react';

// A value to hand on, with a copy button. A path is completed with this site's own address once it is in the browser,
// which is the address the person on the other end will use.
export function CopyField({
  label,
  path,
  around = ['', ''],
}: {
  label: string;
  path: string;
  /** Text around the address, such as a script tag. */
  around?: [string, string];
}) {
  const [origin, setOrigin] = useState('');
  const [copied, setCopied] = useState(false);
  useEffect(() => setOrigin(window.location.origin), []);
  const value = `${around[0]}${origin}${path}${around[1]}`;

  async function copy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  return (
    <div className="flex items-stretch gap-2">
      <label className="sr-only" htmlFor={`copy-${path}`}>
        {label}
      </label>
      <textarea
        id={`copy-${path}`}
        readOnly
        rows={1}
        value={value}
        onFocus={(event) => event.currentTarget.select()}
        className="min-w-0 flex-1 resize-none rounded-control border border-line-strong bg-sunken/50 px-3 py-2 font-mono text-[0.8rem] whitespace-nowrap text-ink-soft"
      />
      <button
        type="button"
        onClick={() => void copy()}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-control border border-line-strong bg-surface px-3 text-sm font-medium text-ink hover:bg-sunken"
      >
        {copied ? (
          <Check className="size-4 text-ok" aria-hidden />
        ) : (
          <Copy className="size-4" aria-hidden />
        )}
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}
