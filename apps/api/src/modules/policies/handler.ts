import type { MailProvider } from '../../providers/mail.js';
import { appendEvent, type EventHandler } from '../events/index.js';
import { recipientsOf, renderCertificate } from './certificate.js';
import { getPolicyView } from './view.js';

// On policy.issued: render a certificate for every party that is routed, mail it, and announce the result.
// The mail goes out at least once; its idempotency key keeps a retry from sending it twice.
export function createCertificateHandler(deps: { mail: MailProvider }): EventHandler {
  return async (event, trx) => {
    if (event.type !== 'policy.issued') return;
    const { policyId } = event.data as { policyId: string };
    const policy = await getPolicyView(trx, policyId);
    if (!policy) throw new Error(`policy ${policyId} does not exist`);

    const parties = recipientsOf(policy);
    for (const { holder, contact } of parties) {
      await deps.mail.send({
        to: contact.email,
        subject: `Certificate of insurance ${policy.policyNumber}`,
        body: `Dear ${contact.name}, the certificate of insurance for policy ${policy.policyNumber} is attached.`,
        attachment: {
          filename: `${policy.policyNumber}-${holder}.pdf`,
          bytes: await renderCertificate(policy, holder),
        },
        idempotencyKey: `${policy.id}:${holder}`,
      });
    }
    await appendEvent(trx, {
      type: 'certificate.ready',
      programId: policy.programId,
      data: { policyId: policy.id, quoteId: policy.quoteId, holders: parties.map((p) => p.holder) },
    });
    if (!policy.snapshot.routed) {
      await appendEvent(trx, {
        type: 'certificate.unrouted',
        programId: policy.programId,
        data: { policyId: policy.id, bookingRef: policy.snapshot.bookingRef },
      });
    }
  };
}
