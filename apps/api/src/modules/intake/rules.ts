import type { AlcoholMode, EventFacts, EventFlag } from '../../domain/types.js';

// Deterministic reading of a description. It cross-checks the model and is the fallback when the model fails.
const PEOPLE =
  '(?:guests?|people|persons?|attendees?|participants?|kids|children|adults|players|runners|visitors|members)';
const COUNT_BEFORE = new RegExp(`\\b(\\d{1,6})\\s*(?:\\+\\s*)?${PEOPLE}\\b`, 'i');
const COUNT_AFTER = /\b(?:attendance|turnout|capacity|crowd)\s*(?:of|is|:)?\s*(\d{1,6})\b/i;
const HOURS = /\b(\d{1,3}(?:\.\d+)?)\s*(?:hours?|hrs?|h)\b/i;
const TIME_RANGE =
  /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*(?:to|-|until|till)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i;

const FLAG_WORDS: Record<EventFlag, RegExp> = {
  fireworks: /firework|pyrotechnic|firecracker/i,
  overnight: /overnight|camping|\bcamp out\b|sleepover|sleeping bag/i,
  animals: /\bpony|\bponies|petting zoo|\banimals?\b|\bhorses?\b|\bcamel|\bzoo\b/i,
  inflatables: /bouncy|bounce house|inflatable|jumping castle/i,
  minors: /\bkids?\b|children|\bminors?\b|\bteens?\b|\byouth\b|under 18|toddlers?/i,
  weapons: /\bguns?\b|firearm|archery|axe throw|\bknives?\b|shooting range/i,
  motorized: /motorcycle|motocross|go-?kart|\batv\b|dirt bike|drag rac|\bcar show\b|monster truck/i,
};

function toMinutes(hour: string, minute: string | undefined, meridiem: string): number {
  const h = Number(hour) % 12;
  return (h + (meridiem.toLowerCase() === 'pm' ? 12 : 0)) * 60 + Number(minute ?? 0);
}

function readHours(text: string): number | null {
  const range = TIME_RANGE.exec(text);
  if (range) {
    const [, h1, m1, a1, h2, m2, a2] = range as unknown as [
      string,
      string,
      string | undefined,
      string,
      string,
      string | undefined,
      string,
    ];
    let minutes = toMinutes(h2, m2, a2) - toMinutes(h1, m1, a1);
    if (minutes <= 0) minutes += 24 * 60;
    return minutes / 60;
  }
  const hours = HOURS.exec(text);
  return hours ? Number(hours[1]) : null;
}

function readAlcohol(text: string): AlcoholMode | null {
  if (/\b(?:no|without)\s+(?:alcohol|booze|liquor)\b|\bdry event\b|\balcohol[- ]free\b/i.test(text))
    return 'none';
  if (
    /\bcash bar\b|\bsell(?:ing)?\s+(?:beer|wine|alcohol|liquor|cocktails?|drinks)\b|\bbeer garden\b/i.test(
      text,
    )
  )
    return 'sold';
  if (
    /\b(?:beer|wine|alcohol|liquor|cocktails?|champagne|prosecco|\bbar\b|bartender)\b/i.test(text)
  )
    return 'served';
  return null;
}

export function extractWithRules(text: string): EventFacts {
  const count = COUNT_BEFORE.exec(text) ?? COUNT_AFTER.exec(text);
  return {
    activities: [],
    participants: count ? Number(count[1]) : null,
    hours: readHours(text),
    alcohol: readAlcohol(text),
    flags: (Object.keys(FLAG_WORDS) as EventFlag[]).filter((flag) => FLAG_WORDS[flag].test(text)),
  };
}
