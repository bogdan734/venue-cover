// The mark: an arch (a venue's doorway) with a tick under it. On the dark rail it is drawn in reverse.
export function Mark({ onRail }: { onRail?: boolean }) {
  const line = onRail ? 'stroke-rail' : 'stroke-white';
  return (
    <svg viewBox="0 0 32 32" className="size-8 shrink-0" aria-hidden>
      <rect width="32" height="32" rx="8" className={onRail ? 'fill-white' : 'fill-brand'} />
      <path
        d="M8 23V15a8 8 0 0 1 16 0v8"
        className={`fill-none ${line}`}
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <path d="M6.5 23.5h19" className={line} strokeWidth="2.4" strokeLinecap="round" />
      <path
        d="m12.5 17.5 2.6 2.6 4.6-5"
        className={`fill-none ${onRail ? 'stroke-brand' : 'stroke-white/85'}`}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// The mark with the name beside it, for the pages outside the console.
export function Lockup() {
  return (
    <span className="inline-flex items-center gap-2.5">
      <Mark />
      <span className="font-serif text-[1.1rem] font-semibold text-ink">Venue Cover</span>
    </span>
  );
}
