import type { CSSProperties } from 'react';
import type { Theme } from './types';

// A program's colour in place of the platform's, for everything inside an element: links, buttons, focus rings. The API
// has already checked it reads at 4.5:1 against the page.
export function brandStyle(theme: Pick<Theme, 'brand'> | null): CSSProperties | undefined {
  if (!theme) return undefined;
  return {
    '--color-brand': theme.brand,
    '--color-brand-strong': `color-mix(in oklch, ${theme.brand} 78%, black)`,
    '--color-brand-soft': `color-mix(in oklch, ${theme.brand} 9%, white)`,
  } as CSSProperties;
}
