export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiOptions {
  baseUrl: string;
  /** The caller's API key. Without one every call is refused by the API, which is the right answer. */
  apiKey: string | undefined;
  fetch?: typeof fetch;
}

export interface QuoteSummary {
  id: string;
  state: string;
  premium: { totalCents: number; netCents: number; taxCents: number } | null;
  holder: { name: string; email: string };
  referralReasons: string[];
  expiresAt: string;
}

export interface Activity {
  activityId: string;
  title: string;
  riskClass: string;
  score: number;
}

export interface Classification {
  id: string;
  riskClass: string | null;
  confidence: number;
  degraded: boolean;
  primary: Activity | null;
  facts: Record<string, unknown>;
  decision: { outcome: string; reasons: string[] };
}

export interface ProgramSummary {
  id: string;
  code: string;
  name: string;
  status: 'draft' | 'test' | 'live' | 'paused';
  theme: {
    brand: string;
    logo: string | null;
    tagline: string | null;
    welcome: string | null;
  } | null;
  contacts: Record<string, string | null> | null;
  versions: { version: number; effectiveFrom: string }[];
}

export interface RulesDraft {
  changes: Record<string, unknown>;
  notes: { field: string; summary?: string }[];
  unresolved: string[];
  degraded: boolean;
}

export interface PolicySummary {
  id: string;
  policyNumber: string;
  startsAt: string;
  endsAt: string;
  totalCents: number;
  snapshot: { holder: { name: string }; activityTitle: string; routed: boolean };
}

// A small client for the REST API. The MCP server holds no state and no rules of its own: whatever the API decides,
// the tool reports.
export class ApiClient {
  constructor(private readonly options: ApiOptions) {}

  private async call<T>(
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    body?: unknown,
    idempotencyKey?: string,
  ): Promise<T> {
    const response = await (this.options.fetch ?? fetch)(`${this.options.baseUrl}${path}`, {
      method,
      headers: {
        ...(this.options.apiKey ? { authorization: `Bearer ${this.options.apiKey}` } : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    const json = text
      ? (JSON.parse(text) as { error?: { code?: string; message?: string } })
      : undefined;
    if (!response.ok) {
      throw new ApiError(
        response.status,
        json?.error?.code ?? 'http_error',
        json?.error?.message ?? response.statusText,
      );
    }
    return json as T;
  }

  async searchActivities(q: string): Promise<Activity[]> {
    return (
      await this.call<{ activities: Activity[] }>(
        'GET',
        `/v1/activities?q=${encodeURIComponent(q)}`,
      )
    ).activities;
  }

  classify(text: string): Promise<Classification> {
    return this.call('POST', '/v1/intake/classify', { text });
  }

  createQuote(body: Record<string, unknown>, idempotencyKey: string): Promise<QuoteSummary> {
    return this.call('POST', '/v1/quotes', body, idempotencyKey);
  }

  getQuote(id: string): Promise<QuoteSummary> {
    return this.call('GET', `/v1/quotes/${encodeURIComponent(id)}`);
  }

  bindQuote(
    id: string,
    paymentToken: string,
    idempotencyKey: string,
  ): Promise<{ policyId: string; policyNumber: string }> {
    return this.call(
      'POST',
      `/v1/quotes/${encodeURIComponent(id)}/bind`,
      { paymentToken },
      idempotencyKey,
    );
  }

  getPolicy(id: string): Promise<PolicySummary> {
    return this.call('GET', `/v1/policies/${encodeURIComponent(id)}`);
  }

  programOptions(): Promise<{
    templates: { id: string }[];
    brokers: { id: string; name: string }[];
  }> {
    return this.call('GET', '/v1/program-options');
  }

  createProgram(body: Record<string, unknown>, idempotencyKey: string): Promise<ProgramSummary> {
    return this.call('POST', '/v1/programs', body, idempotencyKey);
  }

  getProgram(id: string): Promise<ProgramSummary> {
    return this.call('GET', `/v1/programs/${encodeURIComponent(id)}`);
  }

  draftRules(id: string, text: string): Promise<RulesDraft> {
    return this.call('POST', `/v1/programs/${encodeURIComponent(id)}/rules/draft`, { text });
  }

  publishRules(
    id: string,
    changes: Record<string, unknown>,
    effectiveFrom: string,
    idempotencyKey: string,
  ): Promise<{ version: number }> {
    return this.call(
      'POST',
      `/v1/programs/${encodeURIComponent(id)}/rules`,
      { changes, effectiveFrom },
      idempotencyKey,
    );
  }

  setAppearance(id: string, theme: Record<string, unknown>): Promise<ProgramSummary> {
    return this.call('PUT', `/v1/programs/${encodeURIComponent(id)}/appearance`, theme);
  }

  setContacts(id: string, contacts: Record<string, unknown>): Promise<ProgramSummary> {
    return this.call('PUT', `/v1/programs/${encodeURIComponent(id)}/contacts`, contacts);
  }

  moveProgram(id: string, to: string, idempotencyKey: string): Promise<ProgramSummary> {
    return this.call(
      'POST',
      `/v1/programs/${encodeURIComponent(id)}/status`,
      { to },
      idempotencyKey,
    );
  }
}
