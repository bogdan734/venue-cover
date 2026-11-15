import { Clock, Mail, MessageCircle, Phone } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Contacts } from '@/lib/types';

function Item({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-center gap-2 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-ink-faint">
      {icon}
      {children}
    </li>
  );
}

const link = 'text-brand hover:text-brand-strong hover:underline';

// Who a renter can reach about their cover: the program's own people, as the program set them.
export function PortalContacts({
  contacts,
  bot,
  code,
}: {
  contacts: Contacts;
  /** The platform's Telegram bot, which opens on this portal when the program has no Telegram of its own. */
  bot: string | null;
  code: string;
}) {
  const { supportEmail, supportPhone, telegram, hours } = contacts;
  if (!supportEmail && !supportPhone && !telegram && !bot) return null;
  return (
    <section aria-label="Contact us" className="mb-5 border-b border-line pb-5">
      <h2 className="text-[1rem] font-semibold text-ink">Questions about your cover?</h2>
      <ul className="mt-2 flex flex-wrap gap-x-6 gap-y-2 text-[0.92rem] text-ink-soft">
        {supportEmail ? (
          <Item icon={<Mail aria-hidden />}>
            <a href={`mailto:${supportEmail}`} className={link}>
              {supportEmail}
            </a>
          </Item>
        ) : null}
        {supportPhone ? (
          <Item icon={<Phone aria-hidden />}>
            <a href={`tel:${supportPhone.replace(/[^+0-9]/g, '')}`} className={link}>
              {supportPhone}
            </a>
          </Item>
        ) : null}
        {telegram ? (
          <Item icon={<MessageCircle aria-hidden />}>
            <a
              href={`https://t.me/${telegram.slice(1)}`}
              className={link}
              rel="noopener noreferrer"
              target="_blank"
            >
              {telegram} on Telegram
            </a>
          </Item>
        ) : bot ? (
          <Item icon={<MessageCircle aria-hidden />}>
            <a
              href={`https://t.me/${bot}?start=${code}`}
              className={link}
              rel="noopener noreferrer"
              target="_blank"
            >
              Write to us in Telegram
            </a>
          </Item>
        ) : null}
        {hours ? <Item icon={<Clock aria-hidden />}>{hours}</Item> : null}
      </ul>
    </section>
  );
}
