'use client';

import { ArrowRight, Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { Confirmed } from '@/app/p/[code]/actions';
import { TELEGRAM_NAME } from '@/components/portal/telegram-app';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/field';
import { type FormAction, useServerForm } from '@/components/use-server-form';
import { limit as limitWords } from '@/lib/format';
import type { AlcoholMode, QuestionDef, Questions } from '@/lib/types';

export interface ActivityOption {
  activityId: string;
  title: string;
  riskClass: string;
}

interface Props {
  code: string;
  action: FormAction;
  /** Asks the server which of the program's questions apply to the event as it stands now. */
  ask: (confirmed: Confirmed) => Promise<Questions>;
  options: ActivityOption[];
  facts: { participants: number | null; hours: number | null; alcohol: AlcoholMode | null };
  limits: number[];
  defaultDate: string;
  questions: QuestionDef[];
  /** The signed-in renter, who is usually the one insured. */
  holder: { name: string; email: string } | null;
  /** Makes pressing the button twice one request. */
  idem: string;
}

function QuestionField({ question }: { question: QuestionDef }) {
  const id = `q-${question.id}`;
  const name = `q:${question.type}:${question.id}`;
  return (
    <Field label={question.text} htmlFor={id}>
      {question.type === 'number' ? (
        <Input id={id} name={name} type="number" min={0} required />
      ) : (
        <Select id={id} name={name} required defaultValue="">
          <option value="" disabled>
            Choose…
          </option>
          {question.type === 'yesno' ? (
            <>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </>
          ) : (
            (question.choices ?? []).map((choice) => (
              <option key={choice} value={choice}>
                {choice}
              </option>
            ))
          )}
        </Select>
      )}
    </Field>
  );
}

// The details the price is built on. What the description said is filled in; the renter corrects what is wrong, and
// the program's own questions appear and disappear as the details change.
export function ConfirmForm(props: Props) {
  const { state, pending, onSubmit } = useServerForm(props.action);
  const [options, setOptions] = useState(props.options);
  const [activityId, setActivityId] = useState(props.options[0]?.activityId ?? '');
  const [participants, setParticipants] = useState(props.facts.participants?.toString() ?? '');
  const [hours, setHours] = useState(props.facts.hours?.toString() ?? '');
  const [alcohol, setAlcohol] = useState<AlcoholMode | ''>(props.facts.alcohol ?? '');
  const [questions, setQuestions] = useState(props.questions);

  const [query, setQuery] = useState('');
  const [found, setFound] = useState<ActivityOption[] | null>(null);

  // Someone who opened the portal in Telegram finds their name filled in, once the server has checked Telegram's signature.
  const holderName = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const name = sessionStorage.getItem(TELEGRAM_NAME);
    if (name && holderName.current && !holderName.current.value) holderName.current.value = name;
  }, []);

  // Ask again whenever a detail that the questions depend on changes; only the latest answer is used.
  const { ask } = props;
  const latest = useRef(0);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const call = ++latest.current;
    const timer = setTimeout(() => {
      const people = Number(participants);
      const length = Number(hours);
      ask({
        ...(activityId ? { activityId } : {}),
        ...(Number.isInteger(people) && people > 0 ? { participants: people } : {}),
        ...(length > 0 ? { hours: length } : {}),
        ...(alcohol ? { alcohol } : {}),
      })
        .then((answer) => {
          if (call === latest.current) setQuestions(answer.open);
        })
        .catch(() => {
          // The questions are checked again when the form is sent, so a failed lookup here is not fatal.
        });
    }, 250);
    return () => clearTimeout(timer);
  }, [ask, activityId, participants, hours, alcohol]);

  async function search() {
    const q = query.trim();
    if (!q) return;
    const response = await fetch(`/api/portal/${props.code}/activities?q=${encodeURIComponent(q)}`);
    const body = (await response.json()) as { activities: ActivityOption[] };
    setFound(body.activities);
  }

  function choose(option: ActivityOption) {
    setOptions((current) =>
      current.some((o) => o.activityId === option.activityId) ? current : [...current, option],
    );
    setActivityId(option.activityId);
    setFound(null);
    setQuery('');
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <input type="hidden" name="idem" value={props.idem} />

      <Field label="Activity" htmlFor="activityId">
        <Select
          id="activityId"
          name="activityId"
          required
          value={activityId}
          onChange={(event) => setActivityId(event.target.value)}
        >
          {options.length === 0 ? (
            <option value="" disabled>
              Search the catalogue below
            </option>
          ) : null}
          {options.map((option) => (
            <option key={option.activityId} value={option.activityId}>
              {option.title} (class {option.riskClass})
            </option>
          ))}
        </Select>
        <div className="mt-2 flex gap-2">
          <Input
            aria-label="Search the catalogue"
            placeholder="Not right? Search the catalogue"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void search();
              }
            }}
            className="h-9 text-sm"
          />
          <Button type="button" variant="secondary" size="sm" onClick={() => void search()}>
            <Search className="size-4" aria-hidden /> Search
          </Button>
        </div>
        {found ? (
          <ul
            aria-label="Search results"
            className="mt-2 divide-y divide-line rounded-control border border-line bg-surface"
          >
            {found.length === 0 ? (
              <li className="px-3 py-2 text-sm text-ink-faint">
                Nothing like that in the catalogue.
              </li>
            ) : (
              found.slice(0, 6).map((option) => (
                <li key={option.activityId}>
                  <button
                    type="button"
                    onClick={() => choose(option)}
                    className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors duration-150 hover:bg-sunken"
                  >
                    <span>{option.title}</span>
                    <span className="text-[0.8rem] text-ink-faint">class {option.riskClass}</span>
                  </button>
                </li>
              ))
            )}
          </ul>
        ) : null}
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="People" htmlFor="participants">
          <Input
            id="participants"
            name="participants"
            type="number"
            min={1}
            required
            value={participants}
            onChange={(event) => setParticipants(event.target.value)}
          />
        </Field>
        <Field label="Hours" htmlFor="hours">
          <Input
            id="hours"
            name="hours"
            type="number"
            min={0.5}
            step={0.5}
            required
            value={hours}
            onChange={(event) => setHours(event.target.value)}
          />
        </Field>
      </div>

      <Field label="Alcohol" htmlFor="alcohol">
        <Select
          id="alcohol"
          name="alcohol"
          required
          value={alcohol}
          onChange={(event) => setAlcohol(event.target.value as AlcoholMode)}
        >
          <option value="" disabled>
            Choose…
          </option>
          <option value="none">None</option>
          <option value="served">Served (free or hosted)</option>
          <option value="sold">Sold</option>
        </Select>
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Date" htmlFor="eventDate">
          <Input
            id="eventDate"
            name="eventDate"
            type="date"
            required
            defaultValue={props.defaultDate}
          />
        </Field>
        <Field label="Starts at" htmlFor="startTime">
          <Input id="startTime" name="startTime" type="time" required defaultValue="18:00" />
        </Field>
      </div>

      <fieldset>
        <legend className="mb-1.5 text-sm font-medium text-ink-soft">Liability limit</legend>
        <div className="flex flex-wrap gap-2">
          {props.limits.map((cents, index) => (
            <label
              key={cents}
              className="flex h-10 cursor-pointer items-center gap-2 rounded-control border border-line-strong bg-surface px-3.5 text-[0.95rem] transition-colors duration-150 has-checked:border-brand has-checked:bg-brand-soft has-checked:text-brand-strong"
            >
              <input
                type="radio"
                name="limitCents"
                value={cents}
                defaultChecked={index === 0}
                className="accent-brand"
              />
              {limitWords(cents)}
            </label>
          ))}
        </div>
      </fieldset>

      {questions.length > 0 ? (
        <fieldset className="space-y-4 rounded-control border border-line bg-sunken/40 p-4">
          <legend className="px-1 text-sm font-semibold text-ink">This program also asks</legend>
          {questions.map((question) => (
            <QuestionField key={question.id} question={question} />
          ))}
        </fieldset>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Your name" htmlFor="holderName">
          <Input
            ref={holderName}
            id="holderName"
            name="holderName"
            required
            maxLength={200}
            autoComplete="name"
            defaultValue={props.holder?.name}
          />
        </Field>
        <Field label="E-mail" htmlFor="holderEmail">
          <Input
            id="holderEmail"
            name="holderEmail"
            type="email"
            required
            autoComplete="email"
            defaultValue={props.holder?.email}
          />
        </Field>
      </div>

      <Field
        label="Booking reference (optional)"
        htmlFor="bookingRef"
        hint="From your booking. With it, the venue and its broker get their certificates without anyone forwarding them."
      >
        <Input id="bookingRef" name="bookingRef" maxLength={100} placeholder="R-1001" />
      </Field>

      {state.error ? <Notice tone="danger">{state.error}</Notice> : null}

      <Button type="submit" disabled={pending} aria-busy={pending} className="w-full">
        {pending ? 'Working out the price…' : 'Get my price'}
        {pending ? null : <ArrowRight className="size-4" aria-hidden />}
      </Button>
    </form>
  );
}
