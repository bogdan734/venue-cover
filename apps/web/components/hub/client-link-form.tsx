'use client';

import { useActionState } from 'react';
import type { LinkState } from '@/app/(console)/programs/actions';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/field';
import { CopyField } from './copy-field';

// Makes a client console link. The secret comes back once and is shown here only, ready to send.
export function ClientLinkForm({
  code,
  action,
  idem,
}: {
  code: string;
  action: (state: LinkState, form: FormData) => Promise<LinkState>;
  idem: string;
}) {
  const [state, dispatch, pending] = useActionState(action, {});
  return (
    <div className="space-y-3">
      <form action={dispatch} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="idem" value={idem} />
        <Field label="Who it is for" htmlFor="link-label" className="min-w-48 flex-1">
          <Input
            id="link-label"
            name="label"
            required
            maxLength={80}
            placeholder="Facilities office"
          />
        </Field>
        <Button type="submit" variant="secondary" disabled={pending} aria-busy={pending}>
          {pending ? 'Making…' : 'Make a link'}
        </Button>
      </form>
      {state.error ? <Notice tone="danger">{state.error}</Notice> : null}
      {state.token ? (
        <div className="space-y-1.5" role="status">
          <p className="text-sm text-ink">
            Link for {state.label}. It is shown this once: send it now.
          </p>
          <CopyField label="Client console link" path={`/c/${code}/open?key=${state.token}`} />
        </div>
      ) : null}
    </div>
  );
}
