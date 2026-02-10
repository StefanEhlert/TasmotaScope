import { useEffect, useMemo, useRef, useState } from 'react'
import type { MqttClient } from 'mqtt'
import BrokerModal from './components/BrokerModal'
import ConfigModal, { type ConnectionResult } from './components/ConfigModal'
import DeviceList from './components/DeviceList'
import DeviceSettingsPage from './components/DeviceSettingsPage'
import RulesPage from './components/RulesPage'
import { DeviceState } from './DeviceState'
import {
  fetchBrokers,
  fetchDeviceSnapshots,
  testCouchDbConnection,
  upsertBroker,
  upsertDeviceSnapshot,
} from './lib/couchDb'
import { requestBackup } from './lib/backendClient'
import { createMqttClient, testMqttConnection } from './lib/mqttClient'
import {
  defaultSettings,
  loadActiveBrokerId,
  loadSettings,
  saveActiveBrokerId,
  saveSettings,
} from './lib/storage'
import type { AppSettings, BrokerConfig, DeviceInfo, MqttSettings } from './lib/types'
import { useBackendAvailable } from './hooks/useBackendAvailable'

type ConnectionState = 'idle' | 'checking' | 'ok' | 'error'

const topics = ['#']
const STALE_DEVICE_MS = 5 * 60 * 1000
function App() {
  const [settings, setSettings] = useState<AppSettings>(defaultSettings)
  const [modalOpen, setModalOpen] = useState(true)
  const [forceModal, setForceModal] = useState(true)
  const [brokerModalOpen, setBrokerModalOpen] = useState(false)
  const [mqttState, setMqttState] = useState<ConnectionState>('idle')
  const [couchState, setCouchState] = useState<ConnectionState>('idle')
  const [brokers, setBrokers] = useState<BrokerConfig[]>([])
  const [activeBrokerId, setActiveBrokerId] = useState<string | null>(
    loadActiveBrokerId(),
  )
  const [devices, setDevices] = useState<Record<string, DeviceInfo>>(() =>
    DeviceState.getSnapshot(),
  )
  const [restarting, setRestarting] = useState<Record<string, boolean>>({})
  const [backingUp, setBackingUp] = useState<Record<string, boolean>>({})
  const [restartTarget, setRestartTarget] = useState<DeviceInfo | null>(null)
  const [powerModalDeviceId, setPowerModalDeviceId] = useState<string | null>(null)
  const [telemetryModalDeviceId, setTelemetryModalDeviceId] = useState<string | null>(null)
  const [rulesDeviceId, setRulesDeviceId] = useState<string | null>(null)
  const [settingsDeviceId, setSettingsDeviceId] = useState<string | null>(null)
  const [consoleLogs, setConsoleLogs] = useState<Record<string, string[]>>({})
  const mqttRef = useRef<MqttClient | null>(null)
  const activeBrokerRef = useRef<string | null>(null)
  const devicesRef = useRef<Record<string, DeviceInfo>>({})
  const restartingRef = useRef<Record<string, boolean>>({})
  
  
  const { available: backendAvailable } = useBackendAvailable()
  const lastCouchCheckRef = useRef<string | null>(null)
  const couchStateRef = useRef<ConnectionState>('idle')
  const settingsRef = useRef<AppSettings>(defaultSettings)
  const lastSnapshotLoadRef = useRef<string | null>(null)
  const lastRulesLoadRef = useRef<string | null>(null)
  const lastSettingsWebButtonRequestRef = useRef<string | null>(null)

  useEffect(() => {
    const stored = loadSettings()
    if (!stored) {
      setForceModal(true)
      setModalOpen(true)
      return
    }
    setSettings(stored)
    void validateAndConnect(stored, true)
  }, [])

  useEffect(() => {
    return () => {
      mqttRef.current?.end(true)
    }
  }, [])

  useEffect(() => {
    const interval = window.setInterval(() => {
      const cutoff = Date.now() - STALE_DEVICE_MS
      setDevices((prev) => {
        let changed = false
        const next = { ...prev }
        Object.values(prev).forEach((device) => {
          if (!device.lastSeen) {
            return
          }
          const last = Date.parse(device.lastSeen)
          if (Number.isNaN(last)) {
            return
          }
          if (last < cutoff && !device.hasData) {
            delete next[device.id]
            changed = true
          }
        })
        return changed ? next : prev
      })
    }, 60_000)
    return () => window.clearInterval(interval)
  }, [])

  useEffect(() => {
    devicesRef.current = devices
  }, [devices])

  useEffect(() => {
    return DeviceState.subscribe(() => {
      setDevices(DeviceState.getSnapshot())
    })
  }, [])

  useEffect(() => {
    restartingRef.current = restarting
  }, [restarting])

  useEffect(() => {
    activeBrokerRef.current = activeBrokerId
    if (activeBrokerId) {
      saveActiveBrokerId(activeBrokerId)
    }
  }, [activeBrokerId])

  useEffect(() => {
    couchStateRef.current = couchState
  }, [couchState])

  useEffect(() => {
    settingsRef.current = settings
  }, [settings])

  useEffect(() => {
    DeviceState.setCommandSender((_, topic, payload) => {
      if (!mqttRef.current?.connected) {
        return
      }
      mqttRef.current.publish(topic, payload)
    })
    DeviceState.setPersistFn((snapshot) => {
      return upsertDeviceSnapshot(settingsRef.current.couchdb, snapshot)
    })
  }, [])

  useEffect(() => {
    if (couchState !== 'ok') {
      return
    }
    const couch = settings.couchdb
    const key = `${couch.host}|${couch.port}|${couch.username}|${couch.database}|${couch.useTls}|${activeBrokerId ?? ''}`
    if (lastSnapshotLoadRef.current === key) {
      return
    }
    lastSnapshotLoadRef.current = key
    void (async () => {
      try {
        let snapshots = await fetchDeviceSnapshots(couch)
        if (snapshots.length > 0) {
          if (activeBrokerId) {
            snapshots = snapshots.map((snapshot) =>
              snapshot.brokerId && snapshot.brokerId !== 'default'
                ? snapshot
                : { ...snapshot, brokerId: activeBrokerId },
            )
          }
          DeviceState.hydrateFromSnapshots(snapshots)
        }
      } catch (error) {
        console.error('CouchDB Laden fehlgeschlagen', error)
      }
    })()
  }, [couchState, settings, activeBrokerId])

  useEffect(() => {
    if (couchState !== 'ok') {
      return
    }
    void (async () => {
      try {
        let fetched = await fetchBrokers(settings.couchdb)
        if (fetched.length === 0 && settings.mqtt.host) {
          const defaultBroker: BrokerConfig = {
            id: crypto.randomUUID(),
            name: 'Default Broker',
            mqtt: { ...settings.mqtt },
          }
          await upsertBroker(settings.couchdb, defaultBroker)
          fetched = [defaultBroker]
        }
        setBrokers(fetched)
        if (fetched.length > 0) {
          const existing = fetched.find((broker) => broker.id === activeBrokerId)
          const nextId = existing ? existing.id : fetched[0].id
          setActiveBrokerId(nextId)
        }
      } catch (error) {
        console.error('CouchDB Broker laden fehlgeschlagen', error)
      }
    })()
  }, [couchState, settings])

  useEffect(() => {
    const couch = settings.couchdb
    const isConfigured =
      Boolean(couch.host?.trim()) &&
      Boolean(couch.username?.trim()) &&
      Boolean(couch.password?.trim()) &&
      Boolean(couch.database?.trim()) &&
      Number.isFinite(couch.port) &&
      couch.port > 0
    if (!isConfigured || couchState !== 'idle') {
      return
    }
    const key = `${couch.host}|${couch.port}|${couch.username}|${couch.database}|${couch.useTls}`
    if (lastCouchCheckRef.current === key) {
      return
    }
    lastCouchCheckRef.current = key
    void (async () => {
      setCouchState('checking')
      try {
        await testCouchDbConnection(couch)
        setCouchState('ok')
      } catch {
        setCouchState('error')
      }
    })()
  }, [couchState, settings])

  useEffect(() => {
    if (!rulesDeviceId) {
      lastRulesLoadRef.current = null
      return
    }
    const device = devices[rulesDeviceId]
    if (!device || !mqttRef.current?.connected) {
      return
    }
    // Only load if this is a different device or if we haven't loaded yet
    if (lastRulesLoadRef.current === rulesDeviceId) {
      return
    }
    lastRulesLoadRef.current = rulesDeviceId
    const targetTopic = device.topic || device.id
    ;[1, 2, 3].forEach((ruleId) => {
      mqttRef.current?.publish(`cmnd/${targetTopic}/RULE${ruleId}`, '')
    })
    mqttRef.current?.publish(`cmnd/${targetTopic}/VAR`, '')
    mqttRef.current?.publish(`cmnd/${targetTopic}/MEM`, '')
    mqttRef.current?.publish(`cmnd/${targetTopic}/RULETIMER`, '')
  }, [rulesDeviceId, devices])

  useEffect(() => {
    if (!settingsDeviceId) {
      lastSettingsWebButtonRequestRef.current = null
      return
    }
    const device = devices[settingsDeviceId]
    if (!device?.powerChannels?.length || !mqttRef.current?.connected) {
      return
    }
    const needsLabels = device.powerChannels.some((ch) => !ch.label?.trim())
    if (!needsLabels || lastSettingsWebButtonRequestRef.current === settingsDeviceId) {
      return
    }
    lastSettingsWebButtonRequestRef.current = settingsDeviceId
    const targetTopic = device.topic || device.id
    mqttRef.current.publish(`cmnd/${targetTopic}/STATUS`, '5')
  }, [settingsDeviceId, devices])

  useEffect(() => {
    const broker = brokers.find((item) => item.id === activeBrokerId)
    if (!broker) {
      return
    }
    connectMqttLive(broker.mqtt)
  }, [activeBrokerId, brokers])

  // Automatische Abfragen sind deaktiviert; Refresh erfolgt manuell pro Gerät.

  const sortedDevices = useMemo(() => {
    return Object.values(devices)
      .filter((device) => device.hasRaw)
      .filter((device) => (activeBrokerId ? device.brokerId === activeBrokerId : true))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [devices, activeBrokerId])

  const powerModalDevice = powerModalDeviceId ? devices[powerModalDeviceId] : null
  const telemetryModalDevice = telemetryModalDeviceId ? devices[telemetryModalDeviceId] : null
  const rulesDevice = rulesDeviceId ? devices[rulesDeviceId] : null

  const appendConsoleLine = (deviceId: string, topic: string, payload: string) => {
    const time = new Date().toLocaleTimeString('de-DE', { hour12: false })
    const entry = `[${time}] ${topic} ${payload}`
    setConsoleLogs((prev) => {
      const existing = prev[deviceId] ?? []
      const next = [...existing, entry]
      const capped = next.length > 500 ? next.slice(next.length - 500) : next
      return { ...prev, [deviceId]: capped }
    })
  }

  const handleBackup = async (deviceId: string) => {
    const device = devicesRef.current[deviceId]
    if (!device?.ip || !backendAvailable) return
    setBackingUp((prev) => ({ ...prev, [deviceId]: true }))
    try {
      const info = await requestBackup(undefined, {
        host: device.ip,
        deviceId,
        brokerId: device.brokerId ?? activeBrokerRef.current ?? undefined,
        couchdb: settingsRef.current.couchdb,
      })
      const days =
        info.lastTimestamp != null
          ? Math.floor((Date.now() - new Date(info.lastTimestamp).getTime()) / 86400000)
          : 0
      DeviceState.updateInfo(deviceId, {
        daysSinceBackup: days,
        backupCount: info.count,
      })
    } catch (err) {
      console.error('Backup fehlgeschlagen:', err)
      alert(`Backup fehlgeschlagen: ${err instanceof Error ? err.message : 'Unbekannter Fehler'}`)
    } finally {
      setBackingUp((prev) => ({ ...prev, [deviceId]: false }))
    }
  }

  const sendPowerToggle = (deviceId: string, channelId: number) => {
    const device = devicesRef.current[deviceId]
    if (!device || !mqttRef.current?.connected) {
      return
    }
    const targetTopic = device.topic || device.id
    const command = channelId === 1 ? 'POWER' : `POWER${channelId}`
    mqttRef.current.publish(`cmnd/${targetTopic}/${command}`, 'TOGGLE')
  }


  const resolveTelemetryPayload = (
    deviceId: string,
  ): { topic?: string; data?: Record<string, unknown> } => {
    const raw = DeviceState.getRaw(deviceId)
    if (!raw) {
      return {}
    }
    const candidates = Object.entries(raw).filter(
      ([key, payload]) =>
        typeof payload === 'object' &&
        key.startsWith('tele/') &&
        key.toUpperCase().endsWith('/SENSOR'),
    )
    if (candidates.length === 0) {
      return {}
    }
    const getTime = (payload: unknown): number => {
      if (!payload || typeof payload !== 'object') {
        return 0
      }
      const value = (payload as Record<string, unknown>).Time
      if (typeof value === 'string') {
        const ts = Date.parse(value)
        return Number.isNaN(ts) ? 0 : ts
      }
      return 0
    }
    let best = candidates[0]
    let bestTime = getTime(best[1])
    for (const candidate of candidates.slice(1)) {
      const time = getTime(candidate[1])
      if (time > bestTime) {
        best = candidate
        bestTime = time
      }
    }
    return { topic: best[0], data: best[1] as Record<string, unknown> }
  }

  const formatTelemetryValue = (value: unknown): string => {
    if (value === null || value === undefined) {
      return '-'
    }
    if (typeof value === 'string') {
      return value
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value)
    }
    return JSON.stringify(value)
  }

  const renderTelemetryEntries = (data: Record<string, unknown>) => {
    return Object.entries(data).map(([key, value]) => {
      const isGroup =
        value !== null && typeof value === 'object' && !Array.isArray(value)
      if (!isGroup) {
        return (
          <div key={key} className="flex items-center justify-between gap-4 py-1 text-sm">
            <span className="text-slate-300">{key}</span>
            <span className="text-slate-100">{formatTelemetryValue(value)}</span>
          </div>
        )
      }
      return (
        <details key={key} className="rounded-md border border-slate-800/60 p-2">
          <summary className="cursor-pointer text-sm font-semibold text-slate-100">
            {key}
          </summary>
          <div className="mt-2 space-y-1">
            {renderTelemetryEntries(value as Record<string, unknown>)}
          </div>
        </details>
      )
    })
  }


  const connectMqttLive = (mqttSettings: MqttSettings) => {
    mqttRef.current?.end(true)
    const client = createMqttClient(mqttSettings)
    mqttRef.current = client
    setMqttState('checking')

    client.on('connect', () => {
      setMqttState('ok')
      client.subscribe(topics)
    })

    client.on('reconnect', () => setMqttState('checking'))
    client.on('close', () => setMqttState('error'))
    client.on('offline', () => setMqttState('error'))
    client.on('error', () => setMqttState('error'))

    client.on('message', (topic, payload) => {
      const parts = topic.split('/')
      if (parts.length < 3) {
        return
      }
      const scope = parts[0]
      const type = parts[parts.length - 1]
      const rawDeviceId = parts.slice(1, -1).join('/')
      if (scope === 'discovery') {
        return
      }
      const text = payload.toString()
      const deviceId = rawDeviceId
      appendConsoleLine(deviceId, topic, payload.toString())
      const brokerId = activeBrokerRef.current
      if (type === 'LWT') {
        const isOnline = text.toLowerCase() === 'online'
        if (isOnline) {
          DeviceState.setOnline(deviceId, true, brokerId ?? undefined)
        } else {
          DeviceState.setOnline(deviceId, false, brokerId ?? undefined)
        }
        return
      }

      let data: Record<string, any> | null = null
      try {
        data = JSON.parse(text)
      } catch {
        data = null
      }
      if (!data) {
        if (/^POWER\d*$/i.test(type)) {
          const normalized = text.trim().toUpperCase()
          if (normalized === 'ON' || normalized === 'OFF') {
            data = { [type]: normalized }
          }
        } else if (/^(VAR|MEM|RULETIMER)\d+$/i.test(type)) {
          data = { [type]: text.trim() }
        }
      }

      if (!data) {
        return
      }

      if (scope === 'tele' || scope === 'stat') {
        DeviceState.ingestMessage({
          deviceId,
          scope,
          type,
          payload: data,
          brokerId: brokerId ?? undefined,
        })
      }
    })
  }

  

  const validateAndConnect = async (
    nextSettings: AppSettings,
    connectLive: boolean,
  ): Promise<ConnectionResult> => {
    setMqttState('checking')
    setCouchState('checking')

    let mqttOk = false
    let couchOk = false
    let mqttError: string | undefined
    let couchError: string | undefined

    try {
      await testMqttConnection(nextSettings.mqtt)
      mqttOk = true
      setMqttState('ok')
    } catch (error) {
      mqttError = error instanceof Error ? error.message : 'MQTT-Verbindung fehlgeschlagen.'
      setMqttState('error')
    }

    try {
      await testCouchDbConnection(nextSettings.couchdb)
      couchOk = true
      setCouchState('ok')
    } catch (error) {
      couchError = error instanceof Error ? error.message : 'CouchDB-Verbindung fehlgeschlagen.'
      setCouchState('error')
    }

    if (mqttOk && couchOk) {
      saveSettings(nextSettings)
      setSettings(nextSettings)
      setForceModal(false)
      setModalOpen(false)
      if (connectLive) {
        const broker = brokers.find((item) => item.id === activeBrokerId)
        connectMqttLive(broker?.mqtt ?? nextSettings.mqtt)
      }
    } else {
      setForceModal(true)
      setModalOpen(true)
      mqttRef.current?.end(true)
    }

    return { mqttOk, couchOk, mqttError, couchError }
  }

  const onOpenSettings = () => {
    setForceModal(false)
    setModalOpen(true)
  }

  const statusPill = (label: string, state: ConnectionState) => {
    const color =
      state === 'ok'
        ? 'bg-emerald-500/20 text-emerald-200'
        : state === 'checking'
          ? 'bg-amber-500/20 text-amber-200'
          : state === 'error'
            ? 'bg-rose-500/20 text-rose-200'
            : 'bg-slate-700/50 text-slate-200'
    const text =
      state === 'ok'
        ? 'OK'
        : state === 'checking'
          ? 'Prüfe...'
          : state === 'error'
            ? 'Fehler'
            : '—'
    return (
      <span className={`rounded-full px-3 py-1 text-xs ${color}`}>
        {label}: {text}
      </span>
    )
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-950/90">
        <div className="mx-auto max-w-6xl px-6 py-4">
          <div className="flex flex-col gap-4 lg:grid lg:grid-cols-3 lg:items-center">
            <div>
              <h1 className="text-2xl font-semibold text-white">TasmotaScope</h1>
              <p className="text-sm text-slate-400">MQTT-Übersicht für Tasmota-Geräte</p>
            </div>
            <div className="flex items-center justify-between gap-3 lg:contents">
              <div className="flex items-center gap-2 lg:justify-self-center">
                <select
                  value={activeBrokerId ?? ''}
                  onChange={(event) => setActiveBrokerId(event.target.value)}
                  className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100"
                >
                  {brokers.length === 0 && <option value="">Kein Broker</option>}
                  {brokers.map((broker) => (
                    <option key={broker.id} value={broker.id}>
                      {broker.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setBrokerModalOpen(true)}
                  className="rounded-lg border border-slate-700 p-2 text-slate-200 hover:bg-slate-800"
                  aria-label="Broker verwalten (MQTT)"
                  title="Broker verwalten (MQTT)"
                >
                  <svg
                    className="h-4 w-4"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <circle cx="6" cy="12" r="2" />
                    <circle cx="18" cy="6" r="2" />
                    <circle cx="18" cy="18" r="2" />
                    <path d="M8 11l8-4" />
                    <path d="M8 13l8 4" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={onOpenSettings}
                  className="rounded-lg border border-slate-700 p-2 text-slate-200 hover:bg-slate-800"
                  aria-label="Verbindung bearbeiten"
                  title="Verbindung bearbeiten"
                >
                  <svg
                    className="h-4 w-4"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <ellipse cx="12" cy="5" rx="7" ry="3" />
                    <path d="M5 5v6c0 1.7 3.1 3 7 3s7-1.3 7-3V5" />
                    <path d="M5 11v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" />
                  </svg>
                </button>
              </div>
              <div className="flex items-center gap-2 lg:justify-self-end">
                {statusPill('MQTT', mqttState)}
                {statusPill('CouchDB', couchState)}
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        {settingsDeviceId ? (
          <DeviceSettingsPage
            device={settingsDeviceId ? devices[settingsDeviceId] ?? null : null}
            consoleLines={settingsDeviceId ? consoleLogs[settingsDeviceId] ?? [] : []}
            onSendCommand={(deviceId, command, payload) => {
              const device = devicesRef.current[deviceId]
              if (!device || !mqttRef.current?.connected) return
              const targetTopic = device.topic || device.id
              mqttRef.current.publish(`cmnd/${targetTopic}/${command}`, payload)
            }}
            onTogglePower={sendPowerToggle}
            onBack={() => setSettingsDeviceId(null)}
          />
        ) : rulesDeviceId ? (
          <RulesPage
            device={rulesDevice}
            consoleLines={rulesDevice ? consoleLogs[rulesDevice.id] ?? [] : []}
            rules={rulesDeviceId ? DeviceState.getRules(rulesDeviceId) : {}}
            properties={
              rulesDeviceId ? (DeviceState.getProperties(rulesDeviceId) as Record<string, Record<string, unknown>>) : {}
            }
            onSendCommand={(deviceId, command, payload) => {
              const device = devicesRef.current[deviceId]
              if (!device || !mqttRef.current?.connected) {
                return
              }
              const targetTopic = device.topic || device.id
              mqttRef.current.publish(`cmnd/${targetTopic}/${command}`, payload)
            }}
            onRuleUpdate={(ruleId, patch) => {
              if (!rulesDeviceId) {
                return
              }
              DeviceState.updateRule(rulesDeviceId, ruleId, patch)
            }}
            onBack={() => setRulesDeviceId(null)}
          />
        ) : (
          <>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">Geräte</h2>
              <span className="text-sm text-slate-400">{sortedDevices.length} gefunden</span>
            </div>
            <DeviceList
              devices={sortedDevices}
              restarting={restarting}
              onTogglePower={sendPowerToggle}
              onOpenPowerModal={(deviceId) => {
                setPowerModalDeviceId(deviceId)
              }}
              onOpenTelemetry={(deviceId) => {
                setTelemetryModalDeviceId(deviceId)
              }}
              onOpenRules={(deviceId) => setRulesDeviceId(deviceId)}
              onOpenSettings={(deviceId) => setSettingsDeviceId(deviceId)}
              onBackup={handleBackup}
              backingUp={backingUp}
              backendAvailable={backendAvailable}
              onRestart={(deviceId) => {
                if (restartingRef.current[deviceId]) {
                  return
                }
                const device = devicesRef.current[deviceId] ?? { id: deviceId, name: deviceId }
                setRestartTarget(device)
              }}
            />
          </>
        )}
      </main>

      {telemetryModalDevice && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4 py-8"
          onClick={() => setTelemetryModalDeviceId(null)}
        >
          <div
            className="w-fit max-w-[90vw] rounded-2xl bg-slate-900 p-5 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-white">Telemetrie</h3>
            <p className="mt-1 text-sm text-slate-300">
              Gerät{' '}
              <span className="font-semibold text-slate-100">
                {telemetryModalDevice.name}
              </span>
            </p>
            {(() => {
              const { topic, data } = resolveTelemetryPayload(telemetryModalDevice.id)
              if (!data) {
                return (
                  <p className="mt-4 text-sm text-slate-400">
                    Keine tele/SENSOR-Daten gefunden.
                  </p>
                )
              }
              return (
                <div className="mt-4 space-y-2">
                  {topic && (
                    <div className="text-xs text-slate-400">Quelle: {topic}</div>
                  )}
                  <div className="space-y-2">{renderTelemetryEntries(data)}</div>
                </div>
              )
            })()}
          </div>
        </div>
      )}

      {powerModalDevice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4 py-8">
          <div className="w-full max-w-4xl rounded-2xl bg-slate-900 p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-white">Power-Kanäle</h3>
            <p className="mt-2 text-sm text-slate-300">
              Gerät <span className="font-semibold text-slate-100">{powerModalDevice.name}</span>
            </p>
            {powerModalDevice.powerChannels && powerModalDevice.powerChannels.length > 0 ? (
              <div className="mt-5 grid grid-cols-8 gap-2">
                {powerModalDevice.powerChannels.map((channel) => (
                  <button
                    key={channel.id}
                    type="button"
                    onClick={() => sendPowerToggle(powerModalDevice.id, channel.id)}
                    className={`rounded-md border p-1 text-xs font-semibold hover:bg-slate-800 ${
                      channel.state === 'ON'
                        ? 'border-amber-400/50 bg-amber-400/10 text-amber-300'
                        : 'border-slate-700 text-slate-200'
                    }`}
                    aria-label={`Power ${channel.id}`}
                    title={channel.label ? `Power ${channel.id}: ${channel.label}` : `Power ${channel.id}`}
                  >
                    P{channel.id}
                  </button>
                ))}
              </div>
            ) : (
              <p className="mt-5 text-sm text-slate-400">Keine Power-Kanäle gefunden.</p>
            )}
            <div className="mt-6 flex items-center justify-end">
              <button
                type="button"
                onClick={() => setPowerModalDeviceId(null)}
                className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800"
              >
                Schließen
              </button>
            </div>
          </div>
        </div>
      )}

      <BrokerModal
        isOpen={brokerModalOpen}
        brokers={brokers}
        activeBrokerId={activeBrokerId}
        onClose={() => setBrokerModalOpen(false)}
        onSelect={(id) => setActiveBrokerId(id)}
        onSave={async (broker) => {
          await upsertBroker(settingsRef.current.couchdb, broker)
          setBrokers((prev) => {
            const existing = prev.find((item) => item.id === broker.id)
            if (existing) {
              return prev.map((item) => (item.id === broker.id ? broker : item))
            }
            return [...prev, broker]
          })
          setActiveBrokerId(broker.id)
        }}
      />

      {restartTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4 py-8">
          <div className="w-full max-w-md rounded-2xl bg-slate-900 p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-white">Neustart bestätigen</h3>
            <p className="mt-2 text-sm text-slate-300">
              Soll das Gerät <span className="font-semibold text-slate-100">{restartTarget.name}</span>{' '}
              neu gestartet werden?
            </p>
            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setRestartTarget(null)}
                className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800"
              >
                Abbrechen
              </button>
              <button
                type="button"
                onClick={() => {
                  const targetTopic = restartTarget.topic || restartTarget.id
                  mqttRef.current?.publish(`cmnd/${targetTopic}/Restart`, '1')
                  setRestarting((prev) => ({ ...prev, [restartTarget.id]: true }))
                  setRestartTarget(null)
                }}
                className="rounded-lg bg-rose-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-rose-400"
              >
                Neustart
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfigModal
        isOpen={modalOpen}
        initialSettings={settings}
        canClose={!forceModal}
        onClose={() => setModalOpen(false)}
        onApply={(next) => validateAndConnect(next, true)}
      />
      </div>
  )
}

export default App
