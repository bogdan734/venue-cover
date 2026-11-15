import { cx } from '@/lib/cx';
import { percent } from '@/lib/format';
import type { EvalResult, Metric } from '@/lib/types';

const METRICS: { key: 'top1' | 'outcomeAccuracy' | 'automaticRate'; name: string }[] = [
  { key: 'top1', name: 'Activity found' },
  { key: 'outcomeAccuracy', name: 'Routed right' },
  { key: 'automaticRate', name: 'Priced without a person' },
];
const SHADES = ['bg-line-strong', 'bg-[#8aa0d6]', 'bg-brand'];

function Bar({
  metric,
  shade,
  index,
  label,
}: {
  metric: Metric;
  shade: string;
  index: number;
  label: string;
}) {
  const value = metric.value ?? 0;
  return (
    <div className="flex items-center gap-3">
      <span className="w-44 shrink-0 truncate text-[0.82rem] text-ink-soft" title={label}>
        {label}
      </span>
      <div className="relative h-5 flex-1 rounded-sm bg-sunken/70">
        <div
          className={cx('grow-x h-full rounded-sm', shade)}
          style={{ width: `${value * 100}%`, ['--i' as string]: index }}
        />
        {/* the 95% interval, drawn over the bar as a whisker */}
        <div
          className="fade absolute top-1/2 h-px bg-ink/55"
          style={{
            left: `${metric.low * 100}%`,
            width: `${(metric.high - metric.low) * 100}%`,
            ['--i' as string]: index + 4,
          }}
          aria-hidden
        >
          <span className="absolute top-1/2 left-0 h-2.5 w-px -translate-y-1/2 bg-ink/55" />
          <span className="absolute top-1/2 right-0 h-2.5 w-px -translate-y-1/2 bg-ink/55" />
        </div>
      </div>
      <span className="w-14 shrink-0 text-right text-[0.88rem] text-ink">
        {percent(metric.value)}
      </span>
    </div>
  );
}

// The three setups side by side, one group of bars per measure, with the 95% interval as a whisker. Bars grow in.
export function SetupBars({
  evals,
  names,
}: {
  evals: EvalResult[];
  names: Record<string, string>;
}) {
  return (
    <div className="space-y-6">
      {METRICS.map((measure) => (
        <section key={measure.key} aria-label={measure.name}>
          <h4 className="mb-2 text-[0.85rem] font-semibold text-ink-soft">{measure.name}</h4>
          <div className="space-y-1.5">
            {evals.map((e, i) => (
              <Bar
                key={e.label}
                metric={e.summary[measure.key]}
                shade={SHADES[i] ?? 'bg-brand'}
                index={i}
                label={names[e.label] ?? e.label}
              />
            ))}
          </div>
        </section>
      ))}
      <p className="text-[0.8rem] text-ink-faint">
        The thin line over each bar is the 95% interval: where the true rate probably lies.
      </p>
    </div>
  );
}
