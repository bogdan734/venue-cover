import type { VendorType } from '../../domain/types.js';

// The fields of the large-event application form (own design). One list drives the form that is generated, the parser
// and the wording of a reply that asks for what is missing.
export const VENDOR_TYPES: readonly VendorType[] = [
  'food',
  'liquor',
  'performer',
  'retail',
  'animal',
  'carnival',
  'dunk_tank',
  'inflatable',
  'security',
];

export const TEXT_FIELDS = [
  'organizerName',
  'contactName',
  'contactEmail',
  'contactPhone',
  'eventName',
  'description',
  'bookingRef',
  'eventDate',
  'startTime',
  'endTime',
  'eventDays',
  'dailyMin',
  'dailyMax',
  'totalAttendance',
  'shareUnder18',
  'lastYearDailyMax',
  'temporarySeats',
  'signedBy',
  'vendor_food',
  'vendor_liquor',
  'vendor_performer',
  'vendor_retail',
  'vendor_animal',
  'vendor_carnival',
  'vendor_dunk_tank',
  'vendor_inflatable',
  'vendor_security',
] as const;
export type TextField = (typeof TEXT_FIELDS)[number];

const YES_NO = ['yes', 'no'] as const;
export const CHOICE_FIELDS = {
  alcoholServedBy: ['none', 'vendors', 'caterer', 'organizer'],
  serverTraining: YES_NO,
  pyrotechnics: YES_NO,
  overnight: YES_NO,
  priorClaims: YES_NO,
  refusedBefore: YES_NO,
  truthful: YES_NO,
  limitDollars: ['2000000', '5000000'],
} as const;
export type ChoiceField = keyof typeof CHOICE_FIELDS;

export type SubmissionValues = Partial<Record<TextField | ChoiceField, string>>;

export const LABELS: Record<TextField | ChoiceField, string> = {
  organizerName: 'the name of the organization or person applying',
  contactName: 'a contact name',
  contactEmail: 'a contact e-mail address',
  contactPhone: 'a contact phone number',
  eventName: 'the name of the event',
  description: 'a description of the event',
  bookingRef: 'the rental or booking number',
  eventDate: 'the event date (YYYY-MM-DD)',
  startTime: 'the daily start time (HH:MM)',
  endTime: 'the daily end time (HH:MM)',
  eventDays: 'the number of days',
  dailyMin: 'the smallest expected daily attendance',
  dailyMax: 'the largest expected daily attendance',
  totalAttendance: 'the total attendance over the whole event',
  shareUnder18: 'the share of attendees under 18 (percent)',
  lastYearDailyMax: "last year's largest daily attendance",
  temporarySeats: 'the number of temporary seats (0 if none)',
  signedBy: 'the name of the person completing the form',
  vendor_food: 'the number of food vendors',
  vendor_liquor: 'the number of vendors serving alcohol',
  vendor_performer: 'the number of performers',
  vendor_retail: 'the number of vendors selling products',
  vendor_animal: 'the number of animal rides or exhibits',
  vendor_carnival: 'the number of carnival games',
  vendor_dunk_tank: 'the number of dunk tanks',
  vendor_inflatable: 'the number of inflatables',
  vendor_security: 'the number of security services',
  alcoholServedBy: 'who serves the alcohol (none, vendors, caterer or organizer)',
  serverTraining: 'whether all alcohol servers hold a server certificate',
  pyrotechnics: 'whether there are fireworks or pyrotechnics',
  overnight: 'whether the event includes overnight stays or camping',
  priorClaims: 'whether there was a claim in the last five years',
  refusedBefore: 'whether the event was ever refused insurance or cancelled',
  truthful: 'the confirmation that the information is complete and true',
  limitDollars: 'the liability limit you need (2,000,000 or 5,000,000 dollars)',
};
