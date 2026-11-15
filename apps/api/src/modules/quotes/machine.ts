import type { QuoteState } from '../../domain/types.js';

export type QuoteEvent = 'pay' | 'approve' | 'decline' | 'issue';

export class IllegalTransitionError extends Error {
  constructor(state: QuoteState, event: QuoteEvent) {
    super(`a ${state} quote cannot take the step "${event}"`);
    this.name = 'IllegalTransitionError';
  }
}

// Allowed steps only; everything else is an error. A quote that lapses is reported as expired when read
// (see service.ts) instead of being rewritten by a sweeper.
const TRANSITIONS: Partial<Record<QuoteState, Partial<Record<QuoteEvent, QuoteState>>>> = {
  quoted: { pay: 'bound' },
  bound: { issue: 'issued' },
  referred: { approve: 'quoted', decline: 'declined' },
};

export function transition(state: QuoteState, event: QuoteEvent): QuoteState {
  const next = TRANSITIONS[state]?.[event];
  if (!next) throw new IllegalTransitionError(state, event);
  return next;
}
