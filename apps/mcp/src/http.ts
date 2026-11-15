import { buildMcpApp } from './app.js';

const apiUrl = process.env.VENUE_API_URL ?? 'http://127.0.0.1:3000';
const app = buildMcpApp({
  apiUrl,
  paymentToken: process.env.VENUE_PAYMENT_TOKEN ?? 'tok_demo',
  // A key that may read personal details words the confirmation the person sees; tool results never use it.
  ...(process.env.VENUE_PERSONAL_KEY ? { personalKey: process.env.VENUE_PERSONAL_KEY } : {}),
});
await app.listen({ port: Number(process.env.MCP_PORT ?? 3100), host: '127.0.0.1' });
console.error(
  `venue-cover MCP on http://127.0.0.1:${process.env.MCP_PORT ?? 3100}/mcp, API at ${apiUrl}`,
);
