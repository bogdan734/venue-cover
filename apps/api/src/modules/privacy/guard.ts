import type { Span } from './detect.js';

// A model call as the intake module defines it, kept structural so that this module does not depend on intake.
export interface ModelRequest {
  system: string;
  user: string;
  schema: object;
}
export interface Model {
  completeJson(request: ModelRequest): Promise<unknown>;
}
export interface GuardStats {
  calls: number;
  stripped: number;
}

// Wraps the model the server is given. The untrusted part of every prompt (the user turn) is checked again just before it
// leaves, and what still looks personal is replaced by its kind alone. Call sites protect their text themselves, with tags
// the people allowed to can reverse; this is the net under them, so a call site that forgets cannot leak.
export function guardLlm(
  model: Model,
  detect: (text: string) => Promise<Span[]>,
): { llm: Model; stats(): GuardStats } {
  let calls = 0;
  let stripped = 0;
  return {
    llm: {
      async completeJson(request) {
        calls += 1;
        const spans = await detect(request.user);
        let user = request.user;
        for (const span of [...spans].reverse()) {
          user = `${user.slice(0, span.start)}[${span.kind}]${user.slice(span.end)}`;
        }
        stripped += spans.length;
        return model.completeJson({ ...request, user });
      },
    },
    stats: () => ({ calls, stripped }),
  };
}
