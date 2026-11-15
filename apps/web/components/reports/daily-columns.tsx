import { bucketByDay } from '@/lib/charts';

// Policies issued on each day of the month, as columns that grow up from the baseline. A day with none has a hairline.
export function DailyColumns({ issuedOn, month }: { issuedOn: string[]; month: string }) {
  const days = bucketByDay(issuedOn, month);
  const peak = Math.max(1, ...days.map((d) => d.count));
  const W = 560;
  const H = 96;
  const slot = W / days.length;
  // The columns stretch to the card's width at a fixed height; the day numbers are text beside them, so they keep
  // their size on a phone and on a wide screen alike.
  return (
    <figure>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Policies issued per day in ${month}`}
        className="h-24 w-full"
      >
        {days.map((d) => {
          const h = d.count === 0 ? 1.5 : Math.max(6, (d.count / peak) * (H - 8));
          return (
            <g key={d.day}>
              <title>{`${d.count} on day ${d.day}`}</title>
              <rect
                x={(d.day - 1) * slot + slot * 0.16}
                y={H - h}
                width={slot * 0.68}
                height={h}
                className={`grow-y ${d.count === 0 ? 'fill-line-strong' : 'fill-brand'}`}
                style={{ ['--i' as string]: d.day }}
              />
            </g>
          );
        })}
      </svg>
      <div
        className="relative mt-1 h-5 border-t border-line-strong text-[0.75rem] text-ink-faint"
        aria-hidden
      >
        {[1, 8, 15, 22, days.length].map((day) => (
          <span
            key={day}
            className="absolute top-0.5 -translate-x-1/2"
            style={{ left: `${((day - 0.5) / days.length) * 100}%` }}
          >
            {day}
          </span>
        ))}
      </div>
    </figure>
  );
}
