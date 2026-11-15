import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Script from 'next/script';
import { CopyField } from '@/components/hub/copy-field';
import { api } from '@/lib/api';
import { isOpen } from '@/lib/portal';
import type { Program } from '@/lib/types';

export const metadata: Metadata = { title: 'Sample venue website', robots: { index: false } };

const ROOMS = [
  { name: 'Main hall', fits: 'Up to 250 standing, 160 seated', use: 'Receptions, dances, markets' },
  { name: 'Community room', fits: 'Up to 60 seated', use: 'Meetings, classes, birthday parties' },
  {
    name: 'Outdoor pavilion',
    fits: 'Up to 300, May to October',
    use: 'Picnics, reunions, festivals',
  },
];

// What a venue's own booking page looks like with the button on it. The page is invented and dressed unlike the platform
// on purpose; the one line of script is the real thing, the same a venue would paste.
export default async function SampleVenueSite({ params }: { params: Promise<{ code: string }> }) {
  const code = (await params).code.toUpperCase();
  const { programs } = await api<{ programs: Program[] }>('operator', '/v1/programs');
  const program = programs.find((p) => p.code === code && isOpen(p));
  if (!program) notFound();

  return (
    <div className="min-h-dvh bg-[#f3efe6] text-[#2b2620]">
      <p className="bg-[#2b2620] px-4 py-2 text-center text-[0.8rem] text-white/85">
        A sample venue website, invented to show the button. Only the button comes from the
        platform: one line of script.
      </p>
      <header className="mx-auto max-w-4xl px-6 pt-10 pb-6">
        <p className="text-sm tracking-wide text-[#7a6a55]">{program.name}</p>
        <h1 className="mt-1 font-[Georgia,serif] text-[2.4rem] leading-tight">
          Book a space for your event
        </h1>
        <p className="mt-3 max-w-2xl text-[1.05rem] text-[#4a4238]">
          Halls and rooms for community events, rented by the day or the evening. Most bookings need
          event liability insurance before the keys are handed over.
        </p>
      </header>
      <main className="mx-auto grid max-w-4xl gap-4 px-6 pb-10 sm:grid-cols-3">
        {ROOMS.map((room) => (
          <article key={room.name} className="rounded-md border border-[#d9cfbd] bg-white/70 p-4">
            <h2 className="font-[Georgia,serif] text-[1.2rem]">{room.name}</h2>
            <p className="mt-1 text-sm text-[#4a4238]">{room.fits}</p>
            <p className="text-sm text-[#7a6a55]">{room.use}</p>
          </article>
        ))}
      </main>
      <section className="mx-auto max-w-4xl px-6 pb-16" aria-labelledby="insure">
        <div className="rounded-md border border-[#d9cfbd] bg-white p-6">
          <h2 id="insure" className="font-[Georgia,serif] text-[1.35rem]">
            Insurance for your booking
          </h2>
          <p className="mt-1 mb-4 max-w-2xl text-[0.95rem] text-[#4a4238]">
            Describe your event in your own words and get a price, the policy and the certificate we
            need, in a few minutes.
          </p>
          <div id="cover-button" />
        </div>
        <div className="mt-4">
          <p className="mb-1.5 text-sm text-[#4a4238]">The line the venue pasted:</p>
          <CopyField
            label="Embed snippet"
            path={`/embed/${program.code}.js`}
            around={['<script src="', '" async></script>']}
          />
        </div>
      </section>
      <Script
        src={`/embed/${program.code}.js`}
        strategy="afterInteractive"
        data-target="cover-button"
      />
    </div>
  );
}
