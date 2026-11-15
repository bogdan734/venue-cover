import { ArrowRight } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { LoginForm } from '@/components/login-form';
import { Lockup } from '@/components/mark';
import { Card, CardBody } from '@/components/ui/card';
import { isAdmin } from '@/lib/auth';
import { safeNext } from '@/lib/session';
import { login } from './actions';

export const metadata: Metadata = { title: 'Admin sign-in' };

export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const next = safeNext((await searchParams).next ?? '/');
  const signedIn = await isAdmin();
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-16">
      <Lockup />
      <h1 className="mt-8 text-[2rem] text-ink">Back office</h1>
      <p className="mt-2 text-ink-soft">
        Underwriting, client programs, reports, the developer console and the quality page. The
        password came with the link.
      </p>
      <Card className="mt-6">
        <CardBody>
          {signedIn ? (
            <p className="text-ink-soft">
              You are signed in.{' '}
              <Link href={next} className="font-medium text-brand hover:underline">
                Open the console
              </Link>
            </p>
          ) : (
            <LoginForm action={login} next={next} />
          )}
        </CardBody>
      </Card>
      <p className="mt-6 text-sm text-ink-soft">
        Just want to try buying cover as a renter? That needs no password.{' '}
        <Link
          href="/portals"
          className="inline-flex items-center gap-1 font-medium text-brand hover:underline"
        >
          Open the customer portals <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      </p>
    </main>
  );
}
