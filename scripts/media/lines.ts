// What the film says, scene by scene, a sentence at a time. voice.ts speaks each sentence; cut.ts places the scenes and
// shows each sentence as a subtitle while it is spoken.
export const LINES = {
  portal: ['Venue Cover sells event insurance through the venues people rent.'],
  typing: ['A renter describes the event in their own words.'],
  read: ['The platform shows exactly how it read them, and which activity it matched.'],
  price: ['The client’s own rules price it on the spot, and every line of the working is shown.'],
  covered: ['A test card pays, and the policy and certificates are ready.'],
  referred: [
    'Anything unusual is not priced blind.',
    'It goes to an underwriter, with the reasons.',
  ],
  worksheet: [
    'The underwriter decides from a worksheet: the basis for every line, and the closest past decisions.',
  ],
  approved: ['The renter’s page updates by itself.'],
  hub: ['Behind the portals is one platform.', 'A new client is a row of data, not a new site.'],
  program: [
    'Its look is checked for contrast, and it gets its own console, by a link that can be switched off.',
  ],
  chat: [
    'Questions are answered from the rules, on the portal or in Telegram, and a claim goes straight to a person.',
  ],
  developer: [
    'Partners integrate through REST or GraphQL, with signed webhooks from a transactional outbox, and an MCP server for agents.',
  ],
  personal: ['Personal details are sealed before any model sees them.'],
  injection: ['And text in a description is data, never an instruction.'],
  quality: [
    'Every decision is measured, with confidence intervals, and unsafe approvals held at zero.',
  ],
  outro: ['Venue Cover. The live demo and the code are linked below.'],
} as const satisfies Record<string, readonly string[]>;

export type Scene = keyof typeof LINES;
