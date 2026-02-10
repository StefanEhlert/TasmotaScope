import type { CouchDbSettings } from './types'

const BACKEND_BASE = '/api'

export type BackupInfo = {
  lastTimestamp: string | null
  count: number
}
const HEALTH_CACHE_MS = 45_000

let healthCache: { ok: boolean; at: number } | null = null

export async function checkBackendAvailable(baseUrl?: string): Promise<boolean> {
  const url = (baseUrl ?? BACKEND_BASE).replace(/\/$/, '') + '/health'
  if (healthCache && Date.now() - healthCache.at < HEALTH_CACHE_MS) {
    return healthCache.ok
  }
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) })
    const ok = res.ok
    healthCache = { ok, at: Date.now() }
    return ok
  } catch {
    healthCache = { ok: false, at: Date.now() }
    return false
  }
}

export function clearBackendHealthCache(): void {
  healthCache = null
}

export async function requestBackup(
  baseUrl: string | undefined,
  params: {
    host: string
    deviceId: string
    brokerId?: string
    couchdb: CouchDbSettings
  },
): Promise<BackupInfo> {
  const url = (baseUrl ?? BACKEND_BASE).replace(/\/$/, '') + '/backup'
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      host: params.host,
      deviceId: params.deviceId,
      brokerId: params.brokerId,
      couchdb: params.couchdb,
    }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    const msg = (data as { error?: string }).error ?? res.statusText
    throw new Error(msg)
  }
  const data = (await res.json()) as BackupInfo & { ok?: boolean; created?: string }
  return {
    lastTimestamp: data.lastTimestamp ?? null,
    count: data.count ?? 0,
  }
}
