import { describe, expect, it } from 'vitest';
import { slaStatus } from './index.js';

const due = new Date('2026-11-14T12:00:00Z');
const at = (hoursBeforeDue: number) => new Date(due.getTime() - hoursBeforeDue * 3600_000);

describe('slaStatus', () => {
  it('is ok while more than four hours remain', () => {
    expect(slaStatus(due, at(24))).toBe('ok');
    expect(slaStatus(due, at(4.01))).toBe('ok');
  });

  it('is due soon within four hours of the deadline, including the deadline itself', () => {
    expect(slaStatus(due, at(4))).toBe('due_soon');
    expect(slaStatus(due, at(0.5))).toBe('due_soon');
    expect(slaStatus(due, at(0))).toBe('due_soon');
  });

  it('is overdue after the deadline', () => {
    expect(slaStatus(due, at(-0.01))).toBe('overdue');
    expect(slaStatus(due, at(-48))).toBe('overdue');
  });
});
