import { inflateSync } from 'node:zlib';

// Reads the text a pdf-lib document draws: inflate every stream and collect the hex strings shown with Tj.
export function pdfText(bytes: Uint8Array): string {
  const raw = Buffer.from(bytes).toString('latin1');
  const out: string[] = [];
  for (const match of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let content: string;
    try {
      content = inflateSync(Buffer.from(match[1] as string, 'latin1')).toString('latin1');
    } catch {
      content = match[1] as string;
    }
    for (const hex of content.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) {
      out.push(Buffer.from(hex[1] as string, 'hex').toString('latin1'));
    }
  }
  return out.join('\n');
}
