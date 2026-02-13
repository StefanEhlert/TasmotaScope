/**
 * CouchDB-Helfer für Listener: Broker laden, Device-Snapshots schreiben.
 * Dokumentformat kompatibel mit dem Frontend.
 */

export type CouchDbSettings = {
  host: string
  port: number
  useTls: boolean
  username: string
  password: string
  database: string
}

export type MqttSettings = {
  host: string
  port: number
  wsPort?: number
  useTls: boolean
  username: string
  password: string
  clientId?: string
  path: string
}

export type BrokerConfig = {
  id: string
  name: string
  mqtt: MqttSettings
}

export type DeviceSettingsUi = {
  consoleExpanded?: boolean
  collapsedBlockIds?: string[]
}

export type PersistSnapshot = {
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
  autoBackupIntervalDays?: number | null
  settingsUi?: DeviceSettingsUi
}

type DeviceBackups = {
  count: number
  lastAt: string | null
  items: { data: string; createdAt: string }[]
}

function buildBaseUrl(settings: CouchDbSettings): string {
  const protocol = settings.useTls ? 'https' : 'http'
  return `${protocol}://${settings.host}:${settings.port}`
}

function buildAuthHeader(settings: CouchDbSettings): string {
  const token = Buffer.from(`${settings.username}:${settings.password}`).toString('base64')
  return `Basic ${token}`
}

function normalizeBrokerId(brokerId?: string): string {
  const value = brokerId?.trim()
  return value && value.length > 0 ? value : 'default'
}

const deviceRevCache = new Map<string, string>()

export async function fetchBrokers(settings: CouchDbSettings): Promise<BrokerConfig[]> {
  const baseUrl = buildBaseUrl(settings)
  const headers = { Authorization: buildAuthHeader(settings) }
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
        id: doc!.id ?? (doc as { _id?: string })._id?.replace(/^broker:/, '') ?? '',
        name: doc!.name,
        mqtt: doc!.mqtt,
      })) ?? []
  )
}

function brokerDocId(brokerId: string): string {
  return `broker:${brokerId}`
}

export async function createBroker(
  settings: CouchDbSettings,
  config: BrokerConfig
): Promise<void> {
  const baseUrl = buildBaseUrl(settings)
  const headers = {
    Authorization: buildAuthHeader(settings),
    'Content-Type': 'application/json',
  }
  const dbName = encodeURIComponent(settings.database)
  const id = (config.id ?? '').trim() || 'default'
  const docId = brokerDocId(id)
  const doc = {
    _id: docId,
    id,
    name: config.name ?? id,
    mqtt: config.mqtt ?? {
      host: '',
      port: 1883,
      useTls: false,
      username: '',
      password: '',
      path: '/',
    },
  }
  const res = await fetch(`${baseUrl}/${dbName}/${encodeURIComponent(docId)}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(doc),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`CouchDB Broker anlegen fehlgeschlagen: ${text}`)
  }
}

export async function updateBroker(
  settings: CouchDbSettings,
  brokerId: string,
  patch: Partial<Pick<BrokerConfig, 'name' | 'mqtt'>>
): Promise<void> {
  const baseUrl = buildBaseUrl(settings)
  const headers = {
    Authorization: buildAuthHeader(settings),
    'Content-Type': 'application/json',
  }
  const dbName = encodeURIComponent(settings.database)
  const docId = brokerDocId(brokerId)
  const getRes = await fetch(`${baseUrl}/${dbName}/${encodeURIComponent(docId)}`, {
    method: 'GET',
    headers,
  })
  if (!getRes.ok) {
    if (getRes.status === 404) throw new Error(`Broker nicht gefunden: ${brokerId}`)
    throw new Error(`CouchDB Broker lesen fehlgeschlagen: ${await getRes.text()}`)
  }
  const existing = (await getRes.json()) as BrokerConfig & { _id?: string; _rev?: string }
  const updated = {
    ...existing,
    name: patch.name ?? existing.name,
    mqtt: patch.mqtt ?? existing.mqtt,
  }
  const putRes = await fetch(`${baseUrl}/${dbName}/${encodeURIComponent(docId)}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      _id: docId,
      _rev: existing._rev,
      id: existing.id ?? brokerId,
      name: updated.name,
      mqtt: updated.mqtt,
    }),
  })
  if (!putRes.ok) {
    throw new Error(`CouchDB Broker aktualisieren fehlgeschlagen: ${await putRes.text()}`)
  }
}

/** Löscht Broker-Dokument und alle Geräte-Docs dieses Brokers. */
export async function deleteBrokerAndDevices(
  settings: CouchDbSettings,
  brokerId: string
): Promise<void> {
  const baseUrl = buildBaseUrl(settings)
  const headers = {
    Authorization: buildAuthHeader(settings),
    'Content-Type': 'application/json',
  }
  const dbName = encodeURIComponent(settings.database)
  const normId = normalizeBrokerId(brokerId)
  const params = new URLSearchParams({
    include_docs: 'true',
    startkey: JSON.stringify(`device:${normId}:`),
    endkey: JSON.stringify(`device:${normId}:\ufff0`),
  })
  const listRes = await fetch(`${baseUrl}/${dbName}/_all_docs?${params.toString()}`, {
    method: 'GET',
    headers,
  })
  if (!listRes.ok) {
    throw new Error(`CouchDB Geräte auflisten fehlgeschlagen: ${await listRes.text()}`)
  }
  const listPayload = (await listRes.json()) as {
    rows?: Array<{ id: string; value: { rev: string }; doc?: { _rev?: string } }>
  }
  const toDelete: { _id: string; _rev: string; _deleted: boolean }[] = []
  for (const row of listPayload.rows ?? []) {
    const rev = row.value?.rev ?? row.doc?._rev
    if (rev) toDelete.push({ _id: row.id, _rev: rev, _deleted: true })
  }
  if (toDelete.length > 0) {
    const bulkRes = await fetch(`${baseUrl}/${dbName}/_bulk_docs`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ docs: toDelete }),
    })
    if (!bulkRes.ok) {
      throw new Error(`CouchDB Geräte löschen fehlgeschlagen: ${await bulkRes.text()}`)
    }
    for (const d of toDelete) deviceRevCache.delete(d._id)
  }
  const brokerDocIdStr = brokerDocId(normId)
  const getBroker = await fetch(`${baseUrl}/${dbName}/${encodeURIComponent(brokerDocIdStr)}`, {
    method: 'GET',
    headers,
  })
  if (getBroker.ok) {
    const brokerDoc = (await getBroker.json()) as { _rev?: string }
    const delRes = await fetch(`${baseUrl}/${dbName}/${encodeURIComponent(brokerDocIdStr)}?rev=${brokerDoc._rev ?? ''}`, {
      method: 'DELETE',
      headers,
    })
    if (!delRes.ok) {
      throw new Error(`CouchDB Broker löschen fehlgeschlagen: ${await delRes.text()}`)
    }
  }
}

export async function upsertDeviceSnapshot(
  settings: CouchDbSettings,
  snapshot: PersistSnapshot
): Promise<void> {
  const baseUrl = buildBaseUrl(settings)
  const headers = {
    Authorization: buildAuthHeader(settings),
    'Content-Type': 'application/json',
  }
  const brokerId = normalizeBrokerId(snapshot.brokerId)
  const docId = `device:${brokerId}:${snapshot.deviceId}`
  const dbName = encodeURIComponent(settings.database)
  const docPath = `${baseUrl}/${dbName}/${encodeURIComponent(docId)}`

  let rev = deviceRevCache.get(docId)
  let existingBackups: DeviceBackups | undefined
  let existingSettingsUi: DeviceSettingsUi | undefined
  let existingAutoBackupIntervalDays: number | null | undefined

  const getResponse = await fetch(docPath, { method: 'GET', headers })
  if (getResponse.ok) {
    const existing = (await getResponse.json()) as {
      _rev?: string
      backups?: DeviceBackups
      settingsUi?: DeviceSettingsUi
      autoBackupIntervalDays?: number | null
    }
    rev = existing._rev
    existingBackups = existing.backups
    existingSettingsUi = existing.settingsUi
    existingAutoBackupIntervalDays = existing.autoBackupIntervalDays
    if (rev) deviceRevCache.set(docId, rev)
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
    ...((snapshot.autoBackupIntervalDays !== undefined || existingAutoBackupIntervalDays !== undefined)
      ? { autoBackupIntervalDays: snapshot.autoBackupIntervalDays ?? existingAutoBackupIntervalDays ?? null }
      : {}),
  }

  const putResponse = await fetch(docPath, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ ...payload, ...(rev ? { _rev: rev } : {}) }),
  })

  if (putResponse.ok) {
    const result = (await putResponse.json()) as { rev?: string }
    if (result.rev) deviceRevCache.set(docId, result.rev)
    return
  }

  if (putResponse.status !== 409) {
    const detail = await putResponse.text()
    throw new Error(`CouchDB-Speichern fehlgeschlagen: ${detail}`)
  }

  const retryGet = await fetch(docPath, { method: 'GET', headers })
  if (!retryGet.ok) {
    const detail = await retryGet.text()
    throw new Error(`CouchDB-Speichern fehlgeschlagen: ${detail}`)
  }
  const existing = (await retryGet.json()) as { _rev?: string; backups?: DeviceBackups }
  rev = existing._rev
  const retryPayload = {
    ...payload,
    ...(existing.backups ? { backups: existing.backups } : {}),
    ...(rev ? { _rev: rev } : {}),
  }
  const retryPut = await fetch(docPath, { method: 'PUT', headers, body: JSON.stringify(retryPayload) })
  if (!retryPut.ok) {
    const detail = await retryPut.text()
    throw new Error(`CouchDB-Speichern fehlgeschlagen: ${detail}`)
  }
  const retryResult = (await retryPut.json()) as { rev?: string }
  if (retryResult.rev) deviceRevCache.set(docId, retryResult.rev)
}

/** Für Rehydration: alle Geräte-Docs aus CouchDB laden. */
export type DeviceSnapshotForHydrate = {
  deviceId: string
  brokerId?: string
  lastSeen?: string
  online?: boolean
  topic?: string
  fields: { name?: string; ip?: string; firmware?: string; module?: string; uptime?: string; signal?: number }
  raw?: Record<string, unknown>
  backups?: { count: number; lastAt: string | null; items?: unknown[] }
  autoBackupIntervalDays?: number | null
  settingsUi?: DeviceSettingsUi
}

export async function fetchDeviceSnapshots(
  settings: CouchDbSettings
): Promise<DeviceSnapshotForHydrate[]> {
  const baseUrl = buildBaseUrl(settings)
  const headers = { Authorization: buildAuthHeader(settings) }
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
    throw new Error(`CouchDB-Geräte lesen fehlgeschlagen: ${detail}`)
  }
  const payload = (await response.json()) as {
    rows?: Array<{ doc?: DeviceSnapshotForHydrate & { _id?: string; _rev?: string } }>
  }
  const rows = payload.rows?.map((row) => row.doc).filter(Boolean) ?? []
  return rows as DeviceSnapshotForHydrate[]
}
