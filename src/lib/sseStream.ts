/**
 * SSE-Stream per fetch + ReadableStream (statt EventSource).
 * Umgeht Proxy-/EventSource-Probleme und gibt volle Kontrolle über die Verbindung.
 */

export type SSESubscribeOptions = {
  url: string
  onMessage: (data: Record<string, unknown>) => void
  onError?: (err: unknown) => void
  signal?: AbortSignal
}

/**
 * Öffnet den SSE-Endpunkt per fetch, liest den Stream und ruft onMessage
 * für jedes "data:"-Event auf. Läuft bis signal aborted oder Stream endet.
 */
export async function subscribeSSE(options: SSESubscribeOptions): Promise<void> {
  const { url, onMessage, onError, signal } = options
  const res = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'text/event-stream' },
    signal,
  })
  if (!res.ok || !res.body) {
    onError?.(new Error(`SSE ${res.status}`))
    return
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (signal?.aborted) break
      buffer += decoder.decode(value, { stream: true })
      const events = buffer.split(/\n\n+/)
      buffer = events.pop() ?? ''
      for (const event of events) {
        const line = event.split('\n').find((l) => l.startsWith('data:'))
        if (!line) continue
        const json = line.slice(5).trim()
        if (!json) continue
        try {
          const data = JSON.parse(json) as Record<string, unknown>
          onMessage(data)
        } catch {
          // kein JSON – ignorieren
        }
      }
    }
  } catch (err) {
    if ((err as { name?: string }).name !== 'AbortError') {
      onError?.(err)
    }
  } finally {
    reader.releaseLock()
  }
}
