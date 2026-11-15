'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/field';
import { type FormAction, useServerForm } from '@/components/use-server-form';
import { bps, money } from '@/lib/format';
import type { ProgramOptions } from '@/lib/types';

const TEMPLATE_NAMES: Record<string, string> = {
  municipal: 'Municipal facilities',
  school_board: 'School board',
  community_hall: 'Community hall',
};

// A new client in one form: a template for terms and rules, then who they are. The rules can be changed afterwards.
export function NewProgramForm({
  action,
  options,
  provinces,
  idem,
}: {
  action: FormAction;
  options: ProgramOptions;
  provinces: readonly string[];
  idem: string;
}) {
  const { state, pending, onSubmit } = useServerForm(action);
  const [templateId, setTemplateId] = useState(options.templates[0]?.id ?? '');
  const template = options.templates.find((t) => t.id === templateId);

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <input type="hidden" name="idem" value={idem} />
      <Field label="Start from" htmlFor="templateId">
        <Select
          id="templateId"
          name="templateId"
          value={templateId}
          onChange={(event) => setTemplateId(event.target.value)}
        >
          {options.templates.map((t) => (
            <option key={t.id} value={t.id}>
              {TEMPLATE_NAMES[t.id] ?? t.id}
            </option>
          ))}
        </Select>
        {template ? (
          <p className="mt-2 text-sm text-ink-faint">
            Loading {bps(template.terms.loadingBps)}, commission {bps(template.terms.commissionBps)}
            , fee {money(template.terms.feeCents)}; priced automatically up to class{' '}
            {template.rules.autoMaxClass}, {template.rules.maxParticipantsAuto} people.
          </p>
        ) : null}
      </Field>
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_8rem]">
        <Field label="Client name" htmlFor="name">
          <Input
            id="name"
            name="name"
            required
            minLength={2}
            maxLength={120}
            placeholder="Lakeview Parks and Recreation"
          />
        </Field>
        <Field label="Code" htmlFor="code" hint="3 to 6 capitals">
          <Input
            id="code"
            name="code"
            required
            pattern="[A-Za-z][A-Za-z0-9]{2,5}"
            placeholder="LKV"
            className="font-mono uppercase"
          />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Province" htmlFor="province">
          <Select id="province" name="province" defaultValue="ON">
            {provinces.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Broker" htmlFor="brokerId">
          <Select id="brokerId" name="brokerId">
            {options.brokers.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {state.error ? <Notice tone="danger">{state.error}</Notice> : null}
      <Button type="submit" disabled={pending} aria-busy={pending}>
        {pending ? 'Creating…' : 'Create the program'}
      </Button>
    </form>
  );
}
