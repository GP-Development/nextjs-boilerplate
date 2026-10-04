// Reads a request body without ever holding more than `maxBytes` (+ one chunk) in memory.
export type CappedBody = { ok: true; bytes: number; text: string } | { ok: false; status: 413 }

export async function readCapped(
  request: Request,
  maxBytes: number,
  { keepText }: { keepText: boolean },
): Promise<CappedBody> {
  const declared = Number(request.headers.get('content-length'))
  // Cheap early rejection. The streamed count below is the real enforcement,
  // because Content-Length can be absent (chunked) or wrong.
  if (Number.isFinite(declared) && declared > maxBytes) return { ok: false, status: 413 }
  if (!request.body) return { ok: true, bytes: 0, text: '' }

  const reader = request.body.getReader()
  const decoder = new TextDecoder()
  let bytes = 0
  let text = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    bytes += value.byteLength
    if (bytes > maxBytes) {
      await reader.cancel()
      return { ok: false, status: 413 }
    }
    if (keepText) text += decoder.decode(value, { stream: true })
  }
  return { ok: true, bytes, text }
}
