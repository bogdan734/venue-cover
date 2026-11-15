// Joins class names, skipping the ones a condition switched off.
export const cx = (...parts: (string | false | null | undefined)[]): string =>
  parts.filter(Boolean).join(' ');
