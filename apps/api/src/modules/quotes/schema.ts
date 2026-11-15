import { z } from 'zod';

export const QuoteBody = z.object({
  activityId: z.string().min(1),
  /** The classification this quote came from, when the customer started with a description. */
  classificationId: z.string().min(1).optional(),
  venueId: z.string().min(1).optional(),
  participants: z.number().int().min(1).max(1_000_000),
  hours: z.number().positive().max(10_000),
  alcohol: z.enum(['none', 'served', 'sold']),
  eventDate: z.iso.date(),
  /** Wall-clock start, read as UTC in this demo. */
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  limitCents: z.union([z.literal(200_000_000), z.literal(500_000_000)]),
  holder: z.object({ name: z.string().min(1).max(200), email: z.email() }),
  bookingRef: z.string().min(1).max(100).optional(),
  /** Answers to the program's follow-up questions, by question id. */
  answers: z.record(z.string(), z.union([z.string().max(200), z.number(), z.boolean()])).optional(),
});
export type QuoteInput = z.infer<typeof QuoteBody>;

export const BindBody = z.object({ paymentToken: z.string().min(1).max(200) });

export const UnderwriterDecision = z
  .object({
    action: z.enum(['approve', 'approve_with_override', 'decline']),
    riskClass: z.enum(['A', 'B', 'C']).optional(),
    activityId: z.string().min(1).optional(),
    note: z.string().trim().min(1).max(2000),
    /** Worksheet lines whose amount the underwriter changed (approve only). */
    lines: z
      .array(
        z.object({
          id: z.string().min(1),
          amountCents: z.number().int(),
          note: z.string().trim().min(1).max(500),
        }),
      )
      .min(1)
      .max(30)
      .optional(),
  })
  .superRefine((d, ctx) => {
    const overrides = d.riskClass !== undefined || d.activityId !== undefined;
    if (d.action === 'approve_with_override' && !overrides) {
      ctx.addIssue({
        code: 'custom',
        path: ['action'],
        message: 'give a riskClass or an activityId to override',
      });
    }
    if (d.lines && d.action !== 'approve') {
      ctx.addIssue({
        code: 'custom',
        path: ['lines'],
        message: 'only a plain approve takes worksheet lines',
      });
    }
    if (d.action !== 'approve_with_override' && overrides) {
      ctx.addIssue({
        code: 'custom',
        path: ['action'],
        message: 'only approve_with_override takes a riskClass or an activityId',
      });
    }
  });
export type UnderwriterDecisionInput = z.infer<typeof UnderwriterDecision>;
