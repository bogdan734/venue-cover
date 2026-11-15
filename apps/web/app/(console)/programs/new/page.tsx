import { randomUUID } from 'node:crypto';
import type { Metadata } from 'next';
import { PageHeader } from '@/components/page-header';
import { NewProgramForm } from '@/components/studio/new-program-form';
import { Card, CardBody } from '@/components/ui/card';
import { api } from '@/lib/api';
import { PROVINCES, type ProgramOptions } from '@/lib/types';
import { createProgram } from '../actions';

export const metadata: Metadata = { title: 'New program' };

export default async function NewProgram() {
  const options = await api<ProgramOptions>('operator', '/v1/program-options');
  return (
    <>
      <PageHeader title="Set up a client">
        Pick the closest template, name the client, and the portal is live. The client’s own
        requirements are added next, as rules, on the program’s page.
      </PageHeader>
      <Card className="max-w-2xl">
        <CardBody>
          <NewProgramForm
            action={createProgram}
            options={options}
            provinces={PROVINCES}
            idem={randomUUID()}
          />
        </CardBody>
      </Card>
    </>
  );
}
