// How numbers and dates are written everywhere in the app (Canadian English, Canadian dollars).

const cad = new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' });
const whole = new Intl.NumberFormat('en-CA');

export const money = (cents: number): string => cad.format(cents / 100);

// A liability limit the way a certificate states it: $2,000,000.
export const limit = (cents: number): string => `$${whole.format(Math.round(cents / 100))}`;

// And the way people say it: $2M.
export function limitShort(cents: number): string {
  const millions = cents / 100 / 1_000_000;
  return Number.isInteger(millions) ? `$${millions}M` : limit(cents);
}

export const count = (value: number): string => whole.format(value);

export function percent(share: number | null, digits = 1): string {
  return share === null ? 'n/a' : `${(share * 100).toFixed(digits)}%`;
}

// Basis points as a percentage: 1500 is 15%.
export const bps = (value: number): string => `${value / 100}%`;

const dayFormat = new Intl.DateTimeFormat('en-CA', { dateStyle: 'medium', timeZone: 'UTC' });
const stampFormat = new Intl.DateTimeFormat('en-CA', {
  dateStyle: 'medium',
  timeStyle: 'short',
  hour12: false,
  timeZone: 'UTC',
});

// A calendar day (YYYY-MM-DD, or the date part of a timestamp), with no time zone arithmetic.
export function day(value: string): string {
  return dayFormat.format(new Date(`${value.slice(0, 10)}T00:00:00Z`));
}

// A moment, in UTC and saying so: the people who read this page are not all in one place.
export const stamp = (iso: string): string => `${stampFormat.format(new Date(iso))} UTC`;

// How long ago, or how far ahead, in the largest unit that fits.
export function relative(iso: string, now: Date): string {
  const seconds = Math.round((new Date(iso).getTime() - now.getTime()) / 1000);
  const [value, unit] =
    Math.abs(seconds) < 60
      ? [seconds, 'second']
      : Math.abs(seconds) < 3600
        ? [Math.round(seconds / 60), 'minute']
        : Math.abs(seconds) < 86_400
          ? [Math.round(seconds / 3600), 'hour']
          : [Math.round(seconds / 86_400), 'day'];
  return new Intl.RelativeTimeFormat('en-CA', { numeric: 'auto' }).format(
    value as number,
    unit as Intl.RelativeTimeFormatUnit,
  );
}
