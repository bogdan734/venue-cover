import { ButtonLink } from '@/components/ui/button';

export default function NotFound() {
  return (
    <main className="mx-auto max-w-xl px-6 py-24">
      <p className="text-sm font-medium text-brand">Not found</p>
      <h1 className="mt-2 text-[1.9rem] text-ink">There is nothing at this address</h1>
      <p className="mt-3 text-ink-soft">
        The link may point at a quote, a policy or a program that does not exist in this database.
      </p>
      <ButtonLink href="/" className="mt-5">
        Back to the tour
      </ButtonLink>
    </main>
  );
}
