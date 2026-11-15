// Contrast as WCAG 2.2 measures it, shared by the API, which refuses an unreadable theme, and the console, which shows
// the ratio while a colour is being picked.

/** The portal's page colour (the web app's `--color-paper`). It is darker than the white on buttons, so a brand
 * colour readable against it is readable under white text too. */
export const PORTAL_PAGE = '#f5f7fa';
/** AA for body text. */
export const MIN_CONTRAST = 4.5;

const channel = (hex: string, at: number) => {
  const c = Number.parseInt(hex.slice(at, at + 2), 16) / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex: string) =>
  0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);

/** The contrast ratio of two `#rrggbb` colours, from 1 to 21. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
