import type { PolicyReport } from './policy-report.js';

// One cell: quoted when it holds a comma, a quote or a line break, and made text when a spreadsheet would read it
// as a formula (a leading = + - or @), so an activity name cannot run code when the file is opened.
export function csvCell(value: string | number): string {
  let text = String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const dollars = (cents: number): string => (cents / 100).toFixed(2);

function toCsv(header: string[], rows: (string | number)[][]): string {
  return `${[header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

export function policyReportCsv(report: PolicyReport): string {
  return toCsv(
    [
      'Policy',
      'Program',
      'Issued',
      'Event date',
      'Venue',
      'Booking',
      'Activity',
      'Participants',
      'Hours',
      'Limit',
      'Net premium',
      'Commission',
      'Margin',
      'Fee',
      'Tax',
      'Total',
    ],
    report.lines.map((l) => [
      l.policyNumber,
      l.program,
      l.issuedOn,
      l.eventDate,
      l.venue,
      l.bookingRef,
      l.activity,
      l.participants,
      l.hours,
      dollars(l.limitCents),
      dollars(l.netCents),
      dollars(l.commissionCents),
      dollars(l.marginCents),
      dollars(l.feeCents),
      dollars(l.taxCents),
      dollars(l.totalCents),
    ]),
  );
}
