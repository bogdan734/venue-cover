'use client';

import { ArrowRight, CircleAlert } from 'lucide-react';
import { useState, useTransition } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, Notice } from '@/components/ui/card';
import { Field, Input, Textarea } from '@/components/ui/field';
import { Table, Td, Th } from '@/components/ui/table';
import { count, limitShort } from '@/lib/format';
import type { ProgramRules, RulesChanges, RulesDraft, RulesPreview } from '@/lib/types';
import { REASONS } from '@/lib/words';

type Failure = { error: string };
const failed = (value: unknown): value is Failure =>
  typeof value === 'object' && value !== null && 'error' in value;

interface Props {
  rules: ProgramRules;
  titles: Record<string, string>;
  examples: readonly { label: string; text: string }[];
  today: string;
  idem: string;
  draft: (letter: string) => Promise<RulesDraft | Failure>;
  preview: (changes: RulesChanges) => Promise<RulesPreview | Failure>;
  publish: (
    changes: RulesChanges,
    effectiveFrom: string,
    idem: string,
  ) => Promise<{ version: number; effectiveFrom: string } | Failure>;
}

const LABELS: Record<string, string> = {
  autoConfidenceMin: 'Confidence needed to price unseen',
  autoMaxClass: 'Highest risk class priced unseen',
  maxParticipantsAuto: 'Largest crowd priced unseen',
  alcoholAuto: 'Alcohol priced unseen',
  excludedActivityIds: 'Activities never priced unseen',
  limitsCents: 'Liability limits offered',
  questions: 'Program questions',
};

function show(field: string, value: unknown, titles: Record<string, string>): string {
  if (field === 'limitsCents') return (value as number[]).map(limitShort).join(', ');
  if (field === 'excludedActivityIds') {
    const ids = value as string[];
    return ids.length === 0 ? 'none' : ids.map((id) => titles[id] ?? id).join(', ');
  }
  if (field === 'alcoholAuto') return value ? 'yes' : 'no, a person decides';
  if (field === 'maxParticipantsAuto') return `${count(value as number)} people`;
  if (field === 'autoMaxClass') return `class ${value}`;
  return String(value);
}

// The three steps of changing a program's rules: read the client's letter, see what it would change on recent quotes,
// then publish from a date. Each step only reads, except the last.
export function RulesWorkshop(props: Props) {
  const [letter, setLetter] = useState('');
  const [drafted, setDrafted] = useState<RulesDraft>();
  const [previewed, setPreviewed] = useState<RulesPreview>();
  const [published, setPublished] = useState<string>();
  const [error, setError] = useState<string>();
  const [from, setFrom] = useState(props.today);
  const [pending, start] = useTransition();

  const run = <T,>(work: () => Promise<T | Failure>, then: (value: T) => void) =>
    start(async () => {
      setError(undefined);
      const result = await work();
      if (failed(result)) setError(result.error);
      else then(result);
    });

  const hasChanges = drafted && Object.keys(drafted.changes).length > 0;
  const titles = { ...props.titles, ...drafted?.titles };

  return (
    <div className="space-y-6">
      <Card aria-label="Step 1: read the client's letter">
        <CardHeader
          title="1 · Paste what the client wrote"
          note="Requirements in plain words, as they arrive by e-mail."
        />
        <CardBody>
          <Field label="The client’s letter" htmlFor="letter">
            <Textarea
              id="letter"
              rows={5}
              value={letter}
              onChange={(event) => setLetter(event.target.value)}
              placeholder="Our gyms are dry facilities. We accept a $2 million limit only. Please have a person look at anything over 150 guests…"
            />
          </Field>
          <ul className="mt-3 flex flex-wrap gap-2">
            {props.examples.map((example) => (
              <li key={example.label}>
                <button
                  type="button"
                  onClick={() => setLetter(example.text)}
                  className="rounded-full border border-line-strong bg-surface px-3.5 py-1.5 text-sm text-ink-soft transition-colors duration-150 hover:border-brand hover:text-brand"
                >
                  {example.label}
                </button>
              </li>
            ))}
          </ul>
          <Button
            type="button"
            className="mt-4"
            disabled={pending || letter.trim().length < 3}
            onClick={() =>
              run(
                () => props.draft(letter),
                (value) => {
                  setDrafted(value);
                  setPreviewed(undefined);
                  setPublished(undefined);
                },
              )
            }
          >
            Draft the rules <ArrowRight className="size-4" aria-hidden />
          </Button>
          <p className="mt-2 text-sm text-ink-faint">
            A draft is a proposal. Nothing changes until step 3.
          </p>
        </CardBody>
      </Card>

      {error ? <Notice tone="danger">{error}</Notice> : null}

      {drafted ? (
        <Card aria-label="Step 2: the draft and its effect">
          <CardHeader
            title="2 · What the letter would change"
            aside={
              drafted.degraded ? <Badge tone="warn">read two ways, stricter used</Badge> : null
            }
          />
          <CardBody className="space-y-5">
            {hasChanges ? (
              <ul className="divide-y divide-line rounded-control border border-line">
                {drafted.notes.map((note) => (
                  <li
                    key={note.field}
                    className="grid gap-1 px-4 py-3 sm:grid-cols-[14rem_minmax(0,1fr)]"
                  >
                    <span className="font-medium text-ink">{LABELS[note.field] ?? note.field}</span>
                    <span className="text-[0.92rem]">
                      <span className="text-ink-faint line-through">
                        {show(note.field, note.from, titles)}
                      </span>
                      <ArrowRight className="mx-2 inline size-3.5 text-ink-faint" aria-hidden />
                      <span className="font-medium text-ink">
                        {show(note.field, note.to, titles)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <Notice tone="info">
                The letter did not name anything that differs from the rules in force.
              </Notice>
            )}

            {drafted.unresolved.length > 0 ? (
              <div className="rounded-control border border-warn/30 bg-warn-soft/60 px-4 py-3">
                <p className="flex items-center gap-2 text-sm font-semibold text-warn">
                  <CircleAlert className="size-4" aria-hidden /> A person has to look at these
                </p>
                <ul className="mt-1.5 list-disc pl-5 text-sm text-ink-soft">
                  {drafted.unresolved.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {hasChanges ? (
              <div>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={pending}
                  onClick={() => run(() => props.preview(drafted.changes), setPreviewed)}
                >
                  See what it would change on recent quotes
                </Button>
              </div>
            ) : null}

            {previewed ? (
              <div data-testid="preview">
                <p className="text-[0.95rem] text-ink">
                  Of the last <b>{previewed.summary.examined}</b> quotes,{' '}
                  <b>{previewed.summary.unchanged}</b> would go the same way,{' '}
                  <b>{previewed.summary.nowAuto}</b> would now be priced without a person,{' '}
                  <b>{previewed.summary.nowRefer}</b> would now need one and{' '}
                  <b>{previewed.summary.reasonsChanged}</b> would keep their outcome with other
                  reasons.
                </p>
                {previewed.changed.length > 0 ? (
                  <div className="mt-3 overflow-hidden rounded-control border border-line">
                    <Table>
                      <thead>
                        <tr>
                          <Th>Event</Th>
                          <Th numeric>People</Th>
                          <Th>Before</Th>
                          <Th>After</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {previewed.changed.slice(0, 12).map((row) => (
                          <tr key={row.quoteId}>
                            <Td>{row.activityTitle}</Td>
                            <Td numeric>{count(row.participants)}</Td>
                            <Td>
                              {row.before.outcome === 'auto'
                                ? 'Priced unseen'
                                : row.before.reasons.map((r) => REASONS[r].title).join(', ')}
                            </Td>
                            <Td>
                              {row.after.outcome === 'auto'
                                ? 'Priced unseen'
                                : row.after.reasons.map((r) => REASONS[r].title).join(', ')}
                            </Td>
                          </tr>
                        ))}
                      </tbody>
                    </Table>
                  </div>
                ) : null}
              </div>
            ) : null}
          </CardBody>
        </Card>
      ) : null}

      {drafted && hasChanges ? (
        <Card aria-label="Step 3: publish">
          <CardHeader
            title="3 · Publish from a date"
            note="Quotes made before the date keep the rules they were made under."
          />
          <CardBody>
            {published ? (
              <Notice tone="ok">{published}</Notice>
            ) : (
              <div className="flex flex-wrap items-end gap-3">
                <Field label="Effective from" htmlFor="from">
                  <Input
                    id="from"
                    type="date"
                    min={props.today}
                    value={from}
                    onChange={(event) => setFrom(event.target.value)}
                  />
                </Field>
                <Button
                  type="button"
                  disabled={pending || !from}
                  onClick={() =>
                    run(
                      () => props.publish(drafted.changes, from, props.idem),
                      (value) =>
                        setPublished(
                          `Published as version ${value.version}, in force from ${value.effectiveFrom}.`,
                        ),
                    )
                  }
                >
                  Publish these rules
                </Button>
              </div>
            )}
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
