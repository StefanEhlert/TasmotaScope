/**
 * Device-Store: Message-Parsing und Snapshot-Logik für Backend und Frontend.
 * Verwendet setInterval/clearInterval (kein window) – läuft in Node und Browser.
 */

import type {
  DeviceInfo,
  DeviceSettingsUi,
  PersistSnapshot,
  PowerChannel,
  RuleConfig,
} from './types.js'

type DeviceRecord = {
  info: DeviceInfo
  raw: Record<string, unknown>
  /** WebButton(x)-Werte aus MQTT; werden bei jeder Nachricht ergänzt und persistiert. */
  webButtonLabels?: Record<number, string>
  properties: Record<string, unknown>
  rules: Record<number, RuleConfig>
  poll?: { attempts: number; timer?: ReturnType<typeof setInterval>; varsBulkSent?: boolean; varsFullSent?: boolean }
}

type PersistFn = (snapshot: PersistSnapshot) => Promise<void>
type CommandSender = (deviceId: string, topic: string, payload: string) => void

const defaultRule: RuleConfig = {
  text: '',
  enabled: false,
  once: false,
  stopOnError: false,
}

function normalizeNumber(value?: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

function resolveWifiSignal(wifi: Record<string, unknown>): number | undefined {
  const rssi = normalizeNumber(wifi.RSSI ?? wifi.Rssi ?? wifi.rssi)
  if (rssi !== undefined && rssi >= 0 && rssi <= 100) return rssi
  const signal = normalizeNumber(wifi.Signal ?? wifi.signal)
  if (signal === undefined) return undefined
  if (signal >= 0 && signal <= 100) return signal
  if (signal < -100 || signal > 0) return undefined
  return Math.min(100, Math.max(0, 2 * (signal + 100)))
}

function normalizeName(value?: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const t = value.trim()
  return t || undefined
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function mergeSettingsUi(
  local: DeviceSettingsUi | undefined,
  remote: DeviceSettingsUi | undefined
): DeviceSettingsUi | undefined {
  const merged = { ...(remote ?? {}), ...(local ?? {}) }
  if (Object.keys(merged).length === 0) return undefined
  return merged
}

function mergeInfo(current: DeviceInfo, patch: Partial<DeviceInfo>): DeviceInfo {
  const next: DeviceInfo = { ...current }
  Object.entries(patch).forEach(([key, value]) => {
    if (key === 'autoBackupIntervalDays') {
      ;(next as Record<string, unknown>)[key] = value ?? null
      return
    }
    if (value === undefined || value === null || value === '') return
    ;(next as Record<string, unknown>)[key] = value
  })
  return next
}

function resolveNameUpdate(
  current: DeviceInfo | undefined,
  options: { deviceName?: unknown; friendlyName?: unknown; topic?: unknown }
): Partial<DeviceInfo> | undefined {
  const deviceName = normalizeName(options.deviceName)
  if (deviceName) return { name: deviceName, deviceNameLocked: true, deviceNameValue: deviceName }
  if (current?.deviceNameLocked) return undefined
  const friendly = normalizeName(options.friendlyName)
  if (!friendly) return undefined
  const currentName = normalizeName(current?.name)
  const topicName = normalizeName(options.topic)
  if (!currentName || (topicName && currentName === topicName)) return { name: friendly }
  return undefined
}

function resolveNameFromTopic(current: DeviceInfo | undefined, topic?: unknown): Partial<DeviceInfo> | undefined {
  if (current?.deviceNameLocked) return undefined
  if (normalizeName(current?.name)) return undefined
  const topicName = normalizeName(topic)
  return topicName ? { name: topicName } : undefined
}

function normalizePowerState(value?: unknown): 'ON' | 'OFF' | undefined {
  if (typeof value === 'string') {
    const n = value.trim().toUpperCase()
    if (n === 'ON' || n === 'OFF') return n
  }
  if (typeof value === 'number') return value === 1 ? 'ON' : value === 0 ? 'OFF' : undefined
  if (typeof value === 'boolean') return value ? 'ON' : 'OFF'
  return undefined
}

function resolvePowerChannelsFromRaw(
  raw?: Record<string, unknown>,
  webButtonLabels?: Record<number, string>
): PowerChannel[] {
  if (!raw) return []
  const channelIds = new Set<number>()
  const labels = new Map<number, string>()
  const states = new Map<number, 'ON' | 'OFF'>()
  const registerPowerKey = (key: string): number | undefined =>
    key === 'POWER' ? 1 : (() => { const m = /^POWER(\d+)$/.exec(key); return m ? parseInt(m[1], 10) : undefined })()
  const registerLabelKey = (key: string): number | undefined =>
    key === 'WebButton' ? 1 : (() => { const m = /^WebButton(\d+)$/.exec(key); return m ? parseInt(m[1], 10) : undefined })()

  const getVariants = (payload: unknown): Record<string, unknown>[] => {
    if (!payload || typeof payload !== 'object') return []
    const data = payload as Record<string, unknown>
    const out: Record<string, unknown>[] = [data]
    if (data.StatusSTS && typeof data.StatusSTS === 'object') out.push(data.StatusSTS as Record<string, unknown>)
    if (data.StatusPRM && typeof data.StatusPRM === 'object') out.push(data.StatusPRM as Record<string, unknown>)
    if (data.Status && typeof data.Status === 'object') out.push(data.Status as Record<string, unknown>)
    return out
  }

  const collect = (payload: unknown, opts: { statesOnly?: boolean; onlyIfMissing?: boolean } = {}) => {
    for (const variant of getVariants(payload)) {
      for (const [rawKey, value] of Object.entries(variant)) {
        const key = rawKey.trim()
        const powerId = registerPowerKey(key)
        if (powerId !== undefined) {
          channelIds.add(powerId)
          if (opts.statesOnly) {
            const s = normalizePowerState(value)
            if (s && (!opts.onlyIfMissing || !states.has(powerId))) states.set(powerId, s)
          }
          continue
        }
        if (!opts.statesOnly) {
          const labelId = registerLabelKey(key)
          if (labelId !== undefined && typeof value === 'string' && value.trim())
            labels.set(labelId, value.trim())
        }
      }
    }
  }

  for (const payload of Object.values(raw)) collect(payload)
  for (const key of ['stat/RESULT', 'stat/STATE', 'tele/STATE', 'stat/STATUS11', 'stat/STATUS10'])
    if (raw[key]) collect(raw[key], { statesOnly: true, onlyIfMissing: true })
  Object.entries(raw).forEach(([key, payload]) => {
    if (payload && typeof payload === 'object' && /^(stat|tele)\/POWER\d*$/i.test(key))
      collect(payload, { statesOnly: true, onlyIfMissing: true })
  })

  return Array.from(channelIds)
    .filter((id) => Number.isFinite(id) && id > 0)
    .sort((a, b) => a - b)
    .map((id) => ({
      id,
      state: states.get(id),
      label: (webButtonLabels && webButtonLabels[id]) ?? labels.get(id),
    }))
}

function updatePropertiesFromPayload(record: DeviceRecord, payload: Record<string, unknown>) {
  const next = { ...record.properties }
  const ensureGroup = (key: string) => {
    const ex = next[key]
    if (ex && typeof ex === 'object') return ex as Record<string, unknown>
    const c: Record<string, unknown> = {}
    next[key] = c
    return c
  }
  Object.entries(payload).forEach(([key, value]) => {
    if (key === 'Wifi' || key === 'WIFI') return
    const pm = /^POWER(\d+)?$/i.exec(key)
    if (pm) { ensureGroup('POWER')[pm[1] ?? '1'] = value; return }
    const sm = /^Switch(\d+)$/i.exec(key)
    if (sm) { ensureGroup('Switch')[sm[1]] = value; return }
    const bm = /^Button(\d+)$/i.exec(key)
    if (bm) { ensureGroup('Button')[bm[1]] = value; return }
    const vm = /^VAR(\d+)$/i.exec(key)
    if (vm) { ensureGroup('VAR')[vm[1]] = value; return }
    const mm = /^MEM(\d+)$/i.exec(key)
    if (mm) { ensureGroup('MEM')[mm[1]] = value; return }
    const tm = /^(?:RuleTimer|T)(\d+)$/i.exec(key)
    if (tm) { ensureGroup('RuleTimer')[tm[1]] = value; return }
    if (value && typeof value === 'object' && !Array.isArray(value)) next[key] = value
  })
  record.properties = next
}

function parseRuleState(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value === 1
  if (typeof value === 'string') {
    const n = value.trim().toUpperCase()
    if (n === 'ON' || n === '1' || n === 'TRUE') return true
    if (n === 'OFF' || n === '0' || n === 'FALSE') return false
  }
  return undefined
}

function updateRulesFromPayload(
  record: DeviceRecord,
  ruleId: number,
  payload: Record<string, unknown>,
  getIsEditing: (deviceId: string, ruleId: number) => boolean
) {
  const isEditing = getIsEditing(record.info.id, ruleId)
  const ruleKey = `Rule${ruleId}`
  const upperKey = `RULE${ruleId}`
  const container =
    (payload[ruleKey] as Record<string, unknown> | string | undefined) ??
    (payload[upperKey] as Record<string, unknown> | string | undefined) ??
    payload

  let ruleData: Record<string, unknown> = {}
  if (typeof container === 'string') {
    const enabledValue = parseRuleState(container)
    const textValue = (typeof payload.Rules === 'string' && payload.Rules) || (typeof payload.Rule === 'string' && payload.Rule) || undefined
    const onceValue = parseRuleState(payload.Once)
    const stopValue = parseRuleState(payload.StopOnError)
    if (enabledValue !== undefined) {
      const existing = record.rules[ruleId] ?? defaultRule
      const receivedText = textValue ?? ''
      if (existing.sentText && existing.originalText && receivedText.trim() === existing.sentText.trim()) {
        record.rules[ruleId] = {
          text: existing.originalText,
          enabled: enabledValue,
          once: onceValue ?? existing.once ?? false,
          stopOnError: stopValue ?? existing.stopOnError ?? false,
          originalText: existing.originalText,
          sentText: existing.sentText,
        }
      } else {
        record.rules[ruleId] = {
          text: isEditing ? existing.text : (textValue ?? existing.text ?? ''),
          enabled: enabledValue,
          once: onceValue ?? existing.once ?? false,
          stopOnError: stopValue ?? existing.stopOnError ?? false,
          originalText: undefined,
          sentText: undefined,
        }
      }
    } else {
      const existing = record.rules[ruleId] ?? defaultRule
      const receivedText = container
      if (existing.sentText && existing.originalText && receivedText.trim() === existing.sentText.trim()) {
        record.rules[ruleId] = { ...defaultRule, text: existing.originalText, originalText: existing.originalText, sentText: existing.sentText }
      } else {
        record.rules[ruleId] = { ...defaultRule, text: isEditing ? existing.text : container, originalText: undefined, sentText: undefined }
      }
    }
    return
  }
  if (container && typeof container === 'object') ruleData = container as Record<string, unknown>

  const textValue =
    (typeof ruleData.Rules === 'string' && ruleData.Rules) ||
    (typeof ruleData.Rule === 'string' && ruleData.Rule) ||
    (typeof ruleData[ruleKey] === 'string' && ruleData[ruleKey]) ||
    (typeof ruleData[upperKey] === 'string' && ruleData[upperKey]) ||
    undefined
  const enabled = parseRuleState(ruleData.State ?? ruleData.Enabled ?? ruleData.Enable)
  const once = parseRuleState(ruleData.Once)
  const stopOnError = parseRuleState(ruleData.StopOnError)
  const existing = record.rules[ruleId] ?? defaultRule
  const receivedText = textValue ?? ''
  if (existing.sentText && existing.originalText && receivedText.trim() === existing.sentText.trim()) {
    record.rules[ruleId] = {
      text: existing.originalText,
      enabled: enabled ?? existing.enabled ?? false,
      once: once ?? existing.once ?? false,
      stopOnError: stopOnError ?? existing.stopOnError ?? false,
      originalText: existing.originalText,
      sentText: existing.sentText,
    }
  } else {
    record.rules[ruleId] = {
      text: isEditing ? existing.text : (textValue ?? existing.text ?? ''),
      enabled: enabled ?? existing.enabled ?? false,
      once: once ?? existing.once ?? false,
      stopOnError: stopOnError ?? existing.stopOnError ?? false,
      originalText: undefined,
      sentText: undefined,
    }
  }
}

export type HydrateSnapshot = {
  deviceId: string
  brokerId?: string
  lastSeen?: string
  online?: boolean
  topic?: string
  fields: { name?: string; ip?: string; firmware?: string; module?: string; uptime?: string; signal?: number }
  raw?: Record<string, unknown>
  webButtonLabels?: Record<number, string>
  rules?: Record<number, RuleConfig>
  backups?: { count: number; lastAt: string | null; items?: unknown[] }
  autoBackupIntervalDays?: number | null
  settingsUi?: DeviceSettingsUi
}

export function createDeviceStore() {
  const devices = new Map<string, DeviceRecord>()
  const listeners = new Set<() => void>()
  const dirtyDevices = new Set<string>()
  const inFlightPersists = new Set<string>()
  const pendingPersist = new Map<string, PersistSnapshot>()
  const editingRules = new Map<string, Set<number>>()
  const knownTopics = new Set<string>()
  let persistInterval: ReturnType<typeof setInterval> | null = null
  let persistFn: PersistFn | null = null
  let commandSender: CommandSender | null = null

  const getIsEditing = (deviceId: string, ruleId: number) => editingRules.get(deviceId)?.has(ruleId) ?? false

  const notify = () => { listeners.forEach((cb) => cb()) }

  const ensureDevice = (deviceId: string, brokerId?: string): DeviceRecord => {
    const existing = devices.get(deviceId)
    if (existing) {
      if (brokerId) existing.info.brokerId = brokerId
      return existing
    }
    const record: DeviceRecord = {
      info: { id: deviceId, name: deviceId, brokerId },
      raw: {},
      webButtonLabels: {},
      properties: {},
      rules: {},
    }
    devices.set(deviceId, record)
    return record
  }

  const buildSnapshot = (record: DeviceRecord): PersistSnapshot => ({
    deviceId: record.info.id,
    brokerId: record.info.brokerId,
    lastSeen: record.info.lastSeen,
    online: record.info.online,
    topic: record.info.topic,
    fields: {
      name: record.info.name,
      ip: record.info.ip,
      firmware: record.info.firmware,
      module: record.info.module,
      uptime: record.info.uptime,
      signal: record.info.signal,
    },
    raw: record.raw,
    webButtonLabels: record.webButtonLabels && Object.keys(record.webButtonLabels).length > 0 ? record.webButtonLabels : undefined,
    rules: Object.keys(record.rules).length > 0 ? record.rules : undefined,
    autoBackupIntervalDays: record.info.autoBackupIntervalDays,
    settingsUi: record.info.settingsUi,
  })

  const enqueuePersistSnapshot = (deviceId: string, snapshot: PersistSnapshot) => {
    if (!persistFn) return
    if (inFlightPersists.has(deviceId)) {
      pendingPersist.set(deviceId, snapshot)
      return
    }
    inFlightPersists.add(deviceId)
    persistFn(snapshot)
      .catch(() => {})
      .finally(() => {
        inFlightPersists.delete(deviceId)
        const pending = pendingPersist.get(deviceId)
        if (pending) {
          pendingPersist.delete(deviceId)
          enqueuePersistSnapshot(deviceId, pending)
        }
      })
  }

  const flushPersist = () => {
    const ids = Array.from(dirtyDevices)
    dirtyDevices.clear()
    ids.forEach((id) => {
      const record = devices.get(id)
      if (!record || !record.info.brokerId) {
        if (record) dirtyDevices.add(record.info.id)
        return
      }
      enqueuePersistSnapshot(id, buildSnapshot(record))
    })
  }

  const markDirty = (record: DeviceRecord) => {
    dirtyDevices.add(record.info.id)
    if (persistInterval) return
    persistInterval = setInterval(() => {
      if (!persistFn) return
      flushPersist()
      if (dirtyDevices.size === 0 && persistInterval) {
        clearInterval(persistInterval)
        persistInterval = null
      }
    }, 10_000)
  }

  const scheduleInitialPolling = (deviceId: string) => {
    const record = devices.get(deviceId)
    if (!record || record.poll?.timer || !commandSender) return
    record.poll = { attempts: 0 }
    const poll = record.poll
    const request = () => {
      if (!commandSender) return
      const needsVars = !record.properties.VAR && !record.properties.MEM && !record.properties.RuleTimer
      const missing =
        !record.info.name || record.info.name === record.info.id || !record.info.module ||
        !record.info.firmware || !record.info.ip || !record.info.uptime
      if (!missing && !needsVars) {
        if (record.poll?.timer) clearInterval(record.poll.timer)
        record.poll = undefined
        return
      }
      poll.attempts! += 1
      if (poll.attempts! > 5) {
        if (poll.timer) clearInterval(poll.timer)
        record.poll = undefined
        return
      }
      const target = record.info.topic || record.info.id
      commandSender(deviceId, `cmnd/${target}/STATUS`, '0')
      commandSender(deviceId, `cmnd/${target}/STATUS`, '2')
      commandSender(deviceId, `cmnd/${target}/STATUS`, '5')
      commandSender(deviceId, `cmnd/${target}/MODULE`, '')
      if (needsVars) {
        if (!poll.varsBulkSent) {
          poll.varsBulkSent = true
          commandSender(deviceId, `cmnd/${target}/VAR`, '')
          commandSender(deviceId, `cmnd/${target}/MEM`, '')
          commandSender(deviceId, `cmnd/${target}/RULETIMER`, '')
        } else if (!poll.varsFullSent) {
          poll.varsFullSent = true
          for (let i = 1; i <= 16; i++) {
            commandSender(deviceId, `cmnd/${target}/VAR${i}`, '')
            commandSender(deviceId, `cmnd/${target}/MEM${i}`, '')
          }
          for (let i = 1; i <= 8; i++) commandSender(deviceId, `cmnd/${target}/RULETIMER${i}`, '')
        }
      }
    }
    request()
    poll.timer = setInterval(request, 60_000)
  }

  const ingestMessage = (params: {
    deviceId: string
    scope: string
    type: string
    payload: Record<string, unknown>
    brokerId?: string
  }) => {
    const { deviceId, scope, type, payload, brokerId } = params
    if (deviceId.startsWith('discovery/')) return
    const record = ensureDevice(deviceId, brokerId)
    const payloadAny = payload as Record<string, unknown>
    const topicKey = `${scope}/${type}`
    const existing = (record.raw[topicKey] as Record<string, unknown> | undefined) ?? {}
    record.raw[topicKey] = { ...existing, ...payloadAny }
    const WEBBUTTONS_RAW_KEY = 'webButtons'
    const webButtonEntries = Object.entries(payloadAny).filter(
      ([k]) => typeof k === 'string' && /^WebButton\d+$/i.test(k.trim())
    )
    if (webButtonEntries.length > 0) {
      const agg = (record.raw[WEBBUTTONS_RAW_KEY] as Record<string, unknown> | undefined) ?? {}
      record.raw[WEBBUTTONS_RAW_KEY] = { ...agg, ...Object.fromEntries(webButtonEntries) }
    }
    if (scope === 'stat' || scope === 'tele' || scope === 'cmnd') knownTopics.add(topicKey)
    for (const [key, value] of Object.entries(payloadAny)) {
      const m = /^WebButton(\d+)$/i.exec(key.trim())
      if (m && typeof value === 'string' && value.trim()) {
        if (!record.webButtonLabels) record.webButtonLabels = {}
        record.webButtonLabels[parseInt(m[1], 10)] = value.trim()
      }
    }
    updatePropertiesFromPayload(record, payloadAny)
    record.info.hasRaw = true
    record.info.hasData = true

    const topicNameUpdate = resolveNameFromTopic(record.info, record.info.topic)
    if (topicNameUpdate) record.info = mergeInfo(record.info, topicNameUpdate)

    if (scope === 'stat' && /^RULE\d+$/i.test(type)) {
      const ruleId = Number(type.replace(/\D/g, ''))
      if (ruleId) updateRulesFromPayload(record, ruleId, payload, getIsEditing)
    }
    if (scope === 'stat' && type === 'RESULT') {
      ;[1, 2, 3].forEach((ruleId) => {
        if (payload[`Rule${ruleId}`] !== undefined || payload[`RULE${ruleId}`] !== undefined)
          updateRulesFromPayload(record, ruleId, payload, getIsEditing)
      })
    }

    if (type === 'STATE') {
      const wifi = (payloadAny.Wifi ?? payloadAny.WIFI ?? {}) as Record<string, unknown>
      const nameUpdate = resolveNameUpdate(record.info, {
        deviceName: payloadAny.DeviceName,
        friendlyName: payloadAny.FriendlyName,
        topic: record.info.topic,
      })
      const signal = resolveWifiSignal(wifi)
      record.info = mergeInfo(record.info, {
        ip: asString(wifi.IPAddress ?? wifi.IPaddress),
        uptime: typeof payloadAny.Uptime === 'string' ? payloadAny.Uptime : asString((payloadAny.UptimeSec as number)?.toString()),
        signal,
        ...nameUpdate,
      })
    }

    if (scope === 'stat' && type === 'RESULT') {
      const moduleValue = payloadAny.Module ?? payloadAny.ModuleName ?? payloadAny.Modules
      let moduleName: string | undefined
      if (typeof moduleValue === 'string') moduleName = moduleValue
      else if (moduleValue && typeof moduleValue === 'object')
        moduleName = typeof (Object.values(moduleValue as object)[0]) === 'string' ? (Object.values(moduleValue as object)[0] as string) : undefined
      if (moduleName) record.info = mergeInfo(record.info, { module: moduleName })
      record.info.powerChannels = resolvePowerChannelsFromRaw(record.raw, record.webButtonLabels)
    }

    if (scope === 'stat' && type === 'STATE') record.info.powerChannels = resolvePowerChannelsFromRaw(record.raw, record.webButtonLabels)
    if (scope === 'tele' && type === 'STATE') record.info.powerChannels = resolvePowerChannelsFromRaw(record.raw, record.webButtonLabels)
    if (/^POWER\d*$/i.test(type)) record.info.powerChannels = resolvePowerChannelsFromRaw(record.raw, record.webButtonLabels)

    const status = (payloadAny.Status ?? {}) as Record<string, unknown>
    const statusFwr = (payloadAny.StatusFWR ?? {}) as Record<string, unknown>
    const statusNet = (payloadAny.StatusNET ?? {}) as Record<string, unknown>
    const statusSts = (payloadAny.StatusSTS ?? {}) as Record<string, unknown>
    if (scope === 'stat' && status && typeof status === 'object') {
      const wifi = (statusSts.Wifi ?? statusSts.WIFI ?? payloadAny.Wifi ?? payloadAny.WIFI ?? {}) as Record<string, unknown>
      const topicValue = (typeof status.Topic === 'string' ? status.Topic : asString(payloadAny.Topic)) as string | undefined
      const statusFriendly = (status.FriendlyName as string[])?.[0] ?? (statusNet.FriendlyName as string[])?.[0] ?? (statusSts.FriendlyName as string[])?.[0]
      const nameUpdate = resolveNameUpdate(record.info, {
        deviceName: status.DeviceName ?? statusSts.DeviceName ?? payloadAny.DeviceName,
        friendlyName: statusFriendly,
        topic: topicValue,
      })
      const topicNameUpdate = resolveNameFromTopic(record.info, topicValue)
      record.info = mergeInfo(record.info, {
        topic: topicValue,
        module: typeof status.Module === 'string' ? status.Module : asString(payloadAny.Module),
        firmware: typeof statusFwr.Version === 'string' ? statusFwr.Version : asString(payloadAny.Version),
        ip: asString(statusNet.IPAddress) ?? asString(wifi.IPAddress ?? wifi.IPaddress),
        uptime: typeof statusSts.Uptime === 'string' ? statusSts.Uptime : asString((statusSts.UptimeSec as number)?.toString()),
        ...nameUpdate,
        ...topicNameUpdate,
      })
    }

    if (type === 'INFO1') {
      const info = (payloadAny.Info1 ?? payloadAny.INFO1 ?? payloadAny) as Record<string, unknown>
      record.info = mergeInfo(record.info, {
        module: (info.Module as string) ?? (payloadAny.Module as string),
        firmware: (info.Version as string) ?? (payloadAny.Version as string),
      })
    }

    if (type === 'INFO2') {
      const info = (payloadAny.Info2 ?? payloadAny.INFO2 ?? payloadAny) as Record<string, unknown>
      const nameUpdate = resolveNameUpdate(record.info, { deviceName: info.DeviceName ?? payloadAny.DeviceName })
      record.info = mergeInfo(record.info, { ...nameUpdate })
    }

    record.info.lastSeen = new Date().toISOString()
    scheduleInitialPolling(deviceId)
    markDirty(record)
    notify()
  }

  const setOnline = (deviceId: string, online: boolean, brokerId?: string) => {
    const record = ensureDevice(deviceId, brokerId)
    record.info.online = online
    record.info.lastSeen = new Date().toISOString()
    markDirty(record)
    notify()
  }

  const hydrateFromSnapshots = (snapshots: HydrateSnapshot[]) => {
    snapshots.forEach((snapshot) => {
      const record = ensureDevice(snapshot.deviceId, snapshot.brokerId)
      const backups = snapshot.backups
      const daysSinceBackup =
        backups?.lastAt != null
          ? Math.floor((Date.now() - new Date(backups.lastAt).getTime()) / 86400000)
          : null
      const backupCount = backups?.count ?? 0
      const backupItems = (backups?.items ?? [])
        .filter(
          (item): item is { createdAt: string; data: string } =>
            item != null &&
            typeof item === 'object' &&
            typeof (item as { createdAt?: unknown }).createdAt === 'string' &&
            typeof (item as { data?: unknown }).data === 'string'
        )
        .map((item) => ({ createdAt: item.createdAt, data: item.data }))
      record.info = {
        ...record.info,
        name: snapshot.fields.name || record.info.name,
        ip: snapshot.fields.ip,
        firmware: snapshot.fields.firmware,
        module: snapshot.fields.module,
        uptime: snapshot.fields.uptime,
        signal: snapshot.fields.signal,
        online: snapshot.online,
        lastSeen: snapshot.lastSeen,
        topic: snapshot.topic,
        hasData: true,
        hasRaw: Boolean(snapshot.raw && Object.keys(snapshot.raw).length > 0),
        daysSinceBackup: daysSinceBackup,
        backupCount,
        backupItems: backupItems.length > 0 ? backupItems : undefined,
        // Backend/CouchDB is source of truth: do not carry over previous value when snapshot omits it
        autoBackupIntervalDays:
          snapshot.autoBackupIntervalDays !== undefined ? snapshot.autoBackupIntervalDays : undefined,
        settingsUi: mergeSettingsUi(record.info.settingsUi, snapshot.settingsUi),
      }
      record.raw = snapshot.raw ?? {}
      const WEBBUTTONS_RAW_KEY = 'webButtons'
      if (!record.raw[WEBBUTTONS_RAW_KEY]) {
        const agg: Record<string, unknown> = {}
        for (const payload of Object.values(record.raw)) {
          if (payload && typeof payload === 'object')
            for (const [k, v] of Object.entries(payload as Record<string, unknown>))
              if (/^WebButton\d+$/i.test(String(k).trim()) && typeof v === 'string' && v.trim())
                agg[k] = v.trim()
        }
        if (Object.keys(agg).length > 0) record.raw[WEBBUTTONS_RAW_KEY] = agg
      }
      if (snapshot.rules != null && typeof snapshot.rules === 'object') {
        record.rules = { ...record.rules, ...snapshot.rules }
      }
      Object.keys(record.raw).forEach((topicKey) => {
        if (topicKey.startsWith('stat/') || topicKey.startsWith('tele/') || topicKey.startsWith('cmnd/'))
          knownTopics.add(topicKey)
      })
      if (snapshot.webButtonLabels != null && typeof snapshot.webButtonLabels === 'object') {
        const numLabels: Record<number, string> = {}
        for (const [k, v] of Object.entries(snapshot.webButtonLabels)) {
          const n = parseInt(k, 10)
          if (Number.isFinite(n) && typeof v === 'string' && v.trim()) numLabels[n] = v.trim()
        }
        record.webButtonLabels = Object.keys(numLabels).length > 0 ? numLabels : record.webButtonLabels
      }
      record.info.powerChannels = resolvePowerChannelsFromRaw(record.raw, record.webButtonLabels)
      record.info.hasRaw = Boolean(record.raw && Object.keys(record.raw).length > 0)
      record.info.hasData = true
      Object.values(record.raw).forEach((payload) => {
        if (payload && typeof payload === 'object')
          updatePropertiesFromPayload(record, payload as Record<string, unknown>)
      })
      notify()
    })
  }

  const clearAllDevices = () => {
    devices.forEach((record) => {
      if (record.poll?.timer) clearInterval(record.poll.timer)
    })
    devices.clear()
    knownTopics.clear()
    dirtyDevices.clear()
    pendingPersist.clear()
    inFlightPersists.clear()
    editingRules.clear()
    notify()
  }

  return {
    subscribe(callback: () => void) {
      listeners.add(callback)
      return () => { listeners.delete(callback) }
    },
    clearAllDevices,
    getSnapshot(): Record<string, DeviceInfo> {
      const out: Record<string, DeviceInfo> = {}
      devices.forEach((record, key) => {
        out[key] = { ...record.info, powerChannels: record.info.powerChannels }
      })
      return out
    },
    getRaw(deviceId: string) { return devices.get(deviceId)?.raw ?? null },
    getRules(deviceId: string) { return devices.get(deviceId)?.rules ?? {} },
    getProperties(deviceId: string) { return devices.get(deviceId)?.properties ?? {} },
    getDevice(deviceId: string) { return devices.get(deviceId)?.info ?? null },
    getKnownTopics(): string[] { return Array.from(knownTopics).sort() },
    replaceRules(deviceId: string, rules: Record<number, RuleConfig>) {
      const record = ensureDevice(deviceId)
      record.rules = { ...rules }
      markDirty(record)
      notify()
    },
    updateRule(deviceId: string, ruleId: number, patch: Partial<RuleConfig>) {
      const record = ensureDevice(deviceId)
      record.rules[ruleId] = { ...(record.rules[ruleId] ?? defaultRule), ...patch }
      markDirty(record)
      notify()
    },
    updateRuleWithComments(deviceId: string, ruleId: number, originalText: string, sentText: string) {
      const record = ensureDevice(deviceId)
      const existing = record.rules[ruleId] ?? defaultRule
      record.rules[ruleId] = { ...existing, text: originalText, originalText, sentText }
      markDirty(record)
      notify()
    },
    setRuleEditing(deviceId: string, ruleId: number, isEditing: boolean) {
      if (!editingRules.has(deviceId)) editingRules.set(deviceId, new Set())
      const set = editingRules.get(deviceId)!
      if (isEditing) set.add(ruleId)
      else { set.delete(ruleId); if (set.size === 0) editingRules.delete(deviceId) }
    },
    setPersistFn(fn: PersistFn | null) { persistFn = fn },
    setCommandSender(fn: CommandSender | null) { commandSender = fn },
    updateInfo(deviceId: string, patch: Partial<DeviceInfo>) {
      const record = ensureDevice(deviceId)
      record.info = mergeInfo(record.info, patch)
      scheduleInitialPolling(deviceId)
      markDirty(record)
      notify()
    },
    updateSettingsUi(deviceId: string, patch: Partial<DeviceSettingsUi>) {
      const record = ensureDevice(deviceId)
      record.info.settingsUi = { ...record.info.settingsUi, ...patch }
      markDirty(record)
      notify()
    },
    hydrateFromSnapshots,
    ingestMessage,
    setOnline,
    /** Für Backend: Snapshot pro Gerät bauen (z. B. für CouchDB). */
    buildSnapshotForDevice(deviceId: string): PersistSnapshot | null {
      const record = devices.get(deviceId)
      return record ? buildSnapshot(record) : null
    },
    /** Alle Records (Backend: für Persist oder GET /api/devices). */
    getDevicesMap: () => devices,
  }
}

export type DeviceStore = ReturnType<typeof createDeviceStore>
