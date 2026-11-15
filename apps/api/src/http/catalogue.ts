import type { FastifyInstance } from 'fastify';

export interface ApiRoute {
  method: string;
  /** In Fastify's form: /v1/quotes/:id. */
  url: string;
}

declare module 'fastify' {
  interface FastifyInstance {
    /** Every /v1 route registered on the server, so that the API description can be checked against reality. */
    apiRoutes: ApiRoute[];
  }
}

// Call before any route is registered.
export function collectApiRoutes(app: FastifyInstance): void {
  const routes: ApiRoute[] = [];
  app.decorate('apiRoutes', routes);
  app.addHook('onRoute', (route) => {
    if (!route.url.startsWith('/v1/')) return;
    for (const method of [route.method].flat()) {
      if (method !== 'HEAD' && method !== 'OPTIONS') routes.push({ method, url: route.url });
    }
  });
}
