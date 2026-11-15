'use client';

import { type FormEvent, startTransition, useActionState } from 'react';

// What a form shows after it was sent: nothing, a problem to fix, or a confirmation.
export interface FormState {
  error?: string;
  done?: string;
}

export type FormAction = (state: FormState, form: FormData) => Promise<FormState>;

// Sends a form to a server action and keeps what was typed. React clears a form once its `action` has run, which is
// right after a success and wrong when the server sends back a problem to fix, so the form is submitted by hand.
export function useServerForm(action: FormAction) {
  const [state, dispatch, pending] = useActionState(action, {});
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => dispatch(data));
  }
  return { state, pending, onSubmit };
}
