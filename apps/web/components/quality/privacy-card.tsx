import { ShieldCheck } from 'lucide-react';
import { KIND } from '@/components/model-view';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader, Stat } from '@/components/ui/card';
import { Table, Td, Th } from '@/components/ui/table';
import { count, percent } from '@/lib/format';
import type { PrivacyEval, PrivacyLive } from '@/lib/types';

const ORDER = ['NAME', 'PHONE', 'EMAIL', 'ADDRESS', 'CARD', 'SIN', 'DOB', 'POSTAL'];

// How well personal details are kept from the model: the committed measurement, and what the guard on this server has
// seen since it started.
export function PrivacyCard({ result, live }: { result: PrivacyEval; live: PrivacyLive }) {
  const rules = result.detectors.find((d) => d.id === 'rules');
  const model = result.detectors.find((d) => d.id === 'model');
  const best = model ?? rules;
  if (!best) return null;
  const kinds = ORDER.filter((kind) => (best.planted[kind] ?? 0) > 0);
  return (
    <Card aria-label="Personal details kept from the model" className="mb-6">
      <CardHeader
        title="Personal details kept from the model"
        note={`${count(result.texts)} invented descriptions with ${count(best.plantedTotal)} details planted in them, none of which the rules were tuned on. Each is protected as a request is; a planted value still in the text is one the model would have read.`}
        aside={
          <Badge tone="ok">
            <ShieldCheck className="size-3.5" aria-hidden /> names by the{' '}
            {live.names === 'model' ? 'local model' : 'cue rules'}
          </Badge>
        }
      />
      <CardBody className="grid grid-cols-2 gap-6 border-b border-line sm:grid-cols-4">
        {model ? (
          <Stat
            label="Reached the model"
            value={`${count(model.leakedTotal)} of ${count(model.plantedTotal)}`}
            note={`${percent(model.leakedTotal / model.plantedTotal, 2)} with the names model`}
          />
        ) : null}
        {rules ? (
          <Stat
            label="With cue rules alone"
            value={`${count(rules.leakedTotal)} of ${count(rules.plantedTotal)}`}
            note="a name nothing points at gets through"
          />
        ) : null}
        <Stat
          label="Golden cases changed"
          value={`${count(best.goldenChanged)} of ${count(result.goldenCases)}`}
          note="text with nothing personal stays as written"
        />
        <Stat
          label="Cost per text"
          value={`${best.p95Ms} ms`}
          note={
            rules && model ? `95th percentile; rules alone ${rules.p95Ms} ms` : '95th percentile'
          }
        />
      </CardBody>
      <Table>
        <thead>
          <tr>
            <Th>Kind of detail</Th>
            <Th numeric>Planted</Th>
            {rules ? <Th numeric>Reached the model, rules alone</Th> : null}
            {model ? <Th numeric>Reached the model, names model on</Th> : null}
          </tr>
        </thead>
        <tbody>
          {kinds.map((kind) => (
            <tr key={kind}>
              <Td>{KIND[kind] ?? kind}</Td>
              <Td numeric>{count(best.planted[kind] ?? 0)}</Td>
              {rules ? <Td numeric>{count(rules.leaked[kind] ?? 0)}</Td> : null}
              {model ? <Td numeric>{count(model.leaked[kind] ?? 0)}</Td> : null}
            </tr>
          ))}
        </tbody>
      </Table>
      <CardBody>
        <p className="text-sm text-ink-soft">
          On this server the guard in front of the model has checked {count(live.guard.calls)}{' '}
          {live.guard.calls === 1 ? 'call' : 'calls'} since it started and had to strip{' '}
          {count(live.guard.stripped)} {live.guard.stripped === 1 ? 'detail' : 'details'}: it strips
          what a call site forgot to protect, so zero means every call site did.
        </p>
        <p className="mt-2 text-sm text-ink-faint">
          This is pseudonymisation, not anonymisation: a rare mix of details (an unusual activity, a
          date, a small town) can still point at someone, and a name the detector misses reaches the
          model. Measured {result.measuredOn} with <code>npm run eval:privacy</code>.
        </p>
      </CardBody>
    </Card>
  );
}
