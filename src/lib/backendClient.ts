import type { BrokerConfig, CouchDbSettings } from './types'

const BACKEND_BASE = '/api'

/** In Dev: direkte Backend-URL, damit SSE den Vite-Proxy umgeht (kein Buffering). */
const SSE_BASE =
  typeof import.meta !== 'undefined' && import.meta.env?.DEV
    ? 'http://localhost:3001'
    : ''

export function getDevicesStreamUrl(): string {
  const base = SSE_BASE || BACKEND_BASE
  const path = SSE_BASE ? '/api/devices/stream' : '/devices/stream'
  return `${base.replace(/\/$/, '')}${path}`
}

export type BackupInfo = {
  lastTimestamp: string | null
  count: number
}

export type BackendStatus = {
  couchdb: boolean
  brokers: Record<string, 'connected' | 'disconnected'>
}

const HEALTH_CACHE_MS = 45_000
let healthCache: { ok: boolean; at: number } | null = null

export async function checkBackendAvailable(baseUrl?: string): Promise<boolean> {
  const url = (baseUrl ?? BACKEND_BASE).replace(/\/$/, '') + '/status'
  if (healthCache && Date.now() - healthCache.at < HEALTH_CACHE_MS) {
    return healthCache.ok
  }
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) })
    healthCache = { ok: res.ok, at: Date.now() }
    return res.ok
  } catch {
    healthCache = { ok: false, at: Date.now() }
    return false
  }
}

export function clearBackendHealthCache(): void {
  healthCache = null
}

export async function getBackendStatus(baseUrl?: string): Promise<BackendStatus | null> {
  const url = (baseUrl ?? BACKEND_BASE).replace(/\/$/, '') + '/status'
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) return null
    return (await res.json()) as BackendStatus
  } catch {
    return null
  }
}

export async function postCouchDbConfig(
  baseUrl: string | undefined,
  couchdb: CouchDbSettings
): Promise<void> {
  const url = (baseUrl ?? BACKEND_BASE).replace(/\/$/, '') + '/config/couchdb'
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      host: couchdb.host,
      port: couchdb.port,
      useTls: couchdb.useTls,
      username: couchdb.username,
      password: couchdb.password,
      database: couchdb.database,
    }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error((data as { error?: string }).error ?? res.statusText)
  }
}

export async function fetchBrokersFromBackend(baseUrl?: string): Promise<BrokerConfig[]> {
  const url = (baseUrl ?? BACKEND_BASE).replace(/\/$/, '') + '/brokers'
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
  if (!res.ok) return []
  return (await res.json()) as BrokerConfig[]
}

export async function fetchDevicesFromBackend(baseUrl?: string): Promise<Record<string, unknown>> {
  const url = (baseUrl ?? BACKEND_BASE).replace(/\/$/, '') + '/devices'
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) })
  if (!res.ok) return {}
  return (await res.json()) as Record<string, unknown>
}

/** Sendet einen MQTT-Befehl über das Backend (POST /api/command). */
export async function sendCommand(
  baseUrl: string | undefined,
  deviceId: string,
  topic: string,
  payload: string
): Promise<void> {
  const url = (baseUrl ?? BACKEND_BASE).replace(/\/$/, '') + '/command'
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId, topic, payload }),
    signal: AbortSignal.timeout(5000),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error((data as { error?: string }).error ?? res.statusText)
  }
}

export async function postBroker(baseUrl: string | undefined, broker: BrokerConfig): Promise<void> {
  const url = (baseUrl ?? BACKEND_BASE).replace(/\/$/, '') + '/brokers'
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(broker),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error((data as { error?: string }).error ?? res.statusText)
  }
}

export async function putBroker(
  baseUrl: string | undefined,
  brokerId: string,
  patch: Partial<Pick<BrokerConfig, 'name' | 'mqtt'>>
): Promise<void> {
  const url = `${(baseUrl ?? BACKEND_BASE).replace(/\/$/, '')}/brokers/${encodeURIComponent(brokerId)}`
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error((data as { error?: string }).error ?? res.statusText)
  }
}

export async function deleteBroker(baseUrl: string | undefined, brokerId: string): Promise<void> {
  const url = `${(baseUrl ?? BACKEND_BASE).replace(/\/$/, '')}/brokers/${encodeURIComponent(brokerId)}`
  const res = await fetch(url, { method: 'DELETE' })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error((data as { error?: string }).error ?? res.statusText)
  }
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

export async function requestDeleteBackup(
  baseUrl: string | undefined,
  params: {
    deviceId: string
    brokerId?: string
    couchdb: CouchDbSettings
    index: number
  },
): Promise<{ count: number; lastAt: string | null }> {
  const url = (baseUrl ?? BACKEND_BASE).replace(/\/$/, '') + '/backup/delete'
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      deviceId: params.deviceId,
      brokerId: params.brokerId,
      couchdb: params.couchdb,
      index: params.index,
    }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    const msg = (data as { error?: string }).error ?? res.statusText
    throw new Error(msg)
  }
  const data = (await res.json()) as { ok?: boolean; count: number; lastAt: string | null }
  return { count: data.count ?? 0, lastAt: data.lastAt ?? null }
}
