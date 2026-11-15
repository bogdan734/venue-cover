import { describe, expect, it } from 'vitest';
import { IllegalTransitionError, transition } from './index.js';

describe('quote state machine', () => {
  it('lets a quoted quote bind on payment', () => {
    expect(transition('quoted', 'pay')).toBe('bound');
  });

  it('lets an underwriter approve or decline a referred quote', () => {
    expect(transition('referred', 'approve')).toBe('quoted');
    expect(transition('referred', 'decline')).toBe('declined');
  });

  it('does not let a quote that was never referred be approved or declined', () => {
    expect(() => transition('quoted', 'approve')).toThrow(IllegalTransitionError);
    expect(() => transition('bound', 'decline')).toThrow(IllegalTransitionError);
  });

  it('does not let a referred quote bind', () => {
    expect(() => transition('referred', 'pay')).toThrow(IllegalTransitionError);
  });

  it('throws on any other transition', () => {
    expect(() => transition('bound', 'pay')).toThrow(IllegalTransitionError);
    expect(() => transition('expired', 'pay')).toThrow(IllegalTransitionError);
    expect(() => transition('declined', 'pay')).toThrow(/declined/);
  });
});
