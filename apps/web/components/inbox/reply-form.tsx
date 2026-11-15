'use client';

import { Send } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/card';
import { Textarea } from '@/components/ui/field';
import { type FormAction, useServerForm } from '@/components/use-server-form';

// A person's answer. Sending it takes the conversation over; the box empties once it has gone.
export function ReplyForm({ action, idem }: { action: FormAction; idem: string }) {
  const { state, pending, onSubmit } = useServerForm(action);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.done) form.current?.reset();
  }, [state]);
  return (
    <form ref={form} onSubmit={onSubmit} className="space-y-2">
      <input type="hidden" name="idem" value={idem} />
      <label htmlFor="reply" className="sr-only">
        Your answer
      </label>
      <Textarea
        id="reply"
        name="text"
        rows={3}
        maxLength={2000}
        placeholder="Answer as a person. The assistant stops once you do."
        required
      />
      {state.error ? <Notice tone="danger">{state.error}</Notice> : null}
      <Button type="submit" disabled={pending} aria-busy={pending}>
        <Send className="size-4" aria-hidden /> {pending ? 'Sending…' : 'Send'}
      </Button>
    </form>
  );
}
