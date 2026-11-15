import type { Metric } from './metrics.js';
import type { EvalReport } from './runner.js';

const pct = (m: Metric) =>
  m.value === null
    ? 'n/a'
    : `${(m.value * 100).toFixed(1)}% (${(m.low * 100).toFixed(1)}–${(m.high * 100).toFixed(1)}, n=${m.n})`;

// A markdown report: the headline metrics with 95% Wilson intervals, results by kind of case and the worst misses.
export function renderReport(report: EvalReport, date: string): string {
  const s = report.summary;
  const lines = [
    `# Evaluation: ${report.provider}, ${date}`,
    '',
    `${s.n} synthetic descriptions, judged against the reference rules (automatic up to class B, 300 people, alcohol allowed).`,
    'Intervals are 95% Wilson score intervals.',
    '',
    '| Metric | Result |',
    '|---|---|',
    `| Top-1 activity accuracy | ${pct(s.top1)} |`,
    `| Risk class accuracy | ${pct(s.classAccuracy)} |`,
    `| Outcome accuracy (auto or refer) | ${pct(s.outcomeAccuracy)} |`,
    `| Referral recall (must-refer cases that were referred) | ${pct(s.referralRecall)} |`,
    `| Referral precision (referrals that were needed) | ${pct(s.referralPrecision)} |`,
    `| Automatic rate | ${pct(s.automaticRate)} |`,
    `| **Unsafe automation** (should refer, priced automatically) | **${s.unsafeAutomation}** |`,
    `| Latency p50 / p95 | ${s.latencyMs.p50.toFixed(0)} ms / ${s.latencyMs.p95.toFixed(0)} ms |`,
    '',
    '## By kind of case',
    '',
    '| Kind | Cases | Top-1 | Outcome accuracy |',
    '|---|---|---|---|',
    ...Object.entries(s.byTag)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([tag, g]) => `| ${tag} | ${g.n} | ${pct(g.top1)} | ${pct(g.outcomeAccuracy)} |`),
    '',
  ];
  const unsafe = report.results.filter(
    (r) => r.expected.outcome === 'refer' && r.got.outcome === 'auto',
  );
  const misses = report.results
    .filter((r) => r.expected.outcome === 'auto' && r.got.outcome === 'refer')
    .slice(0, 15);
  if (unsafe.length > 0) {
    lines.push(
      '## Unsafe automation',
      '',
      ...unsafe.map((r) => `- ${r.id}: "${r.text}" priced as ${r.got.title} (${r.got.riskClass})`),
      '',
    );
  }
  lines.push(
    '## Needless referrals (first 15)',
    '',
    ...misses.map((r) => `- ${r.id}: "${r.text}" -> ${r.got.reasons.join(', ')}`),
    '',
  );
  return lines.join('\n');
}
