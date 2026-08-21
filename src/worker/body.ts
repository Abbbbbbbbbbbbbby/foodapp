// Streams a request body while counting real wire bytes, aborting (returns
// null) once the cap is exceeded instead of buffering the whole thing first.
// A request without Content-Length would otherwise buffer unbounded into the
// isolate's 128 MB memory ceiling before any post-read size check ran — a
// pre-auth DoS on a public hostname.
export async function readBodyCapped(request: Request, maxBytes: number): Promise<string | null> {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      // A cancel() throw (connection reset mid-abort) must not turn the
      // "too large" verdict into a generic thrown 500 — swallow it and keep
      // returning null so the caller still emits its 413/400.
      try { await reader.cancel(); } catch { /* best-effort */ }
      return null;
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}
