import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import type { Contact } from '../../domain/types.js';
import type { PolicyView } from './view.js';

export type Holder = 'insured' | 'venue' | 'broker';
export const HOLDERS: readonly Holder[] = ['insured', 'venue', 'broker'];

// The parties that get a certificate: the insured always, the venue and broker only when the rental was identified.
export function recipientsOf(policy: PolicyView): { holder: Holder; contact: Contact }[] {
  const { holder, recipients } = policy.snapshot;
  return [
    { holder: 'insured' as const, contact: holder },
    ...(recipients.venue ? [{ holder: 'venue' as const, contact: recipients.venue }] : []),
    ...(recipients.broker ? [{ holder: 'broker' as const, contact: recipients.broker }] : []),
  ];
}

const dollars = (cents: number) =>
  `$${(cents / 100).toLocaleString('en-CA', { minimumFractionDigits: 0 })}`;
const day = (iso: string) => iso.slice(0, 10);

// A plain one-page certificate. It is a demonstration document and says so.
export async function renderCertificate(policy: PolicyView, holder: Holder): Promise<Uint8Array> {
  const contact = recipientsOf(policy).find((r) => r.holder === holder)?.contact;
  if (!contact) throw new Error(`policy ${policy.policyNumber} has no ${holder} certificate`);
  const s = policy.snapshot;

  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  let y = 780;
  const line = (label: string, value: string) => {
    page.drawText(label, { x: 60, y, size: 10, font: bold, color: rgb(0.25, 0.25, 0.25) });
    page.drawText(value, { x: 200, y, size: 11, font });
    y -= 24;
  };

  page.drawText('Certificate of Insurance', { x: 60, y, size: 22, font: bold });
  y -= 22;
  page.drawText('Demonstration document, not a contract of insurance', {
    x: 60,
    y,
    size: 9,
    font,
    color: rgb(0.6, 0.1, 0.1),
  });
  y -= 40;
  line('Policy number', policy.policyNumber);
  line('Certificate holder', contact.name);
  line('Role', holder);
  line('Insured', s.holder.name);
  line('Programme', s.programName);
  line('Activity', s.activityTitle);
  line('Venue', s.venue?.name ?? 'not identified');
  line('Booking reference', s.bookingRef ?? 'not provided');
  line('Period of insurance', `${day(policy.startsAt)} to ${day(policy.endsAt)}`);
  line('Limit of liability', dollars(s.limitCents));
  line('Expected attendance', String(s.participants));
  line('Issued', day(policy.issuedAt));

  return pdf.save();
}
