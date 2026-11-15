import { createMcpFastifyApp } from '@modelcontextprotocol/fastify';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { ApiClient } from './api.js';
import { createOnboardingServer } from './onboarding.js';
import { createVenueServer } from './server.js';

export interface McpAppOptions {
  /** Where the REST API is. */
  apiUrl: string;
  paymentToken: string;
  /** A key of the same program that may read personal details, used only to word the confirmation the person sees
   *  (see server.ts). */
  personalKey?: string;
}

// An MCP endpoint at /mcp. It verifies nothing itself: the caller's bearer token is forwarded to the REST API, which is
// the one place that knows what a key may do. A caller with no token or a wrong one gets the API's refusal from every tool.
export function buildMcpApp(options: McpAppOptions) {
  const handler = createMcpHandler(({ requestInfo }) => {
    const authorization = requestInfo?.headers.get('authorization') ?? '';
    const apiKey = /^Bearer (\S+)$/i.exec(authorization)?.[1];
    return createVenueServer(new ApiClient({ baseUrl: options.apiUrl, apiKey }), {
      paymentToken: options.paymentToken,
      ...(options.personalKey
        ? { personal: new ApiClient({ baseUrl: options.apiUrl, apiKey: options.personalKey }) }
        : {}),
    });
  });
  // The tools that set up a client, at their own address, for a key that manages programs only.
  const onboarding = createMcpHandler(({ requestInfo }) => {
    const apiKey = /^Bearer (\S+)$/i.exec(requestInfo?.headers.get('authorization') ?? '')?.[1];
    return createOnboardingServer(new ApiClient({ baseUrl: options.apiUrl, apiKey }));
  });
  const app = createMcpFastifyApp();
  const node = toNodeHandler(handler);
  const onboardingNode = toNodeHandler(onboarding);
  app.all('/mcp', (request, reply) => node(request.raw, reply.raw, request.body));
  app.all('/mcp/onboarding', (request, reply) =>
    onboardingNode(request.raw, reply.raw, request.body),
  );
  app.addHook('onClose', async () => {
    await handler.close();
    await onboarding.close();
  });
  return app;
}
