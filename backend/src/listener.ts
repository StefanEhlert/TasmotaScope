/**
 * MQTT-Listener: pro Broker ein Client, Nachrichten in Shared-Store, Persist in CouchDB.
 * Startet wenn CouchDB + mind. 1 Broker verfügbar; Rehydration aus CouchDB beim Start.
 */

import mqtt, { type MqttClient } from 'mqtt'
import { createDeviceStore } from 'tasmotascope-shared'
import {
  fetchBrokers,
  fetchDeviceSnapshots,
  type BrokerConfig,
  type CouchDbSettings,
  type DeviceSnapshotForHydrate,
  upsertDeviceSnapshot,
} from './couchDb.js'

function buildMqttUrl(settings: { host: string; port: number; useTls: boolean }): string {
  const protocol = settings.useTls ? 'mqtts' : 'mqtt'
  return `${protocol}://${settings.host}:${settings.port}`
}

let store: ReturnType<typeof createDeviceStore> | null = null
const clientsByBrokerId = new Map<string, MqttClient>()
const deviceConsoleLines = new Map<string, string[]>()
const CONSOLE_MAX_LINES = 30
let currentCouchDb: CouchDbSettings | null = null

function appendConsoleLine(deviceId: string, line: string): void {
  let lines = deviceConsoleLines.get(deviceId)
  if (!lines) {
    lines = []
    deviceConsoleLines.set(deviceId, lines)
  }
  lines.push(line)
  if (lines.length > CONSOLE_MAX_LINES) lines.splice(0, lines.length - CONSOLE_MAX_LINES)
}

export function getDeviceConsoleLines(): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const [deviceId, lines] of deviceConsoleLines) {
    out[deviceId] = [...lines]
  }
  return out
}

function getStore() {
  if (!store) throw new Error('Listener-Store nicht initialisiert')
  return store
}

export function getDeviceStore() {
  return store
}

export async function startListener(couchdb: CouchDbSettings): Promise<void> {
  if (store) {
    stopListener()
  }

  currentCouchDb = couchdb
  store = createDeviceStore()

  store.setPersistFn((snapshot) => {
    if (!currentCouchDb) return Promise.resolve()
    return upsertDeviceSnapshot(currentCouchDb, snapshot)
  })

  const brokers = await fetchBrokers(couchdb)
  if (brokers.length === 0) {
    console.log('[Listener] Keine Broker in CouchDB – Listener bereit, wartet auf Broker.')
    return
  }

  try {
    const snapshots = await fetchDeviceSnapshots(couchdb)
    if (snapshots.length > 0) {
      const hydratePayload: DeviceSnapshotForHydrate[] = snapshots.map((doc) => ({
        deviceId: doc.deviceId,
        brokerId: doc.brokerId,
        lastSeen: doc.lastSeen,
        online: doc.online,
        topic: doc.topic,
        fields: doc.fields ?? {},
        raw: doc.raw,
        backups: doc.backups,
        autoBackupIntervalDays: doc.autoBackupIntervalDays,
        settingsUi: doc.settingsUi,
      }))
      store.hydrateFromSnapshots(hydratePayload)
      console.log(`[Listener] Rehydration: ${snapshots.length} Geräte aus CouchDB geladen.`)
    }
  } catch (err) {
    console.error('[Listener] Rehydration fehlgeschlagen:', err)
  }

  store.setCommandSender((deviceId, topic, payload) => {
    const device = store!.getDevice(deviceId)
    const brokerId = device?.brokerId
    if (!brokerId) return
    const client = clientsByBrokerId.get(brokerId)
    if (client?.connected) {
      client.publish(topic, payload)
    }
  })

  for (const broker of brokers) {
    connectBroker(broker)
  }

  console.log(`[Listener] ${brokers.length} Broker verbunden.`)
}

function connectBroker(broker: BrokerConfig) {
  const brokerId = broker.id
  if (clientsByBrokerId.has(brokerId)) {
    const existing = clientsByBrokerId.get(brokerId)
    existing?.end(true)
    clientsByBrokerId.delete(brokerId)
  }

  const url = buildMqttUrl(broker.mqtt)
  const client = mqtt.connect(url, {
    username: broker.mqtt.username || undefined,
    password: broker.mqtt.password || undefined,
    clientId: broker.mqtt.clientId || `tasmotascope-backend-${brokerId.slice(0, 8)}-${Date.now().toString(36)}`,
    clean: true,
    keepalive: 30,
    reconnectPeriod: 2000,
    connectTimeout: 5000,
  })

  clientsByBrokerId.set(brokerId, client)

  client.on('connect', () => {
    client.subscribe('#', (err) => {
      if (err) console.error(`[Listener] Broker ${broker.name} Subscribe-Fehler:`, err)
    })
  })

  client.on('message', (topic, payload) => {
    const parts = topic.split('/')
    if (parts.length < 3) return
    const scope = parts[0]
    const type = parts[parts.length - 1]
    const rawDeviceId = parts.slice(1, -1).join('/')
    if (scope === 'discovery') return

    const deviceId = rawDeviceId
    const text = payload.toString()
    const line = `${topic} ${text.length > 200 ? text.slice(0, 200) + '…' : text}`
    appendConsoleLine(deviceId, line)
    const s = getStore()

    if (type === 'LWT') {
      const isOnline = text.toLowerCase() === 'online'
      s.setOnline(deviceId, isOnline, brokerId)
      return
    }

    let data: Record<string, unknown> | null = null
    try {
      data = JSON.parse(text) as Record<string, unknown>
    } catch {
      data = null
    }
    if (!data) {
      if (/^POWER\d*$/i.test(type)) {
        const n = text.trim().toUpperCase()
        if (n === 'ON' || n === 'OFF') data = { [type]: n }
      } else if (/^(VAR|MEM|RULETIMER)\d+$/i.test(type)) {
        data = { [type]: text.trim() }
      }
    }
    if (!data) return

    if (scope === 'tele' || scope === 'stat') {
      s.ingestMessage({ deviceId, scope, type, payload: data, brokerId })
    }
  })

  client.on('error', (err) => {
    console.error(`[Listener] Broker ${broker.name} Fehler:`, err.message)
  })
}

export function stopListener(): void {
  for (const client of clientsByBrokerId.values()) {
    client.end(true)
  }
  clientsByBrokerId.clear()
  store?.setPersistFn(null)
  store?.setCommandSender(null)
  store = null
  currentCouchDb = null
  deviceConsoleLines.clear()
  console.log('[Listener] Beendet.')
}

export function getBrokerConnectionStatus(): Record<string, 'connected' | 'disconnected'> {
  const out: Record<string, 'connected' | 'disconnected'> = {}
  for (const [brokerId, client] of clientsByBrokerId) {
    out[brokerId] = client.connected ? 'connected' : 'disconnected'
  }
  return out
}

/** Sendet einen MQTT-Befehl für ein Gerät (für POST /api/command). */
export function publishCommand(deviceId: string, topic: string, payload: string): boolean {
  const s = store
  if (!s) return false
  const device = s.getDevice(deviceId)
  const brokerId = device?.brokerId
  if (!brokerId) return false
  const client = clientsByBrokerId.get(brokerId)
  if (!client?.connected) return false
  client.publish(topic, payload)
  return true
}
