import { z } from 'zod';
import { contrast, MIN_CONTRAST, PORTAL_PAGE } from '../../domain/contrast.js';
import type { Contacts, Theme } from '../../domain/types.js';

const LOGO = /^data:image\/(png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/]+={0,2}$/;
const LOGO_MAX = 150_000; // characters of the data URL, about 110 kB of image

/** What would make the portal hard to read or unsafe to show; empty when the theme can be kept. */
export function problemsOf(theme: Theme): string[] {
  const problems: string[] = [];
  const ratio = contrast(theme.brand, PORTAL_PAGE);
  if (ratio < MIN_CONTRAST) {
    problems.push(
      `the brand colour ${theme.brand} has a contrast of ${ratio.toFixed(1)}:1 against the page; links and buttons need ${MIN_CONTRAST}:1`,
    );
  }
  if (theme.logo !== null && (!LOGO.test(theme.logo) || theme.logo.length > LOGO_MAX)) {
    problems.push(
      'the logo must be a PNG, JPEG, WebP or SVG image held in the page as a data URL, under about 110 kB',
    );
  }
  return problems;
}

const text = (max: number) => z.string().trim().min(1).max(max).nullable();

export const ThemeBody = z.object({
  brand: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'a colour is written #rrggbb')
    .transform((s) => s.toLowerCase()),
  logo: z.string().max(LOGO_MAX).nullable(),
  tagline: text(120),
  welcome: text(400),
}) satisfies z.ZodType<Theme>;

export const ContactsBody = z.object({
  supportEmail: z.email().max(200).nullable(),
  supportPhone: z
    .string()
    .regex(/^\+?[0-9 ()-]{7,20}$/, 'a phone number is digits, spaces, brackets and dashes')
    .nullable(),
  telegram: z
    .string()
    .regex(/^@[A-Za-z0-9_]{5,32}$/, 'a Telegram name starts with @')
    .nullable(),
  hours: text(80),
}) satisfies z.ZodType<Contacts>;
