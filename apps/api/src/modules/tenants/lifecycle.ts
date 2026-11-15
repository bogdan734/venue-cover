import type { ProgramStatus } from '../../domain/types.js';

// A program is tried by staff before it opens, and once open it is only paused, never sent back to a draft: its
// policies and figures already exist.
const NEXT: Record<ProgramStatus, ProgramStatus[]> = {
  draft: ['test'],
  test: ['draft', 'live'],
  live: ['paused'],
  paused: ['live'],
};

export const canMove = (from: ProgramStatus, to: ProgramStatus): boolean => NEXT[from].includes(to);
