import { money } from '@/lib/format';
import type { PremiumBreakdown } from '@/lib/types';

// Where a premium goes, as one bar and the same figures in a table. The parts always add up to the total: that is an
// invariant of the rating code, not something this component checks.
const PARTS = [
  {
    key: 'netCents',
    name: 'To the insurer',
    note: 'the net premium for the risk',
    colour: 'var(--color-brand)',
  },
  {
    key: 'commissionCents',
    name: 'Broker commission',
    note: 'for placing the program',
    colour: '#5f7fca',
  },
  {
    key: 'marginCents',
    name: 'Program administration',
    note: 'running the portal and underwriting',
    colour: '#a9b9e3',
  },
  { key: 'feeCents', name: 'Policy fee', note: 'one per policy', colour: 'var(--color-gold)' },
  {
    key: 'taxCents',
    name: 'Provincial premium tax',
    note: 'collected for the province',
    colour: '#9aa1b0',
  },
] as const;

export function PremiumSplit({ premium }: { premium: PremiumBreakdown }) {
  const parts = PARTS.map((part) => ({ ...part, cents: premium[part.key] })).filter(
    (part) => part.cents > 0,
  );
  return (
    <div>
      <div
        className="flex h-3 w-full overflow-hidden rounded-full bg-sunken"
        role="img"
        aria-label={`The premium of ${money(premium.totalCents)} split into its parts; the table below gives each amount.`}
      >
        {parts.map((part, index) => (
          <span
            key={part.key}
            style={{
              width: `${(part.cents / premium.totalCents) * 100}%`,
              backgroundColor: part.colour,
              ['--i' as string]: index,
            }}
            className="grow-x h-full border-r border-surface last:border-r-0"
          />
        ))}
      </div>
      <table className="mt-4 w-full text-[0.92rem]">
        <tbody>
          {parts.map((part) => (
            <tr key={part.key} className="border-b border-line last:border-b-0">
              <th scope="row" className="py-2 pr-3 text-left font-normal">
                <span className="flex items-baseline gap-2.5">
                  <span
                    className="size-2.5 shrink-0 translate-y-px rounded-sm"
                    style={{ backgroundColor: part.colour }}
                    aria-hidden
                  />
                  <span>
                    <span className="text-ink">{part.name}</span>
                    <span className="ml-2 text-[0.82rem] text-ink-faint">{part.note}</span>
                  </span>
                </span>
              </th>
              <td className="py-2 text-right whitespace-nowrap text-ink">{money(part.cents)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" className="pt-3 text-left font-semibold text-ink">
              Total
            </th>
            <td className="pt-3 text-right font-semibold whitespace-nowrap text-ink">
              {money(premium.totalCents)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
