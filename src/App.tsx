import { useEffect, useMemo, useRef, useState } from 'react'
import BrokerModal from './components/BrokerModal'
import ConfigModal, { type ConnectionResult } from './components/ConfigModal'
import DeviceList from './components/DeviceList'
import DeviceSettingsPage from './components/DeviceSettingsPage'
import RulesPage from './components/RulesPage'
import { DeviceState } from './DeviceState'
import { fetchDeviceSnapshot } from './lib/couchDb'
import {
  deleteBroker,
  fetchBrokersFromBackend,
  fetchDevicesFromBackend,
  getBackendStatus,
  getDevicesStreamUrl,
  patchDeviceInfo,
  postBroker,
  postCouchDbConfig,
  putBroker,
  requestBackup,
  requestDeleteBackup,
  sendCommand,
} from './lib/backendClient'
import { subscribeSSE } from './lib/sseStream'
import { apiDevicesToHydrateSnapshots } from './lib/deviceSync'
import {
  defaultSettings,
  loadActiveBrokerId,
  loadSettings,
  saveActiveBrokerId,
  saveSettings,
} from './lib/storage'
import type { AppSettings, BrokerConfig, DeviceInfo } from './lib/types'
import { useBackendAvailable } from './hooks/useBackendAvailable'

type ConnectionState = 'idle' | 'checking' | 'ok' | 'error'

const STALE_DEVICE_MS = 5 * 60 * 1000
function App() {
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings() ?? defaultSettings)
  const [configCheckDone, setConfigCheckDone] = useState(false)
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
  const [deleteBackupTarget, setDeleteBackupTarget] = useState<{
    deviceId: string
    index: number
  } | null>(null)
  const [powerModalDeviceId, setPowerModalDeviceId] = useState<string | null>(null)
  const [telemetryModalDeviceId, setTelemetryModalDeviceId] = useState<string | null>(null)
  const [telemetryAnchorRect, setTelemetryAnchorRect] = useState<DOMRect | null>(null)
  const [rulesDeviceId, setRulesDeviceId] = useState<string | null>(null)
  const [settingsDeviceId, setSettingsDeviceId] = useState<string | null>(null)
  /** Letzte Geräte-Antwort vom Backend (inkl. console pro Gerät). */
  const [lastApiDevices, setLastApiDevices] = useState<Record<string, Record<string, unknown>>>({})
  const [deviceSearch, setDeviceSearch] = useState('')
  const [deviceFilterFirmware, setDeviceFilterFirmware] = useState('')
  const [deviceFilterModule, setDeviceFilterModule] = useState('')
  const [deviceSortBy, setDeviceSortBy] = useState<'name' | 'firmware' | 'module' | 'uptime' | 'online' | 'ip'>('name')
  const [deviceSortDir, setDeviceSortDir] = useState<'asc' | 'desc'>('asc')
  const [selectedDeviceIds, setSelectedDeviceIds] = useState<Set<string>>(new Set())
  const [bulkProgress, setBulkProgress] = useState<{
    type: 'backup' | 'restart'
    current: number
    total: number
    deviceName: string
  } | null>(null)
  const activeBrokerRef = useRef<string | null>(null)
  const devicesRef = useRef<Record<string, DeviceInfo>>({})
  const restartingRef = useRef<Record<string, boolean>>({})
  
  
  const { available: backendAvailable } = useBackendAvailable()
  const couchStateRef = useRef<ConnectionState>('idle')
  const settingsRef = useRef<AppSettings>(defaultSettings)
  const lastRulesLoadRef = useRef<string | null>(null)
  const lastSettingsWebButtonRequestRef = useRef<string | null>(null)
  /** Verhindert, dass ein veraltetes SSE-Update eine gerade gesetzte Auto-Backup-Änderung überschreibt. */
  const lastAutoBackupUpdateRef = useRef<{ deviceId: string; value: number | null; at: number } | null>(null)
  /** Verhindert, dass ein veraltetes SSE-Update gerade gespeicherte Rules überschreibt. */
  const lastRulesUpdateRef = useRef<{ deviceId: string; at: number } | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      let status = await getBackendStatus()
      if (cancelled) return
      if (!status) {
        setCouchState('error')
        setForceModal(true)
        setModalOpen(true)
        setConfigCheckDone(true)
        return
      }
      if (!status.couchdb) {
        const stored = loadSettings()
        const couch = stored?.couchdb
        if (couch?.host?.trim() && couch?.database?.trim()) {
          try {
            await postCouchDbConfig(undefined, couch)
            status = await getBackendStatus()
          } catch {
            // gespeicherte Config ungültig oder Backend-Fehler
          }
        }
        if (cancelled) return
        if (!status?.couchdb) {
          setCouchState('error')
          setForceModal(true)
          setModalOpen(true)
          setConfigCheckDone(true)
          return
        }
      }
      setCouchState('ok')
      setModalOpen(false)
      setForceModal(false)
      try {
        const list = await fetchBrokersFromBackend()
        if (!cancelled) setBrokers(list)
        if (!cancelled && list.length === 0) setBrokerModalOpen(true)
      } catch {
        if (!cancelled) setBrokers([])
      }
      if (!cancelled) setConfigCheckDone(true)
    })()
    return () => { cancelled = true }
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

  // Bei Broker-Wechsel zurück zur Geräteliste (Detail-Ansichten schließen)
  useEffect(() => {
    setRulesDeviceId(null)
    setSettingsDeviceId(null)
    setPowerModalDeviceId(null)
    setTelemetryModalDeviceId(null)
    setTelemetryAnchorRect(null)
    setRestartTarget(null)
    setDeleteBackupTarget(null)
  }, [activeBrokerId])

  useEffect(() => {
    couchStateRef.current = couchState
  }, [couchState])

  useEffect(() => {
    settingsRef.current = settings
  }, [settings])

  useEffect(() => {
    DeviceState.setCommandSender((deviceId, topic, payload) => {
      void sendCommand(undefined, deviceId, topic, payload).catch(() => {})
    })
    DeviceState.setPersistFn((snapshot) => {
      return patchDeviceInfo(undefined, snapshot.deviceId, {
        autoBackupIntervalDays: snapshot.autoBackupIntervalDays,
        settingsUi: snapshot.settingsUi,
      })
    })
  }, [])

  useEffect(() => {
    if (couchState !== 'ok') return
    let cancelled = false
    let abortController: AbortController | null = null
    let pollInterval: ReturnType<typeof setInterval> | null = null

    const apply = (data: Record<string, unknown>) => {
      if (cancelled) return
      const asRecord = data as Record<string, Record<string, unknown>>
      const recent = lastAutoBackupUpdateRef.current
      if (recent && Date.now() - recent.at < 3000 && asRecord[recent.deviceId]) {
        asRecord[recent.deviceId] = {
          ...asRecord[recent.deviceId],
          autoBackupIntervalDays: recent.value,
        }
      }
      const recentRules = lastRulesUpdateRef.current
      if (recentRules && Date.now() - recentRules.at < 3000 && asRecord[recentRules.deviceId]) {
        const currentRules = DeviceState.getRules(recentRules.deviceId)
        if (Object.keys(currentRules).length > 0) {
          asRecord[recentRules.deviceId] = {
            ...asRecord[recentRules.deviceId],
            rules: currentRules,
          }
        }
      }
      setLastApiDevices(asRecord)
      const snapshots = apiDevicesToHydrateSnapshots(asRecord)
      if (snapshots.length > 0) DeviceState.hydrateFromSnapshots(snapshots)
      setDevices(DeviceState.getSnapshot())
    }

    const runStream = async () => {
      while (!cancelled) {
        abortController = new AbortController()
        try {
          await subscribeSSE({
            url: getDevicesStreamUrl(),
            onMessage: apply,
            signal: abortController.signal,
          })
        } catch (err) {
          if ((err as { name?: string }).name !== 'AbortError' && !cancelled) {
            console.warn('[SSE] Stream unterbrochen, Reconnect in 2s', err)
          }
        }
        if (cancelled) break
        await new Promise((r) => setTimeout(r, 2000))
      }
    }

    void fetchDevicesFromBackend().then(apply)
    void runStream()

    const POLL_MS = 15000
    pollInterval = setInterval(() => {
      if (cancelled) return
      void fetchDevicesFromBackend().then(apply)
    }, POLL_MS)

    return () => {
      cancelled = true
      abortController?.abort()
      if (pollInterval) clearInterval(pollInterval)
    }
  }, [couchState])

  useEffect(() => {
    if (!rulesDeviceId) {
      lastRulesLoadRef.current = null
      return
    }
    const device = devices[rulesDeviceId]
    if (!device) return
    if (lastRulesLoadRef.current === rulesDeviceId) return
    lastRulesLoadRef.current = rulesDeviceId
    const targetTopic = device.topic || device.id
    ;[1, 2, 3].forEach((ruleId) => {
      void sendCommand(undefined, rulesDeviceId, `cmnd/${targetTopic}/RULE${ruleId}`, '').catch(() => {})
    })
    void sendCommand(undefined, rulesDeviceId, `cmnd/${targetTopic}/VAR`, '').catch(() => {})
    void sendCommand(undefined, rulesDeviceId, `cmnd/${targetTopic}/MEM`, '').catch(() => {})
    void sendCommand(undefined, rulesDeviceId, `cmnd/${targetTopic}/RULETIMER`, '').catch(() => {})
  }, [rulesDeviceId, devices])

  useEffect(() => {
    if (!settingsDeviceId) {
      lastSettingsWebButtonRequestRef.current = null
      return
    }
    const device = devices[settingsDeviceId]
    if (!device?.powerChannels?.length || lastSettingsWebButtonRequestRef.current === settingsDeviceId) return
    lastSettingsWebButtonRequestRef.current = settingsDeviceId
    const targetTopic = device.topic || device.id
    for (const ch of device.powerChannels) {
      void sendCommand(undefined, settingsDeviceId, `cmnd/${targetTopic}/WebButton${ch.id}`, '').catch(() => {})
    }
  }, [settingsDeviceId, devices])

  useEffect(() => {
    if (settingsDeviceId ?? rulesDeviceId) {
      window.scrollTo(0, 0)
    }
  }, [settingsDeviceId, rulesDeviceId])

  useEffect(() => {
    if (!activeBrokerId || !configCheckDone) return
    let cancelled = false
    const update = async () => {
      const status = await getBackendStatus()
      if (cancelled || !status) return
      const state = status.brokers[activeBrokerId] === 'connected' ? 'ok' : activeBrokerId ? 'error' : 'idle'
      setMqttState(state)
    }
    void update()
    const t = window.setInterval(update, 10_000)
    return () => {
      cancelled = true
      window.clearInterval(t)
    }
  }, [activeBrokerId, configCheckDone])

  // Automatische Abfragen sind deaktiviert; Refresh erfolgt manuell pro Gerät.

  const baseDevices = useMemo(() => {
    return Object.values(devices)
      .filter((device) => {
        if (device.online !== true && device.online !== false) return false
        if (device.online === false && !device.hasRaw) return false
        return true
      })
      .filter((device) => (activeBrokerId ? device.brokerId === activeBrokerId : true))
  }, [devices, activeBrokerId])

  const { sortedDevices, uniqueFirmwares, uniqueModules } = useMemo(() => {
    const search = deviceSearch.trim().toLowerCase()
    const filtered = baseDevices.filter((device) => {
      if (search && !device.name.toLowerCase().includes(search) && !device.id.toLowerCase().includes(search)) return false
      if (deviceFilterFirmware && (device.firmware || '') !== deviceFilterFirmware) return false
      if (deviceFilterModule && (device.module || '') !== deviceFilterModule) return false
      return true
    })
    const cmp = (a: DeviceInfo, b: DeviceInfo): number => {
      let va: string | number | boolean | undefined
      let vb: string | number | boolean | undefined
      switch (deviceSortBy) {
        case 'name': va = a.name; vb = b.name; break
        case 'firmware': va = a.firmware ?? ''; vb = b.firmware ?? ''; break
        case 'module': va = a.module ?? ''; vb = b.module ?? ''; break
        case 'uptime': va = a.uptime ?? ''; vb = b.uptime ?? ''; break
        case 'online': va = a.online === true ? 1 : 0; vb = b.online === true ? 1 : 0; break
        case 'ip': va = a.ip ?? ''; vb = b.ip ?? ''; break
        default: va = a.name; vb = b.name
      }
      let out = 0
      if (typeof va === 'number' && typeof vb === 'number') out = va - vb
      else out = String(va).localeCompare(String(vb), undefined, { sensitivity: 'base' })
      return deviceSortDir === 'desc' ? -out : out
    }
    const sorted = [...filtered].sort(cmp)
    const firmwares = [...new Set(baseDevices.map((d) => d.firmware || '').filter(Boolean))].sort()
    const modules = [...new Set(baseDevices.map((d) => d.module || '').filter(Boolean))].sort()
    return { sortedDevices: sorted, uniqueFirmwares: firmwares, uniqueModules: modules }
  }, [baseDevices, deviceSearch, deviceFilterFirmware, deviceFilterModule, deviceSortBy, deviceSortDir])

  const powerModalDevice = powerModalDeviceId ? devices[powerModalDeviceId] : null
  const telemetryModalDevice = telemetryModalDeviceId ? devices[telemetryModalDeviceId] : null
  const rulesDevice = rulesDeviceId ? devices[rulesDeviceId] : null

  const handleBackup = async (deviceId: string) => {
    const device = devicesRef.current[deviceId]
    if (!device?.ip || !backendAvailable) return
    if (device.online !== true) return
    setBackingUp((prev) => ({ ...prev, [deviceId]: true }))
    try {
      await requestBackup(undefined, {
        host: device.ip,
        deviceId,
        brokerId: device.brokerId ?? activeBrokerRef.current ?? undefined,
        couchdb: settingsRef.current.couchdb,
      })
      // Backup-Liste aus CouchDB nachziehen, damit die UI sofort aktualisiert wird
      const snapshot = await fetchDeviceSnapshot(
        settingsRef.current.couchdb,
        deviceId,
        device.brokerId ?? activeBrokerRef.current ?? undefined,
      )
      if (snapshot) {
        DeviceState.hydrateFromSnapshots([snapshot])
      } else {
        const info = { count: (device.backupCount ?? 0) + 1, lastTimestamp: new Date().toISOString() }
        const days = 0
        DeviceState.updateInfo(deviceId, {
          daysSinceBackup: days,
          backupCount: info.count,
        })
      }
    } catch (err) {
      console.error('Backup fehlgeschlagen:', err)
      alert(`Backup fehlgeschlagen: ${err instanceof Error ? err.message : 'Unbekannter Fehler'}`)
    } finally {
      setBackingUp((prev) => ({ ...prev, [deviceId]: false }))
    }
  }

  const openDeleteBackupDialog = (deviceId: string, index: number) => {
    const device = devicesRef.current[deviceId]
    if (!device?.backupItems || index < 0 || index >= device.backupItems.length) return
    setDeleteBackupTarget({ deviceId, index })
  }

  const handleUpdateAutoBackup = async (deviceId: string, intervalDays: number | null) => {
    lastAutoBackupUpdateRef.current = { deviceId, value: intervalDays, at: Date.now() }
    setTimeout(() => {
      if (lastAutoBackupUpdateRef.current?.deviceId === deviceId) {
        lastAutoBackupUpdateRef.current = null
      }
    }, 3000)
    DeviceState.updateInfo(deviceId, { autoBackupIntervalDays: intervalDays })
    try {
      await patchDeviceInfo(undefined, deviceId, { autoBackupIntervalDays: intervalDays })
    } catch (err) {
      console.error('Auto-Backup am Backend aktualisieren fehlgeschlagen:', err)
    }
  }

  const handleRuleChange = async (deviceId: string) => {
    lastRulesUpdateRef.current = { deviceId, at: Date.now() }
    setTimeout(() => {
      if (lastRulesUpdateRef.current?.deviceId === deviceId) {
        lastRulesUpdateRef.current = null
      }
    }, 3000)
    const rules = DeviceState.getRules(deviceId)
    if (Object.keys(rules).length === 0) return
    try {
      await patchDeviceInfo(undefined, deviceId, { rules })
    } catch (err) {
      console.error('Rules am Backend aktualisieren fehlgeschlagen:', err)
    }
  }

  const performDeleteBackup = async () => {
    if (!deleteBackupTarget) return
    const { deviceId, index } = deleteBackupTarget
    const device = devicesRef.current[deviceId]
    if (!device?.backupItems || index < 0 || index >= device.backupItems.length) {
      setDeleteBackupTarget(null)
      return
    }
    try {
      await requestDeleteBackup(undefined, {
        deviceId,
        brokerId: device.brokerId ?? activeBrokerRef.current ?? undefined,
        couchdb: settingsRef.current.couchdb,
        index,
      })
      const nextItems = device.backupItems.filter((_, i) => i !== index)
      const days =
        nextItems[0] != null
          ? Math.floor(
              (Date.now() - new Date(nextItems[0].createdAt).getTime()) / 86400000,
            )
          : null
      DeviceState.updateInfo(deviceId, {
        backupItems: nextItems.length > 0 ? nextItems : undefined,
        backupCount: nextItems.length,
        daysSinceBackup: days,
      })
      setDeleteBackupTarget(null)
    } catch (err) {
      console.error('Backup löschen fehlgeschlagen:', err)
      alert(
        `Löschen fehlgeschlagen: ${err instanceof Error ? err.message : 'Unbekannter Fehler'}`,
      )
    }
  }

  const toggleDeviceSelection = (deviceId: string) => {
    setSelectedDeviceIds((prev) => {
      const next = new Set(prev)
      if (next.has(deviceId)) next.delete(deviceId)
      else next.add(deviceId)
      return next
    })
  }

  const setSelectAllDevices = (checked: boolean, deviceIds: string[]) => {
    setSelectedDeviceIds(checked ? new Set(deviceIds) : new Set())
  }

  const handleBulkBackup = async () => {
    const ids = Array.from(selectedDeviceIds).filter((id) => {
      const device = devicesRef.current[id]
      return device?.ip && device?.online === true && backendAvailable
    })
    if (ids.length === 0) {
      if (selectedDeviceIds.size > 0) {
        alert(
          'Kein Backup möglich: Alle ausgewählten Geräte haben entweder kein LWT Online, keine IP oder das Backend ist nicht verfügbar.'
        )
      }
      return
    }
    setBulkProgress({ type: 'backup', current: 0, total: ids.length, deviceName: '' })
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i]!
      const device = devicesRef.current[id]
      setBulkProgress({
        type: 'backup',
        current: i + 1,
        total: ids.length,
        deviceName: device?.name ?? id,
      })
      await handleBackup(id)
    }
    setBulkProgress(null)
    setSelectedDeviceIds(new Set())
  }

  const handleBulkRestart = async () => {
    const ids = Array.from(selectedDeviceIds)
    if (ids.length === 0) return
    setBulkProgress({ type: 'restart', current: 0, total: ids.length, deviceName: '' })
    for (let i = 0; i < ids.length; i++) {
      if (i > 0) await new Promise((r) => setTimeout(r, 1000))
      const id = ids[i]!
      const device = devicesRef.current[id]
      setBulkProgress({
        type: 'restart',
        current: i + 1,
        total: ids.length,
        deviceName: device?.name ?? id,
      })
      const topic = device?.topic ?? device?.id ?? id
      void sendCommand(undefined, id, `cmnd/${topic}/Restart`, '1').catch(() => {})
      setRestarting((prev) => ({ ...prev, [id]: true }))
    }
    setBulkProgress(null)
    setSelectedDeviceIds(new Set())
  }

  const handleBulkSetAutoBackup = (days: number) => {
    const ids = Array.from(selectedDeviceIds ?? [])
    const interval = days === 0 ? null : Math.max(1, Math.min(365, days))
    ids.forEach((deviceId) => handleUpdateAutoBackup(deviceId, interval))
  }

  const sendPowerToggle = (deviceId: string, channelId: number) => {
    const device = devicesRef.current[deviceId]
    if (!device) return
    const targetTopic = device.topic || device.id
    const command = channelId === 1 ? 'POWER' : `POWER${channelId}`
    void sendCommand(undefined, deviceId, `cmnd/${targetTopic}/${command}`, 'TOGGLE').catch(() => {})
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


  const validateAndConnectCouchDb = async (
    couchdb: AppSettings['couchdb']
  ): Promise<ConnectionResult> => {
    setCouchState('checking')
    let couchOk = false
    let couchError: string | undefined
    try {
      await postCouchDbConfig(undefined, couchdb)
      const status = await getBackendStatus()
      couchOk = status?.couchdb ?? false
      if (couchOk) {
        setCouchState('ok')
        setSettings((prev) => ({ ...prev, couchdb }))
        saveSettings({ ...settingsRef.current, couchdb })
        setForceModal(false)
        setModalOpen(false)
        // In-Memory-Gerätestand leeren, damit keine alten Werte (z. B. Auto-Backup) aus alter DB kleben
        DeviceState.clearAllDevices()
        setDevices({})
        setLastApiDevices({})
        const list = await fetchBrokersFromBackend()
        setBrokers(list)
        if (list.length === 0) {
          setActiveBrokerId(null)
          saveActiveBrokerId(null)
          setBrokerModalOpen(true)
        } else {
          const broker = list.find((b) => b.id === activeBrokerId) ?? list[0]
          setActiveBrokerId(broker.id)
          saveActiveBrokerId(broker.id)
          const st = await getBackendStatus()
          setMqttState(st?.brokers[broker.id] === 'connected' ? 'ok' : 'error')
        }
      } else {
        setCouchState('error')
        couchError = 'CouchDB nach Konfiguration nicht erreichbar.'
      }
    } catch (error) {
      setCouchState('error')
      couchError = error instanceof Error ? error.message : 'CouchDB-Konfiguration fehlgeschlagen.'
    }
    return { couchOk, couchError }
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
        <div className="mx-auto max-w-7xl px-6 py-4">
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

      <main className="mx-auto max-w-7xl px-6 py-8">
        {settingsDeviceId ? (
          <DeviceSettingsPage
            device={settingsDeviceId ? devices[settingsDeviceId] ?? null : null}
            consoleLines={settingsDeviceId ? ((lastApiDevices[settingsDeviceId]?.console as string[]) ?? []) : []}
            onSendCommand={(deviceId, command, payload) => {
              const device = devicesRef.current[deviceId]
              if (!device) return
              const targetTopic = device.topic || device.id
              void sendCommand(undefined, deviceId, `cmnd/${targetTopic}/${command}`, payload).catch(() => {})
            }}
            onTogglePower={sendPowerToggle}
            onBackup={handleBackup}
            onDeleteBackup={openDeleteBackupDialog}
            onUpdateAutoBackup={handleUpdateAutoBackup}
            backingUp={backingUp}
            backendAvailable={backendAvailable}
            onBack={() => setSettingsDeviceId(null)}
          />
        ) : rulesDeviceId ? (
          <RulesPage
            device={rulesDevice}
            consoleLines={rulesDevice ? ((lastApiDevices[rulesDevice.id]?.console as string[]) ?? []) : []}
            rules={rulesDeviceId ? DeviceState.getRules(rulesDeviceId) : {}}
            properties={
              rulesDeviceId ? (DeviceState.getProperties(rulesDeviceId) as Record<string, Record<string, unknown>>) : {}
            }
            onSendCommand={(deviceId, command, payload) => {
              const device = devicesRef.current[deviceId]
              if (!device) return
              const targetTopic = device.topic || device.id
              void sendCommand(undefined, deviceId, `cmnd/${targetTopic}/${command}`, payload).catch(() => {})
            }}
            onRuleUpdate={(ruleId, patch) => {
              if (!rulesDeviceId) {
                return
              }
              DeviceState.updateRule(rulesDeviceId, ruleId, patch)
              void handleRuleChange(rulesDeviceId)
            }}
            onRuleChange={handleRuleChange}
            onBack={() => setRulesDeviceId(null)}
          />
        ) : (
          <>
            <div className="mb-4 flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-semibold text-white">Geräte</h2>
                <span className="text-sm text-slate-400">{sortedDevices.length} gefunden</span>
              </div>
              <div className="flex w-full flex-wrap items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/50 p-3">
                <input
                  type="text"
                  placeholder="Gerät suchen…"
                  value={deviceSearch}
                  onChange={(e) => setDeviceSearch(e.target.value)}
                  className="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-emerald-500/50 focus:outline-none focus:ring-1 focus:ring-emerald-500/30"
                  aria-label="Gerätename durchsuchen"
                />
                <select
                  value={deviceFilterFirmware}
                  onChange={(e) => setDeviceFilterFirmware(e.target.value)}
                  className="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 focus:border-emerald-500/50 focus:outline-none focus:ring-1 focus:ring-emerald-500/30"
                  aria-label="Nach Firmware filtern"
                >
                  <option value="">Alle Firmware</option>
                  {uniqueFirmwares.map((f) => (
                    <option key={f} value={f}>{f}</option>
                  ))}
                </select>
                <select
                  value={deviceFilterModule}
                  onChange={(e) => setDeviceFilterModule(e.target.value)}
                  className="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 focus:border-emerald-500/50 focus:outline-none focus:ring-1 focus:ring-emerald-500/30"
                  aria-label="Nach Modul filtern"
                >
                  <option value="">Alle Module</option>
                  {uniqueModules.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
                <select
                  value={deviceSortBy}
                  onChange={(e) => setDeviceSortBy(e.target.value as typeof deviceSortBy)}
                  className="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 focus:border-emerald-500/50 focus:outline-none focus:ring-1 focus:ring-emerald-500/30"
                  aria-label="Sortierung nach Spalte"
                >
                  <option value="name">Gerät</option>
                  <option value="firmware">Firmware</option>
                  <option value="module">Modul</option>
                  <option value="uptime">Uptime</option>
                  <option value="online">LWT</option>
                  <option value="ip">IP-Adresse</option>
                </select>
                <button
                  type="button"
                  onClick={() => setDeviceSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
                  className="shrink-0 rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 hover:bg-slate-700 focus:border-emerald-500/50 focus:outline-none focus:ring-1 focus:ring-emerald-500/30"
                  title={deviceSortDir === 'asc' ? 'Aufsteigend (A→Z)' : 'Absteigend (Z→A)'}
                  aria-label={deviceSortDir === 'asc' ? 'Absteigend sortieren' : 'Aufsteigend sortieren'}
                >
                  {deviceSortDir === 'asc' ? '↑' : '↓'}
                </button>
              </div>
            </div>
            <DeviceList
              devices={sortedDevices}
              restarting={restarting}
              onTogglePower={sendPowerToggle}
              onOpenPowerModal={(deviceId) => {
                setPowerModalDeviceId(deviceId)
              }}
              onOpenTelemetry={(deviceId, anchorRect) => {
                setTelemetryModalDeviceId(deviceId)
                setTelemetryAnchorRect(anchorRect)
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
              selectedDeviceIds={selectedDeviceIds}
              onToggleSelection={toggleDeviceSelection}
              onSelectAll={(checked) => setSelectAllDevices(checked, sortedDevices.map((d) => d.id))}
              onBulkBackup={handleBulkBackup}
              onBulkRestart={handleBulkRestart}
              onBulkSetAutoBackup={handleBulkSetAutoBackup}
              bulkProgress={bulkProgress}
            />
          </>
        )}
      </main>

      {telemetryModalDevice && telemetryAnchorRect && (
        <div
          className="fixed inset-0 z-50"
          onClick={() => {
            setTelemetryModalDeviceId(null)
            setTelemetryAnchorRect(null)
          }}
          aria-hidden
        >
          <div
            className="fixed z-50 w-fit max-w-[min(90vw,28rem)] max-h-[85vh] overflow-auto rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-xl"
            style={{
              top: telemetryAnchorRect.bottom + 8,
              left: Math.min(telemetryAnchorRect.left, Math.max(8, window.innerWidth - 336)),
            }}
            onClick={(e) => e.stopPropagation()}
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
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => {
                  setTelemetryModalDeviceId(null)
                  setTelemetryAnchorRect(null)
                }}
                className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800"
              >
                Schließen
              </button>
            </div>
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
          const existing = brokers.find((b) => b.id === broker.id)
          if (existing) {
            await putBroker(undefined, broker.id, { name: broker.name, mqtt: broker.mqtt })
          } else {
            await postBroker(undefined, broker)
          }
          const list = await fetchBrokersFromBackend()
          setBrokers(list)
          setActiveBrokerId(broker.id)
        }}
        onDelete={async (brokerId) => {
          await deleteBroker(undefined, brokerId)
          const list = await fetchBrokersFromBackend()
          setBrokers(list)
          if (activeBrokerId === brokerId) setActiveBrokerId(list[0]?.id ?? null)
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
                  void sendCommand(undefined, restartTarget.id, `cmnd/${targetTopic}/Restart`, '1').catch(() => {})
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

      {deleteBackupTarget && (() => {
        const device = devices[deleteBackupTarget.deviceId]
        const item = device?.backupItems?.[deleteBackupTarget.index]
        const dateStr =
          item?.createdAt != null
            ? new Date(item.createdAt).toLocaleString(undefined, {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })
            : `${deleteBackupTarget.index + 1}. Backup`
        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4 py-8"
            onClick={() => setDeleteBackupTarget(null)}
          >
            <div
              className="w-full max-w-md rounded-2xl bg-slate-900 p-6 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-lg font-semibold text-white">Backup löschen</h3>
              <p className="mt-2 text-sm text-slate-300">
                Backup vom <span className="font-medium text-slate-200">{dateStr}</span> wirklich
                löschen? Diese Aktion kann nicht rückgängig gemacht werden.
              </p>
              <div className="mt-6 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setDeleteBackupTarget(null)}
                  className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800"
                >
                  Abbrechen
                </button>
                <button
                  type="button"
                  onClick={() => void performDeleteBackup()}
                  className="rounded-lg bg-rose-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-rose-400"
                >
                  Löschen
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      <ConfigModal
        isOpen={configCheckDone && modalOpen}
        initialCouchDb={settings.couchdb}
        canClose={!forceModal}
        onClose={() => setModalOpen(false)}
        onApply={(couchdb) => validateAndConnectCouchDb(couchdb)}
      />
      </div>
  )
}

export default App
