export { detectRules, type PiiKind, type Span, TAG } from './detect.js';
export { registerPersonalGate, resolveTags } from './gate.js';
export { type GuardStats, guardLlm } from './guard.js';
export {
  createNameModel,
  isNameModelCached,
  NAME_MODEL,
  type NameFinder,
  spansFromEntities,
} from './names.js';
export { registerPrivacyRoutes } from './routes.js';
export { createShield, type Protected, reveal, type Shield } from './shield.js';
export { keysFor, type ProgramKeys, tagOf } from './tags.js';
export { open, seal } from './vault.js';
