import { Card, CardHeader, Empty } from '@/components/ui/card';
import { day, relative } from '@/lib/format';
import type { AuditEntry, ProgramStatus } from '@/lib/types';
import { STATUS } from '@/lib/words';

const FIELDS: Record<string, string> = {
  brand: 'colour',
  logo: 'logo',
  tagline: 'tagline',
  welcome: 'welcome',
  supportEmail: 'e-mail',
  supportPhone: 'phone',
  telegram: 'Telegram',
  hours: 'hours',
};

const fields = (detail: Record<string, unknown>) =>
  ((detail.changed as string[] | undefined) ?? []).map((f) => FIELDS[f] ?? f).join(', ') ||
  'nothing new';

// One line per change, in words.
function sentence(entry: AuditEntry): string {
  const d = entry.detail;
  switch (entry.action) {
    case 'program.created':
      return `Created from the ${String(d.templateId).replaceAll('_', ' ')} template`;
    case 'rules.published':
      return `Rules version ${d.version} published, in force from ${day(String(d.effectiveFrom))}`;
    case 'appearance.changed':
      return `Appearance changed: ${fields(d)}`;
    case 'contacts.changed':
      return `Contacts changed: ${fields(d)}`;
    case 'status.changed':
      return `${STATUS[d.from as ProgramStatus].word} → ${STATUS[d.to as ProgramStatus].word}`;
    default:
      return entry.action;
  }
}

export function AuditLog({ entries }: { entries: AuditEntry[] }) {
  const now = new Date();
  return (
    <Card aria-label="Change log">
      <CardHeader title="Change log" note="Who changed what, newest first." />
      {entries.length === 0 ? (
        <Empty title="No changes recorded">
          Changes made since the log began show here, with the key that made them.
        </Empty>
      ) : (
        <ol className="divide-y divide-line">
          {entries.map((entry) => (
            <li key={entry.id} className="px-5 py-2.5">
              <p className="text-[0.9rem] text-ink">{sentence(entry)}</p>
              <p className="text-[0.78rem] text-ink-faint">
                <time dateTime={entry.at} title={entry.at}>
                  {relative(entry.at, now)}
                </time>{' '}
                · by {entry.actor}
              </p>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
