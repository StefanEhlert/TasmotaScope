import type { BrokerConfig, CouchDbSettings, DeviceSettingsUi } from './types'

export function buildCouchDbBaseUrl(settings: CouchDbSettings): string {
  const protocol = settings.useTls ? 'https' : 'http'
  return `${protocol}://${settings.host}:${settings.port}`
}

function buildBasicAuthHeader(settings: CouchDbSettings): string {
  const token = btoa(`${settings.username}:${settings.password}`)
  return `Basic ${token}`
}

export async function testCouchDbConnection(settings: CouchDbSettings): Promise<void> {
  const baseUrl = buildCouchDbBaseUrl(settings)
  const headers = {
    Authorization: buildBasicAuthHeader(settings),
  }

  const upResponse = await fetch(`${baseUrl}/_up`, {
    method: 'GET',
    headers,
  })

  if (!upResponse.ok) {
    throw new Error('CouchDB ist nicht erreichbar.')
  }

  const dbName = encodeURIComponent(settings.database)
  const dbResponse = await fetch(`${baseUrl}/${dbName}`, {
    method: 'GET',
    headers,
  })

  if (dbResponse.status === 404) {
    throw new Error('Datenbank existiert nicht.')
  }

  if (!dbResponse.ok) {
    throw new Error('CouchDB-Datenbank nicht erreichbar.')
  }
}

export type DeviceBackupItem = {
  data: string
  createdAt: string
}

export type DeviceBackups = {
  count: number
  lastAt: string | null
  items: DeviceBackupItem[]
}

export type DeviceSnapshot = {
  deviceId: string
  brokerId?: string
  lastSeen?: string
  online?: boolean
  topic?: string
  fields: {
    name?: string
    ip?: string
    firmware?: string
    module?: string
    uptime?: string
    signal?: number
  }
  raw: Record<string, unknown>
  backups?: DeviceBackups
  settingsUi?: DeviceSettingsUi
}

function normalizeBrokerId(brokerId?: string) {
  const value = brokerId?.trim()
  return value && value.length > 0 ? value : 'default'
}

const deviceRevCache = new Map<string, string>()
const knownDeviceDocs = new Set<string>()

export async function upsertDeviceSnapshot(
  settings: CouchDbSettings,
  snapshot: DeviceSnapshot,
): Promise<void> {
  const baseUrl = buildCouchDbBaseUrl(settings)
  const headers = {
    Authorization: buildBasicAuthHeader(settings),
    'Content-Type': 'application/json',
  }
  const brokerId = normalizeBrokerId(snapshot.brokerId)
  const docId = `device:${brokerId}:${snapshot.deviceId}`
  const dbName = encodeURIComponent(settings.database)
  const docPath = `${baseUrl}/${dbName}/${encodeURIComponent(docId)}`

  let rev = deviceRevCache.get(docId)
  let existingBackups: DeviceBackups | undefined
  let existingSettingsUi: DeviceSettingsUi | undefined
  const getResponse = await fetch(docPath, { method: 'GET', headers })
  if (getResponse.ok) {
    const existing = (await getResponse.json()) as {
      _rev?: string
      backups?: DeviceBackups
      settingsUi?: DeviceSettingsUi
    }
    rev = existing._rev
    existingBackups = existing.backups
    existingSettingsUi = existing.settingsUi
    if (rev) {
      deviceRevCache.set(docId, rev)
    }
  } else if (getResponse.status === 404) {
    knownDeviceDocs.delete(docId)
  }

  const payload = {
    _id: docId,
    deviceId: snapshot.deviceId,
    brokerId,
    lastSeen: snapshot.lastSeen,
    online: snapshot.online,
    topic: snapshot.topic,
    fields: snapshot.fields,
    raw: snapshot.raw,
    updatedAt: new Date().toISOString(),
    ...(existingBackups ? { backups: existingBackups } : {}),
    ...((snapshot.settingsUi !== undefined || existingSettingsUi !== undefined)
      ? { settingsUi: snapshot.settingsUi ?? existingSettingsUi }
      : {}),
  }

  const putResponse = await fetch(docPath, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      ...payload,
      ...(rev ? { _rev: rev } : {}),
    }),
  })

  if (putResponse.ok) {
    const result = (await putResponse.json()) as { rev?: string }
    if (result.rev) {
      deviceRevCache.set(docId, result.rev)
    }
    knownDeviceDocs.add(docId)
    return
  }

  if (putResponse.status !== 409) {
    const detail = await putResponse.text()
    throw new Error(`CouchDB-Speichern fehlgeschlagen: ${detail}`)
  }

  const retryGetResponse = await fetch(docPath, { method: 'GET', headers })
  if (!retryGetResponse.ok) {
    const detail = await retryGetResponse.text()
    throw new Error(`CouchDB-Speichern fehlgeschlagen: ${detail}`)
  }
  const existing = (await retryGetResponse.json()) as { _rev?: string; backups?: DeviceBackups }
  rev = existing._rev
  const retryPayload = {
    ...payload,
    ...(existing.backups ? { backups: existing.backups } : {}),
    ...(rev ? { _rev: rev } : {}),
  }
  const retryResponse = await fetch(docPath, {
    method: 'PUT',
    headers,
    body: JSON.stringify(retryPayload),
  })
  if (!retryResponse.ok) {
    const detail = await retryResponse.text()
    throw new Error(`CouchDB-Speichern fehlgeschlagen: ${detail}`)
  }
  const retryResult = (await retryResponse.json()) as { rev?: string }
  if (retryResult.rev) {
    deviceRevCache.set(docId, retryResult.rev)
  }
  knownDeviceDocs.add(docId)
}

export async function fetchDeviceSnapshots(
  settings: CouchDbSettings,
): Promise<DeviceSnapshot[]> {
  const baseUrl = buildCouchDbBaseUrl(settings)
  const headers = {
    Authorization: buildBasicAuthHeader(settings),
  }
  const dbName = encodeURIComponent(settings.database)
  const params = new URLSearchParams({
    include_docs: 'true',
    startkey: JSON.stringify('device:'),
    endkey: JSON.stringify('device:\ufff0'),
  })
  const response = await fetch(`${baseUrl}/${dbName}/_all_docs?${params.toString()}`, {
    method: 'GET',
    headers,
  })
  if (!response.ok) {
    const detail = await response.text()
    throw new Error(`CouchDB-Lesen fehlgeschlagen: ${detail}`)
  }
  const payload = (await response.json()) as {
    rows?: Array<{ doc?: DeviceSnapshot & { _id?: string; _rev?: string } }>
  }
  const rows = payload.rows?.map((row) => row.doc).filter(Boolean) ?? []
  rows.forEach((doc) => {
    if (!doc?._id || !doc._rev) {
      return
    }
    deviceRevCache.set(doc._id, doc._rev)
    knownDeviceDocs.add(doc._id)
  })
  return rows.map((doc) => doc as DeviceSnapshot)
}

export async function fetchBrokers(settings: CouchDbSettings): Promise<BrokerConfig[]> {
  const baseUrl = buildCouchDbBaseUrl(settings)
  const headers = {
    Authorization: buildBasicAuthHeader(settings),
  }
  const dbName = encodeURIComponent(settings.database)
  const params = new URLSearchParams({
    include_docs: 'true',
    startkey: '"broker:"',
    endkey: '"broker:\ufff0"',
  })
  const response = await fetch(`${baseUrl}/${dbName}/_all_docs?${params.toString()}`, {
    method: 'GET',
    headers,
  })
  if (!response.ok) {
    const detail = await response.text()
    throw new Error(`CouchDB-Broker lesen fehlgeschlagen: ${detail}`)
  }
  const payload = (await response.json()) as {
    rows?: Array<{ doc?: BrokerConfig & { _id?: string } }>
  }
  return (
    payload.rows
      ?.map((row) => row.doc)
      .filter(Boolean)
      .map((doc) => ({
        id: doc!.id,
        name: doc!.name,
        mqtt: doc!.mqtt,
      })) ?? []
  )
}

export async function upsertBroker(
  settings: CouchDbSettings,
  broker: BrokerConfig,
): Promise<void> {
  const baseUrl = buildCouchDbBaseUrl(settings)
  const headers = {
    Authorization: buildBasicAuthHeader(settings),
    'Content-Type': 'application/json',
  }
  const docId = `broker:${broker.id}`
  const dbName = encodeURIComponent(settings.database)
  const docPath = `${baseUrl}/${dbName}/${encodeURIComponent(docId)}`

  let rev: string | undefined
  const getResponse = await fetch(docPath, { method: 'GET', headers })
  if (getResponse.ok) {
    const existing = (await getResponse.json()) as { _rev?: string }
    rev = existing._rev
  }

  const payload = {
    _id: docId,
    ...(rev ? { _rev: rev } : {}),
    id: broker.id,
    name: broker.name,
    mqtt: broker.mqtt,
    updatedAt: new Date().toISOString(),
  }

  const putResponse = await fetch(docPath, {
    method: 'PUT',
    headers,
    body: JSON.stringify(payload),
  })

  if (!putResponse.ok) {
    const detail = await putResponse.text()
    throw new Error(`CouchDB-Broker speichern fehlgeschlagen: ${detail}`)
  }
}

