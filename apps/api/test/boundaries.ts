import { posix } from 'node:path';

export interface SourceFile {
  path: string;
  source: string;
}

export interface Violation {
  file: string;
  importPath: string;
}

const MODULES = 'src/modules/';
const IMPORT = /(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g;

function moduleOf(path: string): string | null {
  if (!path.startsWith(MODULES)) return null;
  return path.slice(MODULES.length).split('/')[0] ?? null;
}

// A module's index file is its only public surface: code outside the module may import nothing else.
export function findBoundaryViolations(files: SourceFile[]): Violation[] {
  const violations: Violation[] = [];
  for (const file of files) {
    const own = moduleOf(file.path);
    for (const match of file.source.matchAll(IMPORT)) {
      const importPath = match[1] as string;
      const target = posix.normalize(posix.join(posix.dirname(file.path), importPath));
      const targetModule = moduleOf(target);
      if (targetModule === null || targetModule === own) continue;
      const surface = `${MODULES}${targetModule}/index`;
      if (target.replace(/\.(js|ts)$/, '') !== surface) {
        violations.push({ file: file.path, importPath });
      }
    }
  }
  return violations;
}
