'use client';

// Shown when a page could not be rendered, which here nearly always means the API did not answer.
export default function PageError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto max-w-xl px-6 py-24">
      <p className="text-sm font-medium text-danger">Something went wrong</p>
      <h1 className="mt-2 text-[1.9rem] text-ink">This page could not be shown</h1>
      <p className="mt-3 text-ink-soft">
        The web app gets everything from the platform API. If the API is not running, or the web app
        was started without its address and key, every page ends up here.
      </p>
      <p className="mt-3 rounded-control border border-line bg-surface px-3.5 py-2.5 font-mono text-sm text-ink-soft">
        {error.message}
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-5 inline-flex h-10 items-center rounded-control bg-brand px-4 font-medium text-white transition-colors duration-150 hover:bg-brand-strong"
      >
        Try again
      </button>
    </main>
  );
}
