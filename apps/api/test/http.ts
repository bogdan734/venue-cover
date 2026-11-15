import type { HttpClient } from '../src/modules/webhooks/index.js';

export interface RecordedCall {
  url: string;
  headers: Record<string, string>;
  body: string;
}

// A webhook receiver that never touches the network: it records each call and answers with a scripted status.
export class RecordingHttp implements HttpClient {
  readonly calls: RecordedCall[] = [];
  /** Returns a status code, or an Error to simulate a network failure. */
  handler: (call: RecordedCall) => number | Error | Promise<number | Error> = () => 200;

  async post(
    url: string,
    init: { headers: Record<string, string>; body: string },
  ): Promise<{ status: number }> {
    const call = { url, headers: init.headers, body: init.body };
    this.calls.push(call);
    const result = await this.handler(call);
    if (result instanceof Error) throw result;
    return { status: result };
  }
}
