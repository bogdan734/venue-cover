import type { BotProfile } from './telegram.js';

// What the Telegram bot says about itself and how it explains itself: one place, so the profile, /help and the replies agree.

export const BOT_PROFILE: BotProfile = {
  description:
    'Venue Cover is a demo of an event-insurance platform. Ask about renting a space and covering your event: what is covered, how to get a price, where your policy stands. Pick a venue, then write in your own words. For a claim, a refund or anything I cannot answer, a person takes over. Everything here is invented: no real policies, no real payments.',
  shortDescription:
    'Demo assistant for event insurance: what is covered, prices, policies, claims. All data is invented.',
  commands: [
    { command: 'start', description: 'Choose a venue' },
    { command: 'help', description: 'What I can do' },
    { command: 'person', description: 'Talk to a person' },
  ],
};

/** The first thing a chat without a venue is told. */
export const WELCOME =
  'Hello, this is the Venue Cover demo assistant. I answer from a venue’s own rules: what is covered, how to get a price, where your policy stands. Which venue is this about?';

/** Asked when a message needs a venue and none is chosen. */
export const WHICH_VENUE =
  'Which venue is this about? I answer from the rules of one venue at a time.';

export function helpText(venue?: string): string {
  return [
    venue
      ? `You are talking to the ${venue} assistant.`
      : 'I answer from a venue’s own rules, so first choose a venue.',
    '',
    '• Ask what is covered, how to get a price, or how to reach the venue. You need no number for that.',
    '• Send a policy number (like FHV-000123) with the e-mail on it to see where the policy stands.',
    '• Describe a claim or ask for a refund and a person takes over, with your policy added if you sent its number.',
    '',
    '/start chooses another venue, /person asks for a person, /help shows this again.',
    'Everything here is invented: no real policies, no real payments.',
  ].join('\n');
}
