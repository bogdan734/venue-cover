import {
  coordinated,
  detectRules,
  mentionsOf,
  type PiiKind,
  resolve,
  type Span,
  TAG,
  withoutTags,
} from './detect.js';
import type { NameFinder } from './names.js';
import { keysFor, type ProgramKeys, tagOf } from './tags.js';

export interface Protected {
  /** The text with every personal detail replaced by its tag: what a model, the search index or a log may see. */
  text: string;
  /** Tag → the value as it was written. Sealed before it is stored. */
  vault: Record<string, string>;
  /** How many details of each kind were replaced. */
  found: Partial<Record<PiiKind, number>>;
}

export interface Shield {
  /** What finds names: the local model, or cue rules when the model is not on disk. */
  readonly finder: 'model' | 'rules';
  detect(text: string): Promise<Span[]>;
  protect(text: string, programId: string | null): Promise<Protected>;
  keys(programId: string | null): ProgramKeys;
}

// Rules for what has a shape, the names model (when there is one) for names, a word joined to a name by "and", and every
// later mention of a name found any of these ways.
export function createShield(options: { secret: string; names?: NameFinder }): Shield {
  keysFor(options.secret, null); // a bad secret fails when the server starts, not at the first request

  async function detect(text: string): Promise<Span[]> {
    const rules = detectRules(text);
    const model = options.names ? withoutTags(text, await options.names(text)) : [];
    const found = resolve([...rules, ...model].filter((span) => span.kind === 'NAME'));
    const named = resolve(withoutTags(text, [...found, ...coordinated(text, found)]));
    return resolve(withoutTags(text, [...rules, ...model, ...named, ...mentionsOf(text, named)]));
  }

  return {
    finder: options.names ? 'model' : 'rules',
    detect,
    keys: (programId) => keysFor(options.secret, programId),
    async protect(text, programId) {
      const spans = await detect(text);
      if (spans.length === 0) return { text, vault: {}, found: {} };
      const { tag: key } = keysFor(options.secret, programId);
      const vault: Record<string, string> = {};
      const found: Partial<Record<PiiKind, number>> = {};
      let protectedText = '';
      let at = 0;
      for (const span of spans) {
        const value = text.slice(span.start, span.end);
        const tag = tagOf(span.kind, value, key);
        vault[tag] ??= value;
        found[span.kind] = (found[span.kind] ?? 0) + 1;
        protectedText += text.slice(at, span.start) + tag;
        at = span.end;
      }
      return { text: protectedText + text.slice(at), vault, found };
    },
  };
}

// Puts the values back for a person allowed to see them. A value written two ways under one tag comes back the first way.
export function reveal(text: string, vault: Record<string, string>): string {
  return text.replace(TAG, (tag) => vault[tag] ?? tag);
}
