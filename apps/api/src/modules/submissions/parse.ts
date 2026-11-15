import { PDFDocument } from 'pdf-lib';
import type { VendorType } from '../../domain/types.js';
import {
  CHOICE_FIELDS,
  type ChoiceField,
  TEXT_FIELDS,
  type TextField,
  VENDOR_TYPES,
} from './fields.js';

export class NoFormFieldsError extends Error {
  constructor() {
    super('the PDF has no form fields: a scanned or printed form needs text recognition first');
    this.name = 'NoFormFieldsError';
  }
}

// The answers on a form, typed. null means the box was left blank or could not be read: it is never replaced by a guess.
export interface SubmissionFacts {
  organizerName: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  eventName: string | null;
  description: string | null;
  bookingRef: string | null;
  eventDate: string | null;
  startTime: string | null;
  endTime: string | null;
  eventDays: number | null;
  dailyMin: number | null;
  dailyMax: number | null;
  totalAttendance: number | null;
  shareUnder18: number | null;
  lastYearDailyMax: number | null;
  temporarySeats: number | null;
  /** Counts by kind; undefined when every vendor box is blank. */
  vendors: Partial<Record<VendorType, number>> | undefined;
  alcoholServedBy: 'none' | 'vendors' | 'caterer' | 'organizer' | null;
  serverTraining: boolean | null;
  pyrotechnics: boolean | null;
  overnight: boolean | null;
  priorClaims: boolean | null;
  refusedBefore: boolean | null;
  truthful: boolean | null;
  limitDollars: 2_000_000 | 5_000_000 | null;
  signedBy: string | null;
}

export interface ParsedSubmission {
  facts: SubmissionFacts;
  /** Boxes that hold something that is not what the box asks for (letters where a number goes). */
  unreadable: string[];
}

const INTEGER_FIELDS: readonly TextField[] = [
  'eventDays',
  'dailyMin',
  'dailyMax',
  'totalAttendance',
  'lastYearDailyMax',
  'temporarySeats',
];

// Reads the fields of a filled form. Dropdowns that were left unselected read as blank, so "no answer" and "no" differ.
export async function parseSubmission(bytes: Uint8Array): Promise<ParsedSubmission> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: false });
  const form = doc.getForm();
  if (form.getFields().length === 0) throw new NoFormFieldsError();

  const names = new Set(form.getFields().map((f) => f.getName()));
  const text = (name: TextField): string | null => {
    if (!names.has(name)) return null;
    const value = form.getTextField(name).getText()?.trim();
    return value ? value : null;
  };
  const choice = (name: ChoiceField): string | null => {
    if (!names.has(name)) return null;
    const value = form.getDropdown(name).getSelected()[0]?.trim();
    return value && (CHOICE_FIELDS[name] as readonly string[]).includes(value) ? value : null;
  };

  const unreadable: string[] = [];
  const integer = (name: TextField): number | null => {
    const raw = text(name);
    if (raw === null) return null;
    if (!/^\d{1,9}$/.test(raw.replace(/[ ,]/g, ''))) {
      unreadable.push(name);
      return null;
    }
    return Number(raw.replace(/[ ,]/g, ''));
  };
  const yesNo = (name: ChoiceField): boolean | null => {
    const value = choice(name);
    return value === null ? null : value === 'yes';
  };

  const vendorCounts: Partial<Record<VendorType, number>> = {};
  let anyVendorBox = false;
  for (const type of VENDOR_TYPES) {
    const count = integer(`vendor_${type}` as TextField);
    if (count !== null) {
      anyVendorBox = true;
      vendorCounts[type] = count;
    }
  }
  const percent = integer('shareUnder18');
  const limit = choice('limitDollars');

  const facts: SubmissionFacts = {
    organizerName: text('organizerName'),
    contactName: text('contactName'),
    contactEmail: text('contactEmail'),
    contactPhone: text('contactPhone'),
    eventName: text('eventName'),
    description: text('description'),
    bookingRef: text('bookingRef'),
    eventDate: text('eventDate'),
    startTime: text('startTime'),
    endTime: text('endTime'),
    eventDays: integer('eventDays'),
    dailyMin: integer('dailyMin'),
    dailyMax: integer('dailyMax'),
    totalAttendance: integer('totalAttendance'),
    shareUnder18: percent === null ? null : Math.min(percent, 100) / 100,
    lastYearDailyMax: integer('lastYearDailyMax'),
    temporarySeats: integer('temporarySeats'),
    vendors: anyVendorBox ? vendorCounts : undefined,
    alcoholServedBy: choice('alcoholServedBy') as SubmissionFacts['alcoholServedBy'],
    serverTraining: yesNo('serverTraining'),
    pyrotechnics: yesNo('pyrotechnics'),
    overnight: yesNo('overnight'),
    priorClaims: yesNo('priorClaims'),
    refusedBefore: yesNo('refusedBefore'),
    truthful: yesNo('truthful'),
    limitDollars: limit === null ? null : (Number(limit) as 2_000_000 | 5_000_000),
    signedBy: text('signedBy'),
  };
  // Every integer field was read above; this keeps the list of integer fields honest if one is added.
  void INTEGER_FIELDS;
  void TEXT_FIELDS;
  return { facts, unreadable };
}
