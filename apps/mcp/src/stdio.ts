import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { ApiClient } from './api.js';
import { createOnboardingServer } from './onboarding.js';
import { createVenueServer } from './server.js';

// For a host that launches the server as a local process: the key comes from the environment.
const baseUrl = process.env.VENUE_API_URL ?? 'http://127.0.0.1:3000';
const api = new ApiClient({ baseUrl, apiKey: process.env.VENUE_API_KEY });
// VENUE_API_KEY is best made without personal:read, so the model reads people as tags; VENUE_PERSONAL_KEY, a key of the
// same program that may read them, only words the confirmation the person sees.
const personalKey = process.env.VENUE_PERSONAL_KEY;
// VENUE_MCP=onboarding serves the tools that set up a client instead; give it a key that manages programs only.
const onboarding = process.env.VENUE_MCP === 'onboarding';
void serveStdio(() =>
  onboarding
    ? createOnboardingServer(api)
    : createVenueServer(api, {
        paymentToken: process.env.VENUE_PAYMENT_TOKEN ?? 'tok_demo',
        ...(personalKey ? { personal: new ApiClient({ baseUrl, apiKey: personalKey }) } : {}),
      }),
);
console.error(`venue-cover ${onboarding ? 'onboarding ' : ''}MCP running on stdio`);
