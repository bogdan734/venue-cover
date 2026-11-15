export interface Part {
  name: string;
  filename?: string;
  contentType?: string;
  data: Uint8Array | string;
}

// A multipart/form-data body for app.inject, without pulling in a form-data library.
export function multipart(parts: Part[]): { payload: Buffer; headers: { 'content-type': string } } {
  const boundary = `----venue-cover-${Math.random().toString(16).slice(2)}`;
  const chunks: Buffer[] = [];
  for (const part of parts) {
    const disposition = `Content-Disposition: form-data; name="${part.name}"${part.filename ? `; filename="${part.filename}"` : ''}`;
    const type = part.filename
      ? `\r\nContent-Type: ${part.contentType ?? 'application/octet-stream'}`
      : '';
    chunks.push(
      Buffer.from(`--${boundary}\r\n${disposition}${type}\r\n\r\n`),
      Buffer.from(part.data),
      Buffer.from('\r\n'),
    );
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    payload: Buffer.concat(chunks),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}
