import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ResendForm, SignInForm } from '@/components/portal/account-forms';
import { Card, CardBody } from '@/components/ui/card';
import { portalOf } from '@/lib/portal';
import { currentRenter } from '@/lib/renter';
import { portalNext } from '@/lib/session';
import { resend, signIn } from '../actions';

export const metadata: Metadata = { title: 'Sign in' };

export default async function SignInPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ next?: string }>;
}) {
  const { program, as } = await portalOf((await params).code);
  const next = portalNext(program.code, (await searchParams).next) ?? '';
  if (await currentRenter(as)) redirect(next || `/p/${program.code}/account`);
  const register = `/p/${program.code}/account/register${next ? `?next=${encodeURIComponent(next)}` : ''}`;

  return (
    <section aria-labelledby="sign-in" className="mx-auto max-w-md">
      <h1 id="sign-in" className="text-[2.1rem] text-ink">
        Sign in
      </h1>
      <p className="mt-2 text-ink-soft">To pay for cover and to see your policies.</p>
      <Card className="mt-6">
        <CardBody>
          <SignInForm action={signIn.bind(null, program.code)} next={next} />
        </CardBody>
      </Card>
      <p className="mt-5 text-sm text-ink-soft">
        New here?{' '}
        <Link href={register} className="font-medium text-brand hover:underline">
          Create an account
        </Link>
      </p>
      <details className="group mt-6 rounded-card border border-line bg-surface px-5 py-3.5">
        <summary className="cursor-pointer text-sm font-medium text-ink">
          The confirmation link expired or never came?
        </summary>
        <div className="mt-3">
          <ResendForm action={resend.bind(null, program.code)} />
        </div>
      </details>
    </section>
  );
}
