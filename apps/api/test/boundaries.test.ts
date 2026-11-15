import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findBoundaryViolations } from './boundaries.js';

const root = join(import.meta.dirname, '..', 'src');

describe('module boundaries', () => {
  it('flags a cross-module import of internals', () => {
    const violations = findBoundaryViolations([
      {
        path: 'src/modules/rating/rate.ts',
        source: "import { price } from '../quotes/service.js';",
      },
    ]);
    expect(violations).toEqual([
      { file: 'src/modules/rating/rate.ts', importPath: '../quotes/service.js' },
    ]);
  });

  it('allows the public surface of another module and imports inside the same module', () => {
    const violations = findBoundaryViolations([
      {
        path: 'src/modules/rating/rate.ts',
        source: "import { a } from '../quotes/index.js';\nimport { b } from './tax.js';",
      },
    ]);
    expect(violations).toEqual([]);
  });

  it('flags code outside modules that reaches into a module', () => {
    const violations = findBoundaryViolations([
      { path: 'src/server.ts', source: "import { r } from './modules/quotes/routes.js';" },
    ]);
    expect(violations).toHaveLength(1);
  });

  it('holds for the real source tree', () => {
    const files = (readdirSync(root, { recursive: true }) as string[])
      .filter((p) => p.endsWith('.ts') && !p.endsWith('.test.ts'))
      .map((p) => ({ path: `src/${p}`, source: readFileSync(join(root, p), 'utf8') }));
    expect(findBoundaryViolations(files)).toEqual([]);
  });
});
