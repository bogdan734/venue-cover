import { ATTACHMENT_LABELS, type Completeness } from './completeness.js';

// A draft for a person to read and send: it asks for what is missing, in plain words, and says nothing about how the
// application will be assessed. The system never sends it.
export function draftReply(check: Completeness, organizerName: string | null): string {
  const greeting = `Dear ${organizerName ?? 'applicant'},`;
  if (check.ready) {
    return `${greeting}\n\nThank you for your application. We have everything we need and will come back to you with a quote.`;
  }
  const lines = [
    greeting,
    '',
    'Thank you for your application. To give you a quote we still need the following:',
    '',
    ...check.missing.map((m) => `- ${m.label}`),
    ...check.requiredAttachments.map((kind) => `- ${ATTACHMENT_LABELS[kind]} (attachment)`),
    '',
    'Please reply with these details, or send a corrected form. We will not be able to quote until the application is complete.',
  ];
  return lines.join('\n');
}
