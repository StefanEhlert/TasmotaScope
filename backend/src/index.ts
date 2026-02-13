import express, { Request, Response } from 'express'
import cors from 'cors'
import { Router } from 'express'
import { backupRouter, runScheduledAutoBackups } from './backup.js'
import {
  createBroker,
  deleteBrokerAndDevices,
  ensureCouchDbInitialized,
  fetchBrokers,
  updateBroker,
  type BrokerConfig,
} from './couchDb.js'
import {
  getBrokerConnectionStatus,
  getDeviceConsoleLines,
  getDeviceStore,
  publishCommand,
  startListener,
} from './listener.js'

const app = express()
const PORT = process.env.PORT || 3001

export type CouchDbSettings = {
  host: string
  port: number
  useTls: boolean
  username: string
  password: string
  database: string
}

/**
 * CouchDB aus Umgebungsvariablen.
 * Optionale Variablen: COUCHDB_HOST, COUCHDB_DATABASE, COUCHDB_PORT (default 5984),
 * COUCHDB_SECURE (1/true), COUCHDB_USER, COUCHDB_PASSWORD.
 */
function getCouchDbFromEnv(): CouchDbSettings | null {
  const host = process.env.COUCHDB_HOST
  const database = process.env.COUCHDB_DATABASE
  if (!host || !database) return null
  const port = parseInt(process.env.COUCHDB_PORT ?? '5984', 10)
  const useTls = process.env.COUCHDB_SECURE === '1' || process.env.COUCHDB_SECURE === 'true'
  const username = process.env.COUCHDB_USER ?? ''
  const password = process.env.COUCHDB_PASSWORD ?? ''
  return { host, port, useTls, username, password, database }
}

/** In-Memory-Override vom Frontend (POST /api/config/couchdb). Nach Neustart gilt wieder Env. */
let couchdbConfigOverride: CouchDbSettings | null = null

/** Aktive CouchDB-Konfiguration: zuerst Override, sonst Env. */
export function getCouchDb(): CouchDbSettings | null {
  return couchdbConfigOverride ?? getCouchDbFromEnv()
}

function buildCouchDbBaseUrl(settings: CouchDbSettings): string {
  const protocol = settings.useTls ? 'https' : 'http'
  return `${protocol}://${settings.host}:${settings.port}`
}

async function testCouchDbConnection(settings: CouchDbSettings): Promise<boolean> {
  const baseUrl = buildCouchDbBaseUrl(settings)
  const token = Buffer.from(`${settings.username}:${settings.password}`).toString('base64')
  try {
    const res = await fetch(`${baseUrl}/_up`, {
      method: 'GET',
      headers: { Authorization: `Basic ${token}` },
      signal: AbortSignal.timeout(5000),
    })
    return res.ok
  } catch {
    return false
  }
}

const statusRouter = Router()

statusRouter.get('/status', async (_req: Request, res: Response) => {
  const couchdb = getCouchDb()
  const brokers = getBrokerConnectionStatus()
  if (!couchdb) {
    res.json({ couchdb: false, brokers })
    return
  }
  const ok = await testCouchDbConnection(couchdb)
  res.json({ couchdb: ok, brokers })
})

function devicesWithConsole(): Record<string, Record<string, unknown>> {
  const store = getDeviceStore()
  const consoles = getDeviceConsoleLines()
  if (!store) return {}
  const snapshot = store.getSnapshot()
  const map = store.getDevicesMap()
  const out: Record<string, Record<string, unknown>> = {}
  for (const [id, info] of Object.entries(snapshot)) {
    const record = map.get(id)
    const base = typeof info === 'object' && info !== null ? { ...info } : {}
    out[id] = {
      ...base,
      console: consoles[id] ?? [],
      ...(record ? { raw: record.raw, rules: record.rules } : {}),
    }
  }
  return out
}

statusRouter.get('/devices', (_req: Request, res: Response) => {
  res.json(devicesWithConsole())
})

statusRouter.post('/command', (req: Request, res: Response) => {
  const body = req.body as { deviceId?: unknown; topic?: unknown; payload?: unknown }
  const deviceId = typeof body.deviceId === 'string' ? body.deviceId.trim() : ''
  const topic = typeof body.topic === 'string' ? body.topic.trim() : ''
  const payload = typeof body.payload === 'string' ? body.payload : String(body.payload ?? '')
  if (!deviceId || !topic) {
    res.status(400).json({ error: 'deviceId und topic erforderlich' })
    return
  }
  const ok = publishCommand(deviceId, topic, payload)
  if (!ok) {
    res.status(503).json({ error: 'Listener nicht aktiv oder Gerät/Broker nicht verbunden' })
    return
  }
  res.json({ ok: true })
})

const sseClients = new Set<{ res: Response; unsubscribe: () => void }>()

statusRouter.get('/devices/stream', (_req: Request, res: Response) => {
  const store = getDeviceStore()
  if (!store) {
    res.status(503).json({ error: 'Listener nicht aktiv' })
    return
  }
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders?.()

  const sendSnapshot = () => {
    try {
      const payload = `data: ${JSON.stringify(devicesWithConsole())}\n\n`
      res.write(payload)
      const sock = (res as unknown as { socket?: { flush?: () => void } }).socket
      if (sock?.flush) sock.flush()
    } catch {
      // Client evtl. getrennt
    }
  }

  sendSnapshot()
  const unsubscribe = store.subscribe(sendSnapshot)
  sseClients.add({ res, unsubscribe })

  res.on('close', () => {
    unsubscribe()
    for (const c of sseClients) {
      if (c.res === res) {
        sseClients.delete(c)
        break
      }
    }
  })
})

statusRouter.get('/brokers', async (_req: Request, res: Response) => {
  const couchdb = getCouchDb()
  if (!couchdb) {
    res.json([])
    return
  }
  try {
    const list = await fetchBrokers(couchdb)
    res.json(list)
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Broker-Liste laden fehlgeschlagen' })
  }
})

statusRouter.post('/brokers', async (req: Request, res: Response) => {
  const couchdb = getCouchDb()
  if (!couchdb) {
    res.status(503).json({ error: 'CouchDB nicht konfiguriert' })
    return
  }
  const body = req.body as Partial<BrokerConfig> & { mqtt?: Partial<BrokerConfig['mqtt']> }
  const id = typeof body.id === 'string' ? body.id.trim() || 'default' : 'default'
  const name = typeof body.name === 'string' ? body.name.trim() : id
  const mqtt = body.mqtt && typeof body.mqtt === 'object'
    ? {
        host: typeof body.mqtt.host === 'string' ? body.mqtt.host : '',
        port: typeof body.mqtt.port === 'number' ? body.mqtt.port : 1883,
        wsPort: typeof body.mqtt.wsPort === 'number' ? body.mqtt.wsPort : undefined,
        useTls: Boolean(body.mqtt.useTls),
        username: typeof body.mqtt.username === 'string' ? body.mqtt.username : '',
        password: typeof body.mqtt.password === 'string' ? body.mqtt.password : '',
        clientId: typeof body.mqtt.clientId === 'string' ? body.mqtt.clientId : undefined,
        path: typeof body.mqtt.path === 'string' ? body.mqtt.path : '/',
      }
    : { host: '', port: 1883, useTls: false, username: '', password: '', path: '/' }
  try {
    await createBroker(couchdb, { id, name, mqtt })
    await startListener(couchdb)
    res.status(201).json({ id, name, mqtt })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Broker anlegen fehlgeschlagen' })
  }
})

statusRouter.put('/brokers/:id', async (req: Request, res: Response) => {
  const couchdb = getCouchDb()
  if (!couchdb) {
    res.status(503).json({ error: 'CouchDB nicht konfiguriert' })
    return
  }
  const brokerId = req.params.id
  const body = req.body as Partial<Pick<BrokerConfig, 'name' | 'mqtt'>>
  const patch: Partial<Pick<BrokerConfig, 'name' | 'mqtt'>> = {}
  if (typeof body?.name === 'string') patch.name = body.name.trim()
  if (body?.mqtt && typeof body.mqtt === 'object') {
    patch.mqtt = {
      host: typeof body.mqtt.host === 'string' ? body.mqtt.host : '',
      port: typeof body.mqtt.port === 'number' ? body.mqtt.port : 1883,
      wsPort: typeof body.mqtt.wsPort === 'number' ? body.mqtt.wsPort : undefined,
      useTls: Boolean(body.mqtt.useTls),
      username: typeof body.mqtt.username === 'string' ? body.mqtt.username : '',
      password: typeof body.mqtt.password === 'string' ? body.mqtt.password : '',
      clientId: typeof body.mqtt.clientId === 'string' ? body.mqtt.clientId : undefined,
      path: typeof body.mqtt.path === 'string' ? body.mqtt.path : '/',
    }
  }
  try {
    await updateBroker(couchdb, brokerId, patch)
    await startListener(couchdb)
    res.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Broker aktualisieren fehlgeschlagen'
    res.status(err instanceof Error && msg.includes('nicht gefunden') ? 404 : 500).json({ error: msg })
  }
})

statusRouter.delete('/brokers/:id', async (req: Request, res: Response) => {
  const couchdb = getCouchDb()
  if (!couchdb) {
    res.status(503).json({ error: 'CouchDB nicht konfiguriert' })
    return
  }
  const brokerId = req.params.id
  try {
    await deleteBrokerAndDevices(couchdb, brokerId)
    await startListener(couchdb)
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Broker löschen fehlgeschlagen' })
  }
})

statusRouter.post('/config/couchdb', (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>
  const host = typeof body.host === 'string' ? body.host.trim() : ''
  const database = typeof body.database === 'string' ? body.database.trim() : ''
  if (!host || !database) {
    res.status(400).json({ error: 'host und database erforderlich' })
    return
  }
  const port = typeof body.port === 'number' ? body.port : parseInt(String(body.port ?? 5984), 10)
  const useTls = body.useTls === true || body.useTls === 'true' || body.useTls === 1
  const username = typeof body.username === 'string' ? body.username : ''
  const password = typeof body.password === 'string' ? body.password : ''
  couchdbConfigOverride = { host, port, useTls, username, password, database }
  const couchdb = getCouchDb()
  if (couchdb) {
    ensureCouchDbInitialized(couchdb)
      .then(() => startListener(couchdb))
      .catch((err) => console.error('[Listener] Start fehlgeschlagen:', err))
  }
  res.json({ ok: true })
})

app.use(cors())
app.use(express.json({ limit: '1mb' }))
app.use('/api', statusRouter)
app.use('/api', backupRouter)

const AUTO_BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000 // 24 Stunden

app.listen(PORT, () => {
  console.log(`TasmotaScope Backend listening on port ${PORT}`)

  const couchdb = getCouchDb()
  if (couchdb) {
    ensureCouchDbInitialized(couchdb)
      .then(() => startListener(couchdb))
      .catch((err) => console.error('[Listener] Start fehlgeschlagen:', err))
    const run = () => {
      const c = getCouchDb()
      if (!c) return
      runScheduledAutoBackups(c).catch((err) => {
        console.error('[Auto-Backup] Scheduler-Fehler:', err)
      })
    }
    setTimeout(run, 60_000)
    setInterval(run, AUTO_BACKUP_INTERVAL_MS)
    console.log('Auto-Backup-Scheduler aktiv (alle 24 h)')
  } else {
    console.log('Auto-Backup-Scheduler inaktiv (COUCHDB_HOST und COUCHDB_DATABASE nicht gesetzt)')
  }
})
