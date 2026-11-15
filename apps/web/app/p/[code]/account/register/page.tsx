import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { RegisterForm } from '@/components/portal/account-forms';
import { Card, CardBody } from '@/components/ui/card';
import { portalOf } from '@/lib/portal';
import { currentRenter } from '@/lib/renter';
import { portalNext } from '@/lib/session';
import { register } from '../actions';

export const metadata: Metadata = { title: 'Create an account' };

export default async function RegisterPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ next?: string }>;
}) {
  const { program, as } = await portalOf((await params).code);
  const next = portalNext(program.code, (await searchParams).next) ?? '';
  if (await currentRenter(as)) redirect(next || `/p/${program.code}/account`);
  const signIn = `/p/${program.code}/account/sign-in${next ? `?next=${encodeURIComponent(next)}` : ''}`;

  return (
    <section aria-labelledby="register" className="mx-auto max-w-md">
      <h1 id="register" className="text-[2.1rem] text-ink">
        Create an account
      </h1>
      <p className="mt-2 text-ink-soft">
        You need one to buy cover. It keeps your quotes, policies and certificates in one place, and
        we send a link to confirm your e-mail first.
      </p>
      <Card className="mt-6">
        <CardBody>
          <RegisterForm action={register.bind(null, program.code)} next={next} />
        </CardBody>
      </Card>
      <p className="mt-5 text-sm text-ink-soft">
        Already have one?{' '}
        <Link href={signIn} className="font-medium text-brand hover:underline">
          Sign in
        </Link>
      </p>
    </section>
  );
}
