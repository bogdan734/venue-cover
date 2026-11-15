// A description as the model saw it. Each personal detail is a tag ("[NAME#7K3Q2A]"), drawn as a dark chip that says
// what kind of detail it hides and nothing more.

const TAG = /\[([A-Z]+)#([A-Z2-7]{6})\]/g;

export const KIND: Record<string, string> = {
  NAME: 'name',
  EMAIL: 'e-mail',
  PHONE: 'phone',
  CARD: 'card number',
  SIN: 'SIN',
  ID: 'number',
  POSTAL: 'postal code',
  ADDRESS: 'address',
  DOB: 'date of birth',
};

/** The kinds of detail hidden in a text, each once, in the order they first appear. */
export function hiddenKinds(text: string): string[] {
  return [...new Set([...text.matchAll(TAG)].map((m) => KIND[m[1] as string] ?? 'detail'))];
}

export const hiddenCount = (text: string): number => [...text.matchAll(TAG)].length;

// Punctuation right after a tag ("Emma, " or "Liam's") stays on the tag's line.
const TRAILING = /^(?:['’]s)?[,.;:!?)]*/;

export function ModelView({ text }: { text: string }) {
  const parts: { at: number; text: string; tag?: { kind: string; id: string; tail: string } }[] =
    [];
  let at = 0;
  for (const m of text.matchAll(TAG)) {
    const start = m.index ?? 0;
    if (start > at) parts.push({ at, text: text.slice(at, start) });
    const end = start + m[0].length;
    const tail = TRAILING.exec(text.slice(end))?.[0] ?? '';
    parts.push({
      at: start,
      text: m[0],
      tag: { kind: KIND[m[1] as string] ?? 'detail', id: m[2] as string, tail },
    });
    at = end + tail.length;
  }
  if (at < text.length) parts.push({ at, text: text.slice(at) });
  return (
    <p className="font-mono text-[0.86rem] leading-7 text-ink-soft">
      {parts.map((part) =>
        part.tag ? (
          <span key={part.at} className="whitespace-nowrap">
            <span
              title={`A ${part.tag.kind}: the model saw this tag, not the value`}
              className="pop inline-block rounded-md bg-ink px-1.5 align-baseline text-[0.78rem] leading-[1.45rem] text-white"
            >
              {part.tag.kind} <span className="text-white/60">#{part.tag.id}</span>
            </span>
            {part.tag.tail}
          </span>
        ) : (
          <span key={part.at}>{part.text}</span>
        ),
      )}
    </p>
  );
}
