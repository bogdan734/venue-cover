import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { LINES } from './lines.ts';

// Speaks every sentence of the film with Kokoro, an open text-to-speech voice (Apache-2.0), on this machine's CPU: no key
// and no service. Its weights are downloaded once, into the cache that scripts/media/make installs it in.
//   node --import tsx scripts/media/voice.ts <kokoro install dir> <work dir>
// Writes <work>/voice/<scene>-<n>.wav, trimmed of silence, and <work>/voice.json with each sentence's length in seconds.
const [tts, work] = process.argv.slice(2);
if (!tts || !work) throw new Error('usage: voice.ts <kokoro install dir> <work dir>');
const VOICE = process.env.FILM_VOICE ?? 'af_heart';

type Speech = { audio: Float32Array; sampling_rate: number };
type Kokoro = {
  generate(text: string, options: { voice: string; speed: number }): Promise<Speech>;
};
const { KokoroTTS } = await import(
  pathToFileURL(resolve(tts, 'node_modules/kokoro-js/dist/kokoro.js')).href
);
const model: Kokoro = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
  dtype: 'q8',
  device: 'cpu',
});

// The model leaves a little silence at each end; the edit times sentences by their sound, so it goes.
function trim(samples: Float32Array, rate: number): Float32Array {
  const floor = 0.01 * samples.reduce((top, s) => Math.max(top, Math.abs(s)), 0);
  const first = samples.findIndex((s) => Math.abs(s) > floor);
  let last = samples.length - 1;
  while (last > first && Math.abs(samples[last] ?? 0) <= floor) last--;
  const margin = Math.round(0.03 * rate);
  return samples.slice(Math.max(0, first - margin), Math.min(samples.length, last + margin));
}

// 16-bit PCM, mono.
function wav(samples: Float32Array, rate: number): Buffer {
  const out = Buffer.alloc(44 + samples.length * 2);
  out.write('RIFF', 0);
  out.writeUInt32LE(36 + samples.length * 2, 4);
  out.write('WAVEfmt ', 8);
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(1, 22);
  out.writeUInt32LE(rate, 24);
  out.writeUInt32LE(rate * 2, 28);
  out.writeUInt16LE(2, 32);
  out.writeUInt16LE(16, 34);
  out.write('data', 36);
  out.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((s, i) => {
    out.writeInt16LE(Math.round(Math.max(-1, Math.min(1, s)) * 32767), 44 + i * 2);
  });
  return out;
}

mkdirSync(join(work, 'voice'), { recursive: true });
const lengths: Record<string, number[]> = {};
for (const [scene, sentences] of Object.entries(LINES)) {
  lengths[scene] = [];
  for (const [n, sentence] of sentences.entries()) {
    const speech = await model.generate(sentence, { voice: VOICE, speed: 1 });
    const samples = trim(speech.audio, speech.sampling_rate);
    writeFileSync(join(work, 'voice', `${scene}-${n}.wav`), wav(samples, speech.sampling_rate));
    lengths[scene].push(samples.length / speech.sampling_rate);
  }
  console.log(scene, lengths[scene].map((s) => s.toFixed(2)).join(' + '));
}
writeFileSync(join(work, 'voice.json'), JSON.stringify(lengths, null, 1));
