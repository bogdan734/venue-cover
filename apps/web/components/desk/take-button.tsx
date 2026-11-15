'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/card';
import type { FormState } from '@/components/use-server-form';

// Takes a referral for the underwriter who presses it. Only one person can hold a referral; the API says so if
// someone else got there first.
export function TakeButton({ take }: { take: () => Promise<FormState> }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  return (
    <div className="space-y-3">
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Button
        type="button"
        disabled={pending}
        aria-busy={pending}
        className="w-full"
        onClick={() => start(async () => setError((await take()).error))}
      >
        {pending ? 'Taking…' : 'Take this referral'}
      </Button>
    </div>
  );
}
