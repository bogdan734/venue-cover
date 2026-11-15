import { describe, expect, it } from 'vitest';
import {
  createFakeLlm,
  createRecordedLlm,
  createRecordingLlm,
} from '../src/modules/intake/index.js';

const request = (user: string, system = 'extract the facts') => ({
  system,
  user,
  schema: { type: 'object' },
});
const answers: Record<string, unknown> = {
  a: { activities: ['yoga class'] },
  b: { activities: ['hockey game'] },
};

async function recorded() {
  const recorder = createRecordingLlm(
    createFakeLlm(({ user }) => answers[user]),
    'test-model',
  );
  await recorder.llm.completeJson(request('b'));
  await recorder.llm.completeJson(request('a'));
  return recorder.recording();
}

describe('recorded model answers', () => {
  it('replays each answer for its own request, in any order, after a round trip through JSON', async () => {
    const replay = createRecordedLlm(JSON.parse(JSON.stringify(await recorded())));
    expect(await replay.completeJson(request('a'))).toEqual(answers.a);
    expect(await replay.completeJson(request('b'))).toEqual(answers.b);
  });

  it('names the model and keeps its keys in a fixed order, so that a recording diffs cleanly', async () => {
    const recording = await recorded();
    expect(recording.model).toBe('test-model');
    const keys = Object.keys(recording.responses);
    expect(keys).toEqual([...keys].sort());
  });

  it('adds to what was recorded before instead of starting again', async () => {
    const first = await recorded();
    const recorder = createRecordingLlm(
      createFakeLlm(() => ({ activities: ['new'] })),
      'test-model',
      first.responses,
    );
    await recorder.llm.completeJson(request('c'));
    const replay = createRecordedLlm(recorder.recording());
    expect(await replay.completeJson(request('a'))).toEqual(answers.a);
    expect(await replay.completeJson(request('c'))).toEqual({ activities: ['new'] });
  });

  it('treats a request it never recorded as an error when there is no fallback', async () => {
    const replay = createRecordedLlm(await recorded());
    await expect(replay.completeJson(request('c'))).rejects.toThrow(/no recorded answer/);
  });

  it('sends a request it never recorded to the fallback when there is one', async () => {
    const replay = createRecordedLlm(
      await recorded(),
      createFakeLlm(() => 'from the fallback'),
    );
    expect(await replay.completeJson(request('c'))).toBe('from the fallback');
    expect(await replay.completeJson(request('a'))).toEqual(answers.a);
  });

  it('treats a changed prompt as a miss, never as the old answer', async () => {
    const replay = createRecordedLlm(await recorded());
    await expect(
      replay.completeJson(request('a', 'extract the facts, but better')),
    ).rejects.toThrow(/no recorded answer/);
    await expect(
      replay.completeJson({ ...request('a'), schema: { type: 'array' } }),
    ).rejects.toThrow(/no recorded answer/);
  });
});
