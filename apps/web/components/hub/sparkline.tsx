import { count, day } from '@/lib/format';
import type { ClientSummary } from '@/lib/types';

const WIDTH = 120;
const HEIGHT = 30;
const TOP = 6; // room above the tallest bar for a policy mark

// A client's month at a glance: visitors as bars, a gold mark over each day a policy was issued. The figures beside it
// in the table carry the numbers; this carries the shape.
export function Sparkline({ daily }: { daily: ClientSummary['daily'] }) {
  const most = Math.max(1, ...daily.map((d) => d.visits));
  const step = WIDTH / daily.length;
  const busiest = daily.reduce(
    (a, b) => (b.visits > a.visits ? b : a),
    daily[0] ?? { day: '', visits: 0, policies: 0 },
  );
  const visits = daily.reduce((sum, d) => sum + d.visits, 0);
  const policyDays = daily.filter((d) => d.policies > 0).length;
  const label =
    visits === 0
      ? `No visitors in ${daily.length} days; policies issued on ${policyDays} of them`
      : `${count(visits)} visitors in ${daily.length} days, most on ${day(busiest.day)}; policies issued on ${policyDays} days`;

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      width={WIDTH}
      height={HEIGHT}
      role="img"
      aria-label={label}
      className="block overflow-visible"
    >
      <line x1={0} x2={WIDTH} y1={HEIGHT - 0.5} y2={HEIGHT - 0.5} className="stroke-line" />
      {daily.map((d, i) => {
        const height = d.visits === 0 ? 0 : Math.max(1.5, (d.visits / most) * (HEIGHT - TOP));
        return (
          <g key={d.day}>
            {height > 0 ? (
              <rect
                x={i * step + 0.5}
                y={HEIGHT - height}
                width={step - 1}
                height={height}
                rx={0.75}
                className="fill-brand/55"
              />
            ) : null}
            {d.policies > 0 ? (
              <circle cx={i * step + step / 2} cy={2} r={1.6} className="fill-gold" />
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}
