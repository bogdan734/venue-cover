import 'server-only';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { type Actor, api } from './api';
import { isAdmin } from './auth';
import type { Program, ProgramRules } from './types';

export interface Portal {
  program: Program;
  /** The rules in force today: what this portal prices without a person, and which limits it offers. */
  rules: ProgramRules;
  /** Who the portal's calls are made as. */
  as: Actor;
}

// The portal behind /p/<code>. A program that does not exist has no portal, so the page is not found; nor does one
// that is still a draft or in test, for anyone but staff.
export const portalOf = cache(async (code: string): Promise<Portal> => {
  const { programs } = await api<{ programs: Program[] }>('operator', '/v1/programs');
  const program = programs.find((p) => p.code.toLowerCase() === code.toLowerCase());
  if (!program) notFound();
  if (!isOpen(program) && !(await isAdmin())) notFound();
  const detail = await api<{ rules: ProgramRules }>('operator', `/v1/programs/${program.id}`);
  return { program, rules: detail.rules, as: { program: program.id } };
});

/** Whether the public can see a program's portal. A paused one stays visible, to say it is paused. */
export const isOpen = (program: Pick<Program, 'status'>): boolean =>
  program.status === 'live' || program.status === 'paused';
