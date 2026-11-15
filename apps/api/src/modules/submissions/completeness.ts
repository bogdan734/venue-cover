import { type ChoiceField, LABELS, type TextField } from './fields.js';
import type { SubmissionFacts } from './parse.js';

export type AttachmentKind =
  | 'risk_plan'
  | 'security_protocol'
  | 'site_map'
  | 'venue_contract'
  | 'security_contract';
export const ATTACHMENT_KINDS: readonly AttachmentKind[] = [
  'risk_plan',
  'security_protocol',
  'site_map',
  'venue_contract',
  'security_contract',
];
export const ATTACHMENT_LABELS: Record<AttachmentKind, string> = {
  risk_plan: 'a risk management plan covering evacuation and emergency medical care',
  security_protocol: 'the security protocols for entry, during and after the event',
  site_map: 'a map of the event showing vendor areas, stages, tents and parking',
  venue_contract: 'the contract with the venue',
  security_contract: 'the contract with the security firm',
};

// At this daily attendance an application needs supporting documents; above it the underwriter will not look without them.
export const LARGE_EVENT_DAILY = 3000;

export interface Completeness {
  missing: { field: string; label: string }[];
  /** Documents still to come. */
  requiredAttachments: AttachmentKind[];
  ready: boolean;
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// What a person would otherwise have to chase one e-mail at a time. A blank answer is missing; it is never defaulted.
export function checkCompleteness(
  facts: SubmissionFacts,
  provided: AttachmentKind[],
): Completeness {
  const missing: Completeness['missing'] = [];
  const need = (field: TextField | ChoiceField) => missing.push({ field, label: LABELS[field] });

  if (!facts.organizerName) need('organizerName');
  if (!facts.contactName) need('contactName');
  if (!facts.contactEmail || !EMAIL.test(facts.contactEmail)) need('contactEmail');
  if (!facts.eventName) need('eventName');
  if (!facts.description || facts.description.length < 10) need('description');
  if (!facts.eventDate || !DATE.test(facts.eventDate)) need('eventDate');
  if (!facts.startTime || !TIME.test(facts.startTime)) need('startTime');
  if (!facts.endTime || !TIME.test(facts.endTime) || facts.endTime === facts.startTime)
    need('endTime');
  if (facts.dailyMax === null || facts.dailyMax < 1) need('dailyMax');
  if (facts.totalAttendance === null) need('totalAttendance');
  if (facts.shareUnder18 === null) need('shareUnder18');
  if (facts.vendors === undefined) need('vendor_food');
  if (facts.temporarySeats === null) need('temporarySeats');
  if (facts.alcoholServedBy === null) need('alcoholServedBy');
  if (facts.alcoholServedBy && facts.alcoholServedBy !== 'none' && facts.serverTraining === null)
    need('serverTraining');
  if (facts.pyrotechnics === null) need('pyrotechnics');
  if (facts.overnight === null) need('overnight');
  if (facts.priorClaims === null) need('priorClaims');
  if (facts.refusedBefore === null) need('refusedBefore');
  if (facts.limitDollars === null) need('limitDollars');
  if (facts.truthful !== true) need('truthful');
  if (!facts.signedBy) need('signedBy');

  const required: AttachmentKind[] =
    facts.dailyMax !== null && facts.dailyMax > LARGE_EVENT_DAILY
      ? [
          'risk_plan',
          'security_protocol',
          'site_map',
          'venue_contract',
          ...((facts.vendors?.security ?? 0) > 0 ? (['security_contract'] as const) : []),
        ]
      : [];
  const requiredAttachments = required.filter((kind) => !provided.includes(kind));
  return {
    missing,
    requiredAttachments,
    ready: missing.length === 0 && requiredAttachments.length === 0,
  };
}
