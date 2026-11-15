import { randomBytes } from 'node:crypto';
import type { Cents } from '../domain/types.js';

export interface ChargeRequest {
  amountCents: Cents;
  /** Doubles as the idempotency key: charging the same reference twice must not charge twice. */
  reference: string;
  token: string;
}

export type PaymentResult =
  | { status: 'approved'; paymentId: string }
  | { status: 'declined'; reason: string };

export interface PaymentProvider {
  charge(request: ChargeRequest): Promise<PaymentResult>;
}

// No real money moves in this project. The simulator remembers its calls; like a real provider's sandbox, the token
// decides what happens: `tok_declined` is refused and anything else is approved.
export class SimulatedPayments implements PaymentProvider {
  readonly calls: ChargeRequest[] = [];
  private readonly approved = new Map<string, string>();

  async charge(request: ChargeRequest): Promise<PaymentResult> {
    this.calls.push(request);
    if (request.token === 'tok_declined')
      return { status: 'declined', reason: 'the card was declined' };
    let paymentId = this.approved.get(request.reference);
    if (!paymentId) {
      paymentId = `pay_${randomBytes(6).toString('hex')}`;
      this.approved.set(request.reference, paymentId);
    }
    return { status: 'approved', paymentId };
  }
}
