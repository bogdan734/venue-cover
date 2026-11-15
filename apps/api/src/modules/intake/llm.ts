export interface LlmRequest {
  system: string;
  user: string;
  /** JSON Schema of the object the model must return. */
  schema: object;
}

// The only thing the platform asks of a model: return one JSON value. Providers differ in how they enforce the schema.
export interface LlmProvider {
  completeJson(request: LlmRequest): Promise<unknown>;
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
