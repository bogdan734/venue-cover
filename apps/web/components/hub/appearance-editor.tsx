'use client';

import { ImageUp, X } from 'lucide-react';
import Image from 'next/image';
import { type ChangeEvent, useState, useTransition } from 'react';
import { Button, buttonClass } from '@/components/ui/button';
import { Notice } from '@/components/ui/card';
import { Field, Input, Textarea } from '@/components/ui/field';
import type { FormState } from '@/components/use-server-form';
import { brandStyle } from '@/lib/brand';
import { cx } from '@/lib/cx';
import type { Theme } from '@/lib/types';
import { contrast, MIN_CONTRAST, PORTAL_PAGE } from '../../../api/src/domain/contrast';

// Colours that read well on the portal's page, to start from. Any other passes the same check.
const PRESETS = ['#20408f', '#0f5c4a', '#6b2d86', '#a3231a', '#0b6b80', '#1f2937'];
const LOGO_MAX = 150_000; // the API's limit on the data URL, in characters
const HEX = /^#[0-9a-f]{6}$/;

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

// The client's look as data: a colour that must stay readable, a logo, two lines of wording. The preview is the portal's
// own header and first screen in miniature, coloured the way the portal will be.
export function AppearanceEditor({
  name,
  initial,
  save,
}: {
  name: string;
  initial: Theme;
  save: (theme: Theme) => Promise<FormState>;
}) {
  const [theme, setTheme] = useState(initial);
  const [hex, setHex] = useState(initial.brand);
  const [state, setState] = useState<FormState>({});
  const [logoError, setLogoError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const set = (patch: Partial<Theme>) => setTheme((t) => ({ ...t, ...patch }));
  const ratio = contrast(theme.brand, PORTAL_PAGE);
  const readable = ratio >= MIN_CONTRAST;

  function onHex(value: string) {
    setHex(value);
    const normal = value.trim().toLowerCase();
    if (HEX.test(normal)) set({ brand: normal });
  }

  async function onLogo(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const url = await readFile(file);
    if (url.length > LOGO_MAX) {
      setLogoError('That image is too large: keep a logo under about 110 kB.');
      return;
    }
    setLogoError(undefined);
    set({ logo: url });
  }

  function onSave() {
    startTransition(async () => setState(await save(theme)));
  }

  const preview = brandStyle(theme);

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div className="space-y-5">
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium text-ink-soft">Brand colour</legend>
          <div className="flex flex-wrap items-center gap-2">
            {PRESETS.map((colour) => (
              <button
                key={colour}
                type="button"
                onClick={() => onHex(colour)}
                aria-label={`Use ${colour}`}
                aria-pressed={theme.brand === colour}
                className={cx(
                  'size-8 rounded-full border-2 transition-transform duration-150 hover:scale-105',
                  theme.brand === colour ? 'border-ink' : 'border-surface ring-1 ring-line-strong',
                )}
                style={{ background: colour }}
              />
            ))}
            <label className="ml-1 flex items-center gap-2">
              <span className="sr-only">Pick any colour</span>
              <input
                type="color"
                value={theme.brand}
                onChange={(event) => onHex(event.target.value)}
                className="size-8 cursor-pointer rounded-control border border-line-strong bg-surface p-0.5"
              />
            </label>
            <label htmlFor="brand-hex" className="sr-only">
              Colour as #rrggbb
            </label>
            <Input
              id="brand-hex"
              value={hex}
              onChange={(event) => onHex(event.target.value)}
              className="h-8 w-28 font-mono text-sm"
              spellCheck={false}
            />
          </div>
          <p
            className={cx('mt-2 text-sm', readable ? 'text-ok' : 'text-danger')}
            aria-live="polite"
          >
            {ratio.toFixed(1)}:1 against the page.{' '}
            {readable
              ? 'Links and white text on buttons read well.'
              : `Too light: links and buttons need ${MIN_CONTRAST}:1, so this cannot be saved.`}
          </p>
        </fieldset>

        <div>
          <span className="mb-1.5 block text-sm font-medium text-ink-soft">Logo</span>
          <div className="flex flex-wrap items-center gap-2">
            <label className={buttonClass('secondary', 'sm', 'cursor-pointer')}>
              <ImageUp className="size-4" aria-hidden /> {theme.logo ? 'Replace' : 'Upload'} an
              image
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                onChange={onLogo}
                className="sr-only"
              />
            </label>
            {theme.logo ? (
              <Button type="button" variant="quiet" size="sm" onClick={() => set({ logo: null })}>
                <X className="size-4" aria-hidden /> Remove
              </Button>
            ) : null}
          </div>
          <p className="mt-1 text-[0.8rem] text-ink-faint">
            PNG, JPEG, WebP or SVG, under about 110 kB. Kept in the page itself, never fetched from
            elsewhere.
          </p>
          {logoError ? <p className="mt-1 text-sm text-danger">{logoError}</p> : null}
        </div>

        <Field label="Tagline" htmlFor="tagline" hint="Under the name on every page.">
          <Input
            id="tagline"
            value={theme.tagline ?? ''}
            maxLength={120}
            placeholder="Event insurance for people renting our spaces"
            onChange={(event) => set({ tagline: event.target.value || null })}
          />
        </Field>
        <Field label="Welcome" htmlFor="welcome" hint="One or two sentences on the first page.">
          <Textarea
            id="welcome"
            rows={2}
            value={theme.welcome ?? ''}
            maxLength={400}
            onChange={(event) => set({ welcome: event.target.value || null })}
          />
        </Field>

        {state.error ? <Notice tone="danger">{state.error}</Notice> : null}
        {state.done ? <Notice tone="ok">{state.done}</Notice> : null}
        <Button type="button" onClick={onSave} disabled={pending || !readable} aria-busy={pending}>
          {pending ? 'Saving…' : 'Save the appearance'}
        </Button>
      </div>

      <figure
        aria-label="Preview of the portal"
        style={preview}
        className="overflow-hidden rounded-card border border-line bg-paper"
      >
        <div className="border-t-4 border-b border-t-brand border-b-line bg-surface px-4 py-3.5">
          <div className="flex items-center gap-3">
            {theme.logo ? (
              <Image
                src={theme.logo}
                alt=""
                width={36}
                height={36}
                className="size-9 rounded-control object-contain"
              />
            ) : null}
            <div className="min-w-0">
              <p className="truncate font-serif text-[1.1rem] leading-tight font-semibold text-ink">
                {name}
              </p>
              <p className="truncate text-[0.78rem] text-ink-faint">
                {theme.tagline ?? 'Event insurance for people renting our spaces'}
              </p>
            </div>
          </div>
        </div>
        <div className="space-y-2.5 px-4 py-5">
          <p className="font-serif text-[1.35rem] leading-tight text-ink">
            Tell us about your event
          </p>
          {theme.welcome ? <p className="text-[0.9rem] text-ink">{theme.welcome}</p> : null}
          <div className="h-16 rounded-control border border-line-strong bg-surface px-3 py-2 text-[0.85rem] text-ink-faint">
            A birthday party for 40 in the hall, Saturday evening…
          </div>
          <div className="flex items-center gap-3">
            <span className={buttonClass('primary', 'sm')}>Read my description</span>
            <span className="text-sm text-brand underline">Try an example</span>
          </div>
        </div>
        <figcaption className="border-t border-line px-4 py-2 text-[0.78rem] text-ink-faint">
          Preview. The portal changes when you save.
        </figcaption>
      </figure>
    </div>
  );
}
