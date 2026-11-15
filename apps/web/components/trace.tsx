import { Check, CircleAlert, ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import { hiddenCount, hiddenKinds, ModelView } from '@/components/model-view';
import { Badge, RiskClass } from '@/components/ui/badge';
import { Notice } from '@/components/ui/card';
import { cx } from '@/lib/cx';
import { count } from '@/lib/format';
import type { Reading, ReferralReason } from '@/lib/types';
import { ALCOHOL, flagWord, REASONS } from '@/lib/words';

// The working behind a decision, in the order it happened: the text, the facts read from it, where each activity was
// found in the catalogue, and what the program's rules made of it. The customer and the underwriter see the same one.

function Step({
  n,
  title,
  children,
  last,
}: {
  n: number;
  title: string;
  children: ReactNode;
  last?: boolean;
}) {
  return (
    <li className="relative flex gap-4 pb-7 last:pb-0">
      {last ? null : (
        <span
          className="absolute top-7 bottom-0 left-[0.6875rem] w-px bg-line-strong"
          aria-hidden
        />
      )}
      <span className="z-10 flex size-[1.4rem] shrink-0 items-center justify-center rounded-full border border-line-strong bg-surface text-[0.75rem] font-medium text-ink-soft">
        {n}
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="text-[0.85rem] font-semibold text-ink-soft">{title}</h3>
        <div className="mt-2">{children}</div>
      </div>
    </li>
  );
}

function Fact({ children, missing }: { children: ReactNode; missing?: boolean }) {
  return (
    <span
      className={cx(
        'inline-flex items-center rounded-control border px-2.5 py-1 text-[0.9rem]',
        missing
          ? 'border-dashed border-warn/50 bg-warn-soft/60 text-warn'
          : 'border-line bg-sunken/50 text-ink',
      )}
    >
      {children}
    </span>
  );
}

// A similarity from 0 to 1 as a bar with its number: long enough to compare candidates at a glance.
function Score({ value, accepted }: { value: number; accepted: boolean }) {
  const share = Math.max(0, Math.min(1, value));
  return (
    <span className="flex items-center gap-2">
      <span
        className="hidden h-1.5 w-20 overflow-hidden rounded-full bg-sunken sm:block"
        aria-hidden
      >
        <span
          className={cx('block h-full rounded-full', accepted ? 'bg-brand' : 'bg-line-strong')}
          style={{ width: `${share * 100}%` }}
        />
      </span>
      <span className="w-9 text-right text-[0.85rem] text-ink-soft">{share.toFixed(2)}</span>
    </span>
  );
}

export function ReasonList({ reasons }: { reasons: ReferralReason[] }) {
  return (
    <ul className="space-y-2.5">
      {reasons.map((reason) => (
        <li key={reason} className="flex gap-2.5">
          <CircleAlert className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
          <span>
            <span className="font-medium text-ink">{REASONS[reason].title}.</span>{' '}
            <span className="text-ink-soft">{REASONS[reason].detail}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export function Trace({
  read: c,
  verdict,
}: {
  read: Reading;
  /** What the rules made of it: priced on the spot, or the reasons a person has to look. Left out where the page
   *  already states the reasons. */
  verdict?: { auto: boolean; reasons: ReferralReason[] };
}) {
  const hidden = hiddenCount(c.maskedText);
  const kinds = hiddenKinds(c.maskedText);
  return (
    <ol>
      <Step n={1} title="What was written">
        <blockquote className="border-l-2 border-line-strong pl-3.5 text-ink italic">
          {c.text ?? <ModelView text={c.maskedText} />}
        </blockquote>
        {hidden > 0 ? (
          <section
            aria-label="What the model saw"
            className="rise mt-3 rounded-control border border-line bg-sunken/60 px-3.5 py-3"
          >
            <h4 className="flex items-center gap-1.5 text-[0.85rem] font-semibold text-ok">
              <ShieldCheck className="size-3.5" aria-hidden /> What the model saw
            </h4>
            <div className="mt-1.5">
              <ModelView text={c.maskedText} />
            </div>
            <p className="mt-2 text-sm text-ink-faint">
              {hidden === 1 ? 'One personal detail' : `${hidden} personal details`} (
              {kinds.join(', ')}) became tags before any model read the text. The originals are
              sealed with this program&rsquo;s own key: the renter and the underwriter see them, the
              model and the search index only ever see the tags.
            </p>
          </section>
        ) : null}
      </Step>

      <Step n={2} title="The facts read from it">
        <div className="flex flex-wrap gap-2">
          <Fact missing={c.facts.participants === null}>
            {c.facts.participants === null
              ? 'How many people: not said'
              : `${count(c.facts.participants)} people`}
          </Fact>
          <Fact missing={c.facts.hours === null}>
            {c.facts.hours === null ? 'How long: not said' : `${c.facts.hours} hours`}
          </Fact>
          <Fact missing={c.facts.alcohol === null}>
            {c.facts.alcohol === null ? 'Alcohol: not said' : ALCOHOL[c.facts.alcohol]}
          </Fact>
          {c.facts.flags.map((flag) => (
            <Badge key={flag} tone="warn" className="self-center">
              {flagWord(flag)}
            </Badge>
          ))}
        </div>
        {c.degraded ? (
          <div className="mt-3">
            <Notice tone="warn">
              The model and the plain rules read this text differently, so the stricter reading is
              used and a person checks it. This is also what happens when a text tries to instruct
              the model.
            </Notice>
          </div>
        ) : null}
      </Step>

      <Step n={3} title="Where it was found in the catalogue" last={!verdict}>
        {c.phrases.length === 0 ? (
          <p className="text-ink-soft">No activity could be read from the description.</p>
        ) : (
          <ul className="space-y-4">
            {c.phrases.map((phrase) => (
              <li key={phrase.phrase}>
                <p className="text-[0.92rem] text-ink">
                  “{phrase.phrase}”
                  {phrase.accepted ? null : (
                    <span className="ml-2 text-warn">matches nothing closely enough</span>
                  )}
                </p>
                <ul className="mt-1.5 divide-y divide-line rounded-control border border-line">
                  {phrase.candidates.map((candidate) => {
                    const accepted = phrase.accepted?.activityId === candidate.activityId;
                    return (
                      <li
                        key={candidate.activityId}
                        className={cx(
                          'flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-[0.9rem]',
                          accepted && 'bg-brand-soft/50',
                        )}
                      >
                        <span className="flex min-w-0 flex-1 items-center gap-1.5">
                          {accepted ? (
                            <Check className="size-4 shrink-0 text-brand" aria-label="Matched" />
                          ) : (
                            <span className="size-4 shrink-0" aria-hidden />
                          )}
                          <span className={cx('truncate', accepted && 'font-medium')}>
                            {candidate.title}
                          </span>
                        </span>
                        <RiskClass value={candidate.riskClass} />
                        <Score value={candidate.score} accepted={accepted} />
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </Step>

      {verdict ? (
        <Step n={4} title="What the program’s rules say" last>
          {verdict.auto ? (
            <p className="flex items-start gap-2.5">
              <Check className="mt-0.5 size-4 shrink-0 text-ok" aria-hidden />
              <span>
                <span className="font-medium text-ink">Can be priced on the spot.</span>{' '}
                <span className="text-ink-soft">
                  Nothing in the description needs a person, as far as it goes.
                </span>
              </span>
            </p>
          ) : (
            <ReasonList reasons={verdict.reasons} />
          )}
        </Step>
      ) : null}
    </ol>
  );
}
