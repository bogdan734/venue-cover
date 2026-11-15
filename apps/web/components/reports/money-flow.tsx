import { shares } from '@/lib/charts';
import { money } from '@/lib/format';

const PARTS = [
  { key: 'carrierCents', name: 'insurer', colour: 'var(--color-brand)' },
  { key: 'commissionCents', name: 'broker', colour: '#5f7fca' },
  { key: 'retainedCents', name: 'kept', colour: 'var(--color-gold)' },
  { key: 'taxCents', name: 'tax', colour: '#9aa1b0' },
] as const;

type Row = Record<(typeof PARTS)[number]['key'], number> & { totalCents: number };

// Where one program's premium for the month goes, as a bar split four ways. The title of each part states the amount.
export function MoneyFlow({ row, index }: { row: Row; index: number }) {
  const pct = shares(PARTS.map((p) => row[p.key]));
  return (
    <div
      className="flex h-2.5 w-44 overflow-hidden rounded-full bg-sunken"
      role="img"
      aria-label={PARTS.map((p, i) => `${p.name} ${pct[i]}%`).join(', ')}
    >
      {PARTS.map((part, i) => (
        <span
          key={part.key}
          title={`${part.name}: ${money(row[part.key])} (${pct[i]}%)`}
          className="grow-x h-full border-r border-surface last:border-r-0"
          style={{
            width: `${(row[part.key] / (row.totalCents || 1)) * 100}%`,
            backgroundColor: part.colour,
            ['--i' as string]: index + i,
          }}
        />
      ))}
    </div>
  );
}

export function MoneyFlowLegend() {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 px-5 py-2.5 text-[0.8rem] text-ink-soft">
      {PARTS.map((part) => (
        <li key={part.key} className="flex items-center gap-1.5">
          <span
            className="size-2.5 rounded-sm"
            style={{ backgroundColor: part.colour }}
            aria-hidden
          />
          to the {part.name === 'kept' ? 'MGA (kept)' : part.name}
        </li>
      ))}
    </ul>
  );
}
