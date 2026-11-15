import { randomUUID } from 'node:crypto';
import { ArrowLeft, ArrowUpRight } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AppearanceEditor } from '@/components/hub/appearance-editor';
import { AuditLog } from '@/components/hub/audit-log';
import { ClientLinkForm } from '@/components/hub/client-link-form';
import { ContactsForm } from '@/components/hub/contacts-form';
import { CopyField } from '@/components/hub/copy-field';
import { Launch } from '@/components/hub/launch';
import { PageHeader } from '@/components/page-header';
import { RulesWorkshop } from '@/components/studio/rules-workshop';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, Label } from '@/components/ui/card';
import { ApiError, api } from '@/lib/api';
import { bps, day, money, relative } from '@/lib/format';
import type { AccessLink, AuditEntry, ProgramDetail } from '@/lib/types';
import { rulesInWords, STATUS } from '@/lib/words';
import { LETTER_EXAMPLES } from '../../../../../../data/examples';
import {
  createClientLink,
  draft,
  moveProgram,
  preview,
  publish,
  revokeClientLink,
  saveAppearance,
  saveContacts,
} from '../actions';

const PLATFORM_THEME = { brand: '#20408f', logo: null, tagline: null, welcome: null };

export const metadata: Metadata = { title: 'Program' };

export default async function ProgramPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let program: ProgramDetail;
  try {
    program = await api<ProgramDetail>('operator', `/v1/programs/${id}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
  const ids = program.rules.excludedActivityIds;
  const [{ titles }, { entries }] = await Promise.all([
    ids.length
      ? api<{ titles: Record<string, string> }>(
          'operator',
          `/v1/activity-titles?ids=${ids.join(',')}`,
        )
      : { titles: {} as Record<string, string> },
    api<{ entries: AuditEntry[] }>('operator', `/v1/programs/${id}/audit`),
  ]);
  const { links } = await api<{ links: AccessLink[] }>('operator', `/v1/programs/${id}/access`);
  const now = new Date();
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <Link
        href="/programs"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-ink-soft hover:text-ink"
      >
        <ArrowLeft className="size-3.5" aria-hidden /> All programs
      </Link>
      <PageHeader
        title={program.name}
        actions={
          <>
            <Badge tone={STATUS[program.status].tone}>{STATUS[program.status].word}</Badge>
            <Link
              href={`/p/${program.code}`}
              className="inline-flex items-center gap-1 text-sm font-medium text-brand hover:text-brand-strong"
            >
              Open the portal <ArrowUpRight className="size-3.5" aria-hidden />
            </Link>
          </>
        }
      >
        {program.province} · loading {bps(program.terms.loadingBps)}, commission{' '}
        {bps(program.terms.commissionBps)}, fee {money(program.terms.feeCents)}
      </PageHeader>

      <Launch program={program} move={moveProgram.bind(null, program.id)} />

      <Card aria-label="Appearance" className="mb-6">
        <CardHeader
          title="Appearance"
          note="How the portal looks. A colour that cannot be read is refused, here and by the API."
        />
        <CardBody>
          <AppearanceEditor
            name={program.name}
            initial={program.theme ?? PLATFORM_THEME}
            save={saveAppearance.bind(null, program.id)}
          />
        </CardBody>
      </Card>

      <Card aria-label="Contacts" className="mb-6">
        <CardHeader title="Contacts" note="The program’s own support desk, shown to its renters." />
        <CardBody>
          <ContactsForm action={saveContacts.bind(null, program.id)} initial={program.contacts} />
        </CardBody>
      </Card>

      <div className="mb-6 grid gap-6 xl:grid-cols-2">
        <Card aria-label="Client console">
          <CardHeader
            title="Client console"
            note="A link that shows the client their own figures, policies and conversations. Turn it off at any time."
          />
          <CardBody className="space-y-4">
            <ClientLinkForm
              code={program.code}
              action={createClientLink.bind(null, program.id)}
              idem={randomUUID()}
            />
            {links.length > 0 ? (
              <ul className="divide-y divide-line border-t border-line">
                {links.map((link) => (
                  <li key={link.id} className="flex items-center justify-between gap-3 py-2.5">
                    <span className="min-w-0">
                      <span className="block truncate text-[0.92rem] text-ink">{link.label}</span>
                      <span className="block text-[0.78rem] text-ink-faint">
                        made {relative(link.createdAt, now)}
                        {link.lastUsedAt
                          ? `, last opened ${relative(link.lastUsedAt, now)}`
                          : ', not opened yet'}
                      </span>
                    </span>
                    {link.revokedAt ? (
                      <Badge>Turned off</Badge>
                    ) : (
                      <form action={revokeClientLink.bind(null, program.id, link.id)}>
                        <Button type="submit" variant="danger" size="sm">
                          Turn off
                        </Button>
                      </form>
                    )}
                  </li>
                ))}
              </ul>
            ) : null}
          </CardBody>
        </Card>

        <Card aria-label="Button for the venue’s website">
          <CardHeader
            title="Button for the venue’s website"
            note="One line on the client’s own booking page adds an “Insure your event” button that opens this portal."
          />
          <CardBody className="space-y-3">
            <CopyField
              label="Embed snippet"
              path={`/embed/${program.code}.js`}
              around={['<script src="', '" async></script>']}
            />
            <Link
              href={`/embed/demo/${program.code}`}
              className="inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline"
            >
              See it on a sample venue website <ArrowUpRight className="size-3.5" aria-hidden />
            </Link>
            {program.status === 'draft' || program.status === 'test' ? (
              <p className="text-sm text-ink-faint">
                The button appears once the portal is open to the public.
              </p>
            ) : null}
          </CardBody>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <RulesWorkshop
          rules={program.rules}
          titles={titles}
          examples={LETTER_EXAMPLES}
          today={today}
          idem={randomUUID()}
          draft={draft.bind(null, program.id)}
          preview={preview.bind(null, program.id)}
          publish={publish.bind(null, program.id)}
        />
        <aside className="space-y-6">
          <Card aria-label="Rules in force">
            <CardHeader title="In force today" />
            <CardBody>
              <ul className="space-y-1.5 text-[0.92rem] text-ink-soft">
                {rulesInWords(program.rules).map((line) => (
                  <li key={line}>{line}</li>
                ))}
                {ids.length > 0 ? (
                  <li>Never unseen: {ids.map((i) => titles[i] ?? i).join(', ')}</li>
                ) : null}
                <li>{program.rules.questions.length} program questions</li>
              </ul>
            </CardBody>
          </Card>
          <Card aria-label="Rule versions">
            <CardHeader title="Versions" note="Each is in force from its date." />
            <CardBody>
              <ol className="space-y-2 text-[0.92rem]">
                {[...program.versions].reverse().map((version) => (
                  <li key={version.version} className="flex items-center justify-between gap-3">
                    <span className="font-medium text-ink">v{version.version}</span>
                    <span className="text-ink-soft">from {day(version.effectiveFrom)}</span>
                    {version.effectiveFrom > today ? <Badge tone="info">scheduled</Badge> : null}
                  </li>
                ))}
              </ol>
              <p className="mt-3 text-[0.8rem] text-ink-faint">
                <Label>Why versions</Label>
                <span className="mt-1 block">
                  A quote keeps the rules it was made under, so an old decision can always be
                  explained.
                </span>
              </p>
            </CardBody>
          </Card>
          <AuditLog entries={entries} />
        </aside>
      </div>
    </>
  );
}
