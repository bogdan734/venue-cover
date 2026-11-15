import type { Metadata } from 'next';
import Link from 'next/link';
import { ConfirmEmailForm } from '@/components/portal/account-forms';
import { Card, CardBody } from '@/components/ui/card';
import { portalOf } from '@/lib/portal';
import { confirmEmail } from '../account/actions';

export const metadata: Metadata = { title: 'Confirm your e-mail' };

// Where the link in the confirmation mail leads. Opening it changes nothing; the button does.
export default async function VerifyPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const { program } = await portalOf((await params).code);
  const { token } = await searchParams;

  return (
    <section aria-labelledby="verify" className="mx-auto max-w-md">
      <h1 id="verify" className="text-[2.1rem] text-ink">
        Confirm your e-mail
      </h1>
      <p className="mt-2 text-ink-soft">
        One click and your account is ready. You are signed in on this browser right after.
      </p>
      <Card className="mt-6">
        <CardBody>
          {token ? (
            <ConfirmEmailForm action={confirmEmail.bind(null, program.code)} token={token} />
          ) : (
            <p className="text-ink-soft">
              This link is missing its code. Open it from the e-mail again.
            </p>
          )}
        </CardBody>
      </Card>
      <p className="mt-5 text-sm text-ink-soft">
        Link expired?{' '}
        <Link
          href={`/p/${program.code}/account/sign-in`}
          className="font-medium text-brand hover:underline"
        >
          Ask for a new one
        </Link>
      </p>
    </section>
  );
}
