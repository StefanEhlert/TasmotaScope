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
  fields?: Record<string, unknown>
  raw?: Record<string, unknown>
  backups?: DeviceBackups
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

    const tasmotaUrl = `http://${host.replace(/^https?:\/\//, '')}/dl`
    const response = await fetch(tasmotaUrl, {
      signal: AbortSignal.timeout(10000),
    })

    if (!response.ok) {
      res.status(502).json({
        error: `Tasmota-Gerät nicht erreichbar: ${response.status} ${response.statusText}`,
      })
      return
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
      res.status(500).json({ error: `CouchDB-Speichern fehlgeschlagen: ${detail}` })
      return
    }

    res.json({
      ok: true,
      lastTimestamp: backups.lastAt,
      count: backups.count,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unbekannter Fehler'
    res.status(500).json({ error: `Backup fehlgeschlagen: ${message}` })
  }
})
