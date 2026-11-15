'use client';

import { useState } from 'react';
import { percent } from '@/lib/format';
import type { EvalResult } from '@/lib/types';

// How far the automation can be trusted as the threshold moves: the share priced without a person and the share routed
// right, as two lines that draw themselves in, with the number of unsafe cases at each point. Hover or focus a column
// for the figures. Plain SVG, no library.
export function ThresholdChart({ sweep }: { sweep: EvalResult['sweep'] }) {
  const W = 560;
  const H = 240;
  const pad = { l: 42, r: 30, t: 16, b: 50 };
  const [at, setAt] = useState<number | null>(null);
  const x = (i: number) => pad.l + (i * (W - pad.l - pad.r)) / (sweep.length - 1);
  const y = (value: number | null) => pad.t + (1 - (value ?? 0)) * (H - pad.t - pad.b);
  const path = (pick: (row: EvalResult['sweep'][number]) => number | null) =>
    sweep
      .map((row, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)} ${y(pick(row)).toFixed(1)}`)
      .join(' ');
  const area = `${path((r) => r.outcomeAccuracy)} L${x(sweep.length - 1)} ${y(0)} L${x(0)} ${y(0)} Z`;
  const row = at === null ? undefined : sweep[at];

  return (
    <figure className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Share routed right and share priced without a person, by confidence threshold"
        className="w-full"
      >
        <defs>
          <linearGradient id="routed-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--color-brand)" stopOpacity="0.18" />
            <stop offset="100%" stopColor="var(--color-brand)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 0.25, 0.5, 0.75, 1].map((tick) => (
          <g key={tick}>
            <line x1={pad.l} x2={W - pad.r} y1={y(tick)} y2={y(tick)} className="stroke-line" />
            <text
              x={pad.l - 8}
              y={y(tick) + 4}
              textAnchor="end"
              className="fill-ink-faint text-[10px]"
            >
              {tick * 100}%
            </text>
          </g>
        ))}
        <path d={area} fill="url(#routed-fill)" className="fade" style={{ ['--i' as string]: 4 }} />
        <path
          d={path((r) => r.outcomeAccuracy)}
          pathLength={1}
          className="draw fill-none stroke-brand"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d={path((r) => r.automaticRate)}
          pathLength={1}
          className="draw fill-none stroke-gold"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ ['--i' as string]: 1 }}
        />
        {at !== null ? (
          <line
            x1={x(at)}
            x2={x(at)}
            y1={pad.t}
            y2={H - pad.b}
            className="stroke-ink-faint"
            strokeDasharray="3 3"
          />
        ) : null}
        {sweep.map((r, i) => (
          <g key={r.autoConfidenceMin}>
            <circle
              cx={x(i)}
              cy={y(r.outcomeAccuracy)}
              r={at === i ? 5 : 3.2}
              className="pop fill-brand"
              style={{ ['--i' as string]: i }}
            />
            <circle
              cx={x(i)}
              cy={y(r.automaticRate)}
              r={at === i ? 5 : 3.2}
              className="pop fill-gold"
              style={{ ['--i' as string]: i }}
            />
            <text
              x={x(i)}
              y={H - pad.b + 18}
              textAnchor="middle"
              className="fill-ink-soft text-[10px]"
            >
              {r.autoConfidenceMin}
            </text>
            <text
              x={x(i)}
              y={H - pad.b + 32}
              textAnchor="middle"
              className={
                r.unsafeAutomation === 0
                  ? 'fill-ok text-[10px]'
                  : 'fill-danger text-[10px] font-semibold'
              }
            >
              {r.unsafeAutomation} unsafe
            </text>
            {/* biome-ignore lint/a11y/useSemanticElements: a hit area inside an SVG cannot be a <button> */}
            <rect
              x={x(i) - 22}
              y={pad.t}
              width={44}
              height={H - pad.t - pad.b + 40}
              fill="transparent"
              tabIndex={0}
              role="button"
              aria-label={`Threshold ${r.autoConfidenceMin}: routed right ${percent(r.outcomeAccuracy)}, priced unseen ${percent(r.automaticRate)}, ${r.unsafeAutomation} unsafe`}
              onMouseEnter={() => setAt(i)}
              onMouseLeave={() => setAt(null)}
              onFocus={() => setAt(i)}
              onBlur={() => setAt(null)}
            />
          </g>
        ))}
      </svg>
      {row ? (
        <div className="pointer-events-none absolute top-1 right-2 rounded-control border border-line bg-surface px-3 py-2 text-[0.82rem] shadow-sm">
          <p className="text-[0.8rem] text-ink-faint">threshold {row.autoConfidenceMin}</p>
          <p className="text-ink">
            <span className="mr-1.5 inline-block size-2 rounded-full bg-brand" />
            routed right <b>{percent(row.outcomeAccuracy)}</b>
          </p>
          <p className="text-ink">
            <span className="mr-1.5 inline-block size-2 rounded-full bg-gold" />
            priced unseen <b>{percent(row.automaticRate)}</b>
          </p>
          <p className={row.unsafeAutomation === 0 ? 'text-ok' : 'text-danger'}>
            {row.unsafeAutomation} unsafe
          </p>
        </div>
      ) : null}
      <figcaption className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-ink-soft">
        <span className="flex items-center gap-2">
          <span className="h-0.5 w-5 bg-brand" aria-hidden /> routed right (auto or person)
        </span>
        <span className="flex items-center gap-2">
          <span className="h-0.5 w-5 bg-gold" aria-hidden /> priced without a person
        </span>
        <span>Horizontal: the confidence a match needs before a program prices unseen.</span>
      </figcaption>
    </figure>
  );
}
