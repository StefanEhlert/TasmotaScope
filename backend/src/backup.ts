import { Router } from 'express'

const MAX_BACKUPS_PER_DEVICE = 10

type CouchDbSettings = {
  host: string
  port: number
  useTls: boolean
  username: string
  password: string
  database: string
}

type DeviceBackupItem = {
  data: string
  createdAt: string
}

type DeviceBackups = {
  count: number
  lastAt: string | null
  items: DeviceBackupItem[]
}

type DeviceDoc = {
  _id: string
  _rev?: string
  deviceId: string
  brokerId?: string
  lastSeen?: string
  online?: boolean
  topic?: string
  fields?: { ip?: string; [key: string]: unknown }
  raw?: Record<string, unknown>
  backups?: DeviceBackups
  autoBackupIntervalDays?: number | null
  updatedAt?: string
}

function buildCouchDbBaseUrl(settings: CouchDbSettings): string {
  const protocol = settings.useTls ? 'https' : 'http'
  return `${protocol}://${settings.host}:${settings.port}`
}

function buildBasicAuthHeader(settings: CouchDbSettings): string {
  const token = Buffer.from(`${settings.username}:${settings.password}`).toString('base64')
  return `Basic ${token}`
}

function normalizeBrokerId(brokerId?: string): string {
  const value = brokerId?.trim()
  return value && value.length > 0 ? value : 'default'
}

export const backupRouter = Router()

backupRouter.get('/health', (_req, res) => {
  res.json({ ok: true })
})

/** Führt ein Backup für ein Gerät durch (Tasmota /dl abrufen, in CouchDB speichern). */
export async function performBackup(
  couchdb: CouchDbSettings,
  params: { host: string; deviceId: string; brokerId?: string },
): Promise<{ lastTimestamp: string | null; count: number; items: DeviceBackupItem[] }> {
  const { host, deviceId, brokerId } = params
  const tasmotaUrl = `http://${host.replace(/^https?:\/\//, '')}/dl`
  const response = await fetch(tasmotaUrl, {
    signal: AbortSignal.timeout(10000),
  })

  if (!response.ok) {
    throw new Error(`Tasmota-Gerät nicht erreichbar: ${response.status} ${response.statusText}`)
  }

  const buffer = await response.arrayBuffer()
  const base64 = Buffer.from(buffer).toString('base64')
  const createdAt = new Date().toISOString()
  const brokerIdNorm = normalizeBrokerId(brokerId)
  const baseUrl = buildCouchDbBaseUrl(couchdb)
  const headers: Record<string, string> = {
    Authorization: buildBasicAuthHeader(couchdb),
    'Content-Type': 'application/json',
  }
  const dbName = encodeURIComponent(couchdb.database)
  const docId = `device:${brokerIdNorm}:${deviceId}`
  const docPath = `${baseUrl}/${dbName}/${encodeURIComponent(docId)}`

  let existing: DeviceDoc | null = null
  const getRes = await fetch(docPath, { method: 'GET', headers })
  if (getRes.ok) {
    existing = (await getRes.json()) as DeviceDoc
  }

  const currentBackups: DeviceBackups = existing?.backups ?? {
    count: 0,
    lastAt: null,
    items: [],
  }
  const newItem: DeviceBackupItem = { data: base64, createdAt }
  const items = [newItem, ...currentBackups.items].slice(0, MAX_BACKUPS_PER_DEVICE)
  const backups: DeviceBackups = {
    count: items.length,
    lastAt: items[0]?.createdAt ?? null,
    items,
  }

  const doc: DeviceDoc = existing
    ? {
        ...existing,
        backups,
        updatedAt: new Date().toISOString(),
      }
    : {
        _id: docId,
        deviceId,
        brokerId: brokerIdNorm,
        backups,
        lastSeen: new Date().toISOString(),
        topic: deviceId,
        fields: {},
        raw: {},
        updatedAt: new Date().toISOString(),
      }

  const putRes = await fetch(docPath, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      ...doc,
      ...(existing?._rev ? { _rev: existing._rev } : {}),
    }),
  })

  if (!putRes.ok) {
    const detail = await putRes.text()
    throw new Error(`CouchDB-Speichern fehlgeschlagen: ${detail}`)
  }

  return { lastTimestamp: backups.lastAt, count: backups.count, items: backups.items }
}

backupRouter.post('/backup', async (req, res) => {
  try {
    const { host, deviceId, brokerId, couchdb } = req.body as {
      host?: string
      deviceId?: string
      brokerId?: string
      couchdb?: CouchDbSettings
    }

    if (!host || !deviceId || !couchdb) {
      res.status(400).json({ error: 'host, deviceId und couchdb sind erforderlich' })
      return
    }

    const result = await performBackup(couchdb, { host, deviceId, brokerId })
    const { getDeviceStore } = await import('./listener.js')
    const store = getDeviceStore()
    if (store) {
      store.updateInfo(deviceId, {
        backupCount: result.count,
        backupItems: result.items.map((item: DeviceBackupItem) => ({ createdAt: item.createdAt, data: item.data })),
        daysSinceBackup: 0,
      })
    }
    res.json({ ok: true, lastTimestamp: result.lastTimestamp, count: result.count })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unbekannter Fehler'
    res.status(500).json({ error: `Backup fehlgeschlagen: ${message}` })
  }
})

backupRouter.post('/backup/delete', async (req, res) => {
  try {
    const { deviceId, brokerId, couchdb, index } = req.body as {
      deviceId?: string
      brokerId?: string
      couchdb?: CouchDbSettings
      index?: number
    }

    if (!deviceId || !couchdb || typeof index !== 'number' || index < 0) {
      res.status(400).json({
        error: 'deviceId, couchdb und index (Nummer) sind erforderlich',
      })
      return
    }

    const brokerIdNorm = normalizeBrokerId(brokerId)
    const baseUrl = buildCouchDbBaseUrl(couchdb)
    const headers: Record<string, string> = {
      Authorization: buildBasicAuthHeader(couchdb),
      'Content-Type': 'application/json',
    }
    const dbName = encodeURIComponent(couchdb.database)
    const docId = `device:${brokerIdNorm}:${deviceId}`
    const docPath = `${baseUrl}/${dbName}/${encodeURIComponent(docId)}`

    const getRes = await fetch(docPath, { method: 'GET', headers })
    if (!getRes.ok) {
      res.status(502).json({ error: 'Geräte-Dokument nicht gefunden' })
      return
    }

    const existing = (await getRes.json()) as DeviceDoc
    const currentBackups = existing?.backups ?? {
      count: 0,
      lastAt: null,
      items: [],
    }
    const items = [...currentBackups.items]
    if (index >= items.length) {
      res.status(400).json({ error: 'Ungültiger Backup-Index' })
      return
    }
    items.splice(index, 1)
    const backups: DeviceBackups = {
      count: items.length,
      lastAt: items[0]?.createdAt ?? null,
      items,
    }

    const doc: DeviceDoc = {
      ...existing,
      backups,
      updatedAt: new Date().toISOString(),
    }

    const putRes = await fetch(docPath, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        ...doc,
        ...(existing._rev ? { _rev: existing._rev } : {}),
      }),
    })

    if (!putRes.ok) {
      const detail = await putRes.text()
      res.status(500).json({ error: `CouchDB-Update fehlgeschlagen: ${detail}` })
      return
    }

    const { getDeviceStore } = await import('./listener.js')
    const store = getDeviceStore()
    if (store) {
      store.updateInfo(deviceId, {
        backupCount: backups.count,
        backupItems: backups.items.map((item: DeviceBackupItem) => ({ createdAt: item.createdAt, data: item.data })),
        daysSinceBackup: backups.items[0]?.createdAt
          ? Math.floor((Date.now() - new Date(backups.items[0].createdAt).getTime()) / 86400000)
          : undefined,
      })
    }

    res.json({ ok: true, count: backups.count, lastAt: backups.lastAt })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unbekannter Fehler'
    res.status(500).json({ error: `Backup löschen fehlgeschlagen: ${message}` })
  }
})

/** Liest alle Geräte-Dokumente aus CouchDB. */
async function fetchDeviceDocs(
  couchdb: CouchDbSettings,
): Promise<DeviceDoc[]> {
  const baseUrl = buildCouchDbBaseUrl(couchdb)
  const headers: Record<string, string> = {
    Authorization: buildBasicAuthHeader(couchdb),
  }
  const dbName = encodeURIComponent(couchdb.database)
  const params = new URLSearchParams({
    include_docs: 'true',
    startkey: JSON.stringify('device:'),
    endkey: JSON.stringify('device:\ufff0'),
  })
  const res = await fetch(`${baseUrl}/${dbName}/_all_docs?${params.toString()}`, {
    method: 'GET',
    headers,
  })
  if (!res.ok) {
    throw new Error(`CouchDB-Abfrage fehlgeschlagen: ${res.status}`)
  }
  const data = (await res.json()) as { rows?: Array<{ doc?: DeviceDoc }> }
  const rows = data.rows ?? []
  return rows.map((r) => r.doc).filter((doc): doc is DeviceDoc => doc != null)
}

/** Führt geplante Auto-Backups für alle fälligen Geräte aus (eine CouchDB-Instanz). */
export async function runScheduledAutoBackups(couchdb: CouchDbSettings): Promise<void> {
  const docs = await fetchDeviceDocs(couchdb)
  const now = Date.now()
  const oneDayMs = 24 * 60 * 60 * 1000

  for (const doc of docs) {
    const intervalDays = doc.autoBackupIntervalDays
    if (intervalDays == null || intervalDays < 1) continue

    const ip = doc.fields?.ip
    if (typeof ip !== 'string' || !ip.trim()) continue

    const lastAt = doc.backups?.lastAt ?? null
    const daysSinceBackup =
      lastAt == null
        ? null
        : Math.floor((now - new Date(lastAt).getTime()) / oneDayMs)
    const due =
      daysSinceBackup == null || daysSinceBackup >= intervalDays

    if (!due) continue

    try {
      await performBackup(couchdb, {
        host: ip.trim(),
        deviceId: doc.deviceId,
        brokerId: doc.brokerId,
      })
      console.log(`[Auto-Backup] ${doc.deviceId}: Backup erstellt`)
    } catch (err) {
      console.error(`[Auto-Backup] ${doc.deviceId}:`, err instanceof Error ? err.message : err)
    }
  }
}
