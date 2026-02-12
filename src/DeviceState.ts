import type { DeviceInfo, DeviceSettingsUi, PowerChannel } from './lib/types'

export type RuleConfig = {
  text: string
  enabled: boolean
  once: boolean
  stopOnError: boolean
  originalText?: string // Original text with comments
  sentText?: string // Text that was sent (without comments)
}

type DeviceRecord = {
  info: DeviceInfo
  raw: Record<string, unknown>
  properties: Record<string, unknown>
  rules: Record<number, RuleConfig>
  poll?: { attempts: number; timer?: number; varsBulkSent?: boolean; varsFullSent?: boolean }
}

type PersistSnapshot = {
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

type PersistFn = (snapshot: PersistSnapshot) => Promise<void>

type CommandSender = (deviceId: string, topic: string, payload: string) => void

const devices = new Map<string, DeviceRecord>()
const listeners = new Set<() => void>()
const dirtyDevices = new Set<string>()
const inFlightPersists = new Set<string>()
const pendingPersist = new Map<string, PersistSnapshot>()
const editingRules = new Map<string, Set<number>>() // Track which rules are being edited: deviceId -> Set<ruleIds>
const knownTopics = new Set<string>() // Track all known MQTT topics
let persistInterval: number | null = null
let persistFn: PersistFn | null = null
let commandSender: CommandSender | null = null

const defaultRule: RuleConfig = {
  text: '',
  enabled: false,
  once: false,
  stopOnError: false,
}

const notify = () => {
  listeners.forEach((cb) => cb())
}

const normalizeNumber = (value?: unknown): number | undefined => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined
  }
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

const resolveWifiSignal = (wifi: Record<string, unknown>): number | undefined => {
  const rssi = normalizeNumber(wifi.RSSI ?? wifi.Rssi ?? wifi.rssi)
  if (rssi !== undefined && rssi >= 0 && rssi <= 100) {
    return rssi
  }
  const signal = normalizeNumber(wifi.Signal ?? wifi.signal)
  if (signal === undefined) {
    return undefined
  }
  if (signal >= 0 && signal <= 100) {
    return signal
  }
  if (signal < -100 || signal > 0) {
    return undefined
  }
  const mapped = 2 * (signal + 100)
  return Math.min(100, Math.max(0, mapped))
}

const normalizeName = (value?: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined
  }
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

const asString = (value: unknown): string | undefined => {
  return typeof value === 'string' ? value : undefined
}

const mergeInfo = (current: DeviceInfo, patch: Partial<DeviceInfo>): DeviceInfo => {
  const next: DeviceInfo = { ...current }
  Object.entries(patch).forEach(([key, value]) => {
    if (key === 'autoBackupIntervalDays') {
      ;(next as Record<string, unknown>)[key] = value ?? null
      return
    }
    if (value === undefined || value === null || value === '') {
      return
    }
    ;(next as Record<string, unknown>)[key] = value
  })
  return next
}

const resolveNameUpdate = (
  current: DeviceInfo | undefined,
  options: {
    deviceName?: unknown
    friendlyName?: unknown
    topic?: unknown
  },
): Partial<DeviceInfo> | undefined => {
  const deviceName = normalizeName(options.deviceName)
  if (deviceName) {
    return {
      name: deviceName,
      deviceNameLocked: true,
      deviceNameValue: deviceName,
    }
  }
  if (current?.deviceNameLocked) {
    return undefined
  }
  const friendly = normalizeName(options.friendlyName)
  if (!friendly) {
    return undefined
  }
  const currentName = normalizeName(current?.name)
  const topicName = normalizeName(options.topic)
  if (!currentName || (topicName && currentName === topicName)) {
    return { name: friendly }
  }
  return undefined
}

const resolveNameFromTopic = (
  current: DeviceInfo | undefined,
  topic?: unknown,
): Partial<DeviceInfo> | undefined => {
  if (current?.deviceNameLocked) {
    return undefined
  }
  const currentName = normalizeName(current?.name)
  if (currentName) {
    return undefined
  }
  const topicName = normalizeName(topic)
  return topicName ? { name: topicName } : undefined
}

const normalizePowerState = (value?: unknown): 'ON' | 'OFF' | undefined => {
  if (typeof value === 'string') {
    const normalized = value.trim().toUpperCase()
    if (normalized === 'ON' || normalized === 'OFF') {
      return normalized
    }
  }
  if (typeof value === 'number') {
    return value === 1 ? 'ON' : value === 0 ? 'OFF' : undefined
  }
  if (typeof value === 'boolean') {
    return value ? 'ON' : 'OFF'
  }
  return undefined
}

const resolvePowerChannelsFromRaw = (raw?: Record<string, unknown>): PowerChannel[] => {
  if (!raw) {
    return []
  }
  const channelIds = new Set<number>()
  const labels = new Map<number, string>()
  const states = new Map<number, 'ON' | 'OFF'>()

  const registerPowerKey = (key: string): number | undefined => {
    if (key === 'POWER') {
      return 1
    }
    const match = /^POWER(\d+)$/.exec(key)
    if (!match) {
      return undefined
    }
    return Number.parseInt(match[1], 10)
  }

  const registerLabelKey = (key: string): number | undefined => {
    if (key === 'WebButton') {
      return 1
    }
    const match = /^WebButton(\d+)$/.exec(key)
    if (!match) {
      return undefined
    }
    return Number.parseInt(match[1], 10)
  }

  const getVariants = (payload: unknown): Record<string, unknown>[] => {
    if (!payload || typeof payload !== 'object') {
      return []
    }
    const data = payload as Record<string, unknown>
    const variants: Record<string, unknown>[] = [data]
    const statusSts = data.StatusSTS
    if (statusSts && typeof statusSts === 'object') {
      variants.push(statusSts as Record<string, unknown>)
    }
    const statusPrm = data.StatusPRM
    if (statusPrm && typeof statusPrm === 'object') {
      variants.push(statusPrm as Record<string, unknown>)
    }
    const status = data.Status
    if (status && typeof status === 'object') {
      variants.push(status as Record<string, unknown>)
    }
    return variants
  }

  const collect = (
    payload: unknown,
    options: { statesOnly?: boolean; onlyIfMissing?: boolean } = {},
  ) => {
    const { statesOnly, onlyIfMissing } = options
    for (const variant of getVariants(payload)) {
      for (const [rawKey, value] of Object.entries(variant)) {
        const key = rawKey.trim()
        const powerId = registerPowerKey(key)
        if (powerId !== undefined) {
          channelIds.add(powerId)
          if (statesOnly) {
            const nextState = normalizePowerState(value)
            if (nextState && (!onlyIfMissing || !states.has(powerId))) {
              states.set(powerId, nextState)
            }
          }
          continue
        }
        if (!statesOnly) {
          const labelId = registerLabelKey(key)
          if (labelId !== undefined && typeof value === 'string' && value.trim()) {
            channelIds.add(labelId)
            labels.set(labelId, value.trim())
          }
        }
      }
    }
  }

  for (const payload of Object.values(raw)) {
    collect(payload)
  }

  const priority = ['stat/RESULT', 'stat/STATE', 'tele/STATE', 'stat/STATUS11', 'stat/STATUS10']
  for (const key of priority) {
    if (raw[key]) {
      collect(raw[key], { statesOnly: true, onlyIfMissing: true })
    }
  }
  Object.entries(raw).forEach(([key, payload]) => {
    if (!payload || typeof payload !== 'object') {
      return
    }
    if (/^(stat|tele)\/POWER\d*$/i.test(key)) {
      collect(payload, { statesOnly: true, onlyIfMissing: true })
    }
  })

  return Array.from(channelIds)
    .filter((id) => Number.isFinite(id) && id > 0)
    .sort((a, b) => a - b)
    .map((id) => ({
      id,
      state: states.get(id),
      label: labels.get(id),
    }))
}

const updatePropertiesFromPayload = (record: DeviceRecord, payload: Record<string, unknown>) => {
  const next = { ...record.properties }
  const ensureGroup = (key: string) => {
    const existing = next[key]
    if (existing && typeof existing === 'object') {
      return existing as Record<string, unknown>
    }
    const created: Record<string, unknown> = {}
    next[key] = created
    return created
  }

  Object.entries(payload).forEach(([key, value]) => {
    if (key === 'Wifi' || key === 'WIFI') {
      return
    }
    const powerMatch = /^POWER(\d+)?$/i.exec(key)
    if (powerMatch) {
      const id = powerMatch[1] ?? '1'
      ensureGroup('POWER')[id] = value
      return
    }
    const switchMatch = /^Switch(\d+)$/i.exec(key)
    if (switchMatch) {
      ensureGroup('Switch')[switchMatch[1]] = value
      return
    }
    const buttonMatch = /^Button(\d+)$/i.exec(key)
    if (buttonMatch) {
      ensureGroup('Button')[buttonMatch[1]] = value
      return
    }
    const varMatch = /^VAR(\d+)$/i.exec(key)
    if (varMatch) {
      ensureGroup('VAR')[varMatch[1]] = value
      return
    }
    const memMatch = /^MEM(\d+)$/i.exec(key)
    if (memMatch) {
      ensureGroup('MEM')[memMatch[1]] = value
      return
    }
    const timerMatch = /^(?:RuleTimer|T)(\d+)$/i.exec(key)
    if (timerMatch) {
      ensureGroup('RuleTimer')[timerMatch[1]] = value
      return
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      next[key] = value
    }
  })

  record.properties = next
}

const parseRuleState = (value: unknown): boolean | undefined => {
  if (typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'number') {
    return value === 1
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toUpperCase()
    if (normalized === 'ON' || normalized === '1' || normalized === 'TRUE') {
      return true
    }
    if (normalized === 'OFF' || normalized === '0' || normalized === 'FALSE') {
      return false
    }
  }
  return undefined
}

const updateRulesFromPayload = (record: DeviceRecord, ruleId: number, payload: Record<string, unknown>) => {
  // Check if this rule is currently being edited - if so, don't update the text
  const deviceId = record.info.id
  const editingSet = editingRules.get(deviceId)
  const isEditing = editingSet?.has(ruleId) ?? false

  const ruleKey = `Rule${ruleId}`
  const upperKey = `RULE${ruleId}`
  const container =
    (payload[ruleKey] as Record<string, unknown> | string | undefined) ??
    (payload[upperKey] as Record<string, unknown> | string | undefined) ??
    payload

  let ruleData: Record<string, unknown> = {}
  if (typeof container === 'string') {
    const enabledValue = parseRuleState(container)
    const textValue =
      (typeof payload.Rules === 'string' && payload.Rules) ||
      (typeof payload.Rule === 'string' && payload.Rule) ||
      undefined
    const onceValue = parseRuleState(payload.Once)
    const stopValue = parseRuleState(payload.StopOnError)
    if (enabledValue !== undefined) {
      const existing = record.rules[ruleId] ?? defaultRule
      // Check if received text matches sent text (without comments) - if so, restore original text
      const receivedText = textValue ?? ''
      if (existing.sentText && existing.originalText && receivedText.trim() === existing.sentText.trim()) {
        // Received text matches sent text - restore original text with comments
        record.rules[ruleId] = {
          text: existing.originalText, // Restore original text with comments
          enabled: enabledValue,
          once: onceValue ?? existing.once ?? false,
          stopOnError: stopValue ?? existing.stopOnError ?? false,
          originalText: existing.originalText,
          sentText: existing.sentText,
        }
      } else {
        // Text doesn't match or no saved version - use received text and clear saved versions
        record.rules[ruleId] = {
          text: isEditing ? existing.text : (textValue ?? existing.text ?? ''), // Preserve text if editing
          enabled: enabledValue,
          once: onceValue ?? existing.once ?? false,
          stopOnError: stopValue ?? existing.stopOnError ?? false,
          // Clear saved versions if text doesn't match
          originalText: undefined,
          sentText: undefined,
        }
      }
    } else {
      const existing = record.rules[ruleId] ?? defaultRule
      // Check if received text matches sent text (without comments) - if so, restore original text
      const receivedText = container
      if (existing.sentText && existing.originalText && receivedText.trim() === existing.sentText.trim()) {
        // Received text matches sent text - restore original text with comments
        record.rules[ruleId] = {
          ...defaultRule,
          text: existing.originalText, // Restore original text with comments
          originalText: existing.originalText,
          sentText: existing.sentText,
        }
      } else {
        // Text doesn't match or no saved version - use received text and clear saved versions
        record.rules[ruleId] = { 
          ...defaultRule, 
          text: isEditing ? existing.text : container, // Preserve text if editing
          originalText: undefined,
          sentText: undefined,
        }
      }
    }
    return
  }
  if (container && typeof container === 'object') {
    ruleData = container as Record<string, unknown>
  }

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
  // Check if received text matches sent text (without comments) - if so, restore original text
  const receivedText = textValue ?? ''
  if (existing.sentText && existing.originalText && receivedText.trim() === existing.sentText.trim()) {
    // Received text matches sent text - restore original text with comments
    record.rules[ruleId] = {
      text: existing.originalText, // Restore original text with comments
      enabled: enabled ?? existing.enabled ?? false,
      once: once ?? existing.once ?? false,
      stopOnError: stopOnError ?? existing.stopOnError ?? false,
      originalText: existing.originalText,
      sentText: existing.sentText,
    }
  } else {
    // Text doesn't match or no saved version - use received text and clear saved versions
    record.rules[ruleId] = {
      text: isEditing ? existing.text : (textValue ?? existing.text ?? ''), // Preserve text if editing
      enabled: enabled ?? existing.enabled ?? false,
      once: once ?? existing.once ?? false,
      stopOnError: stopOnError ?? existing.stopOnError ?? false,
      // Clear saved versions if text doesn't match
      originalText: undefined,
      sentText: undefined,
    }
  }
}

const ensureDevice = (deviceId: string, brokerId?: string): DeviceRecord => {
  const existing = devices.get(deviceId)
  if (existing) {
    if (brokerId) {
      existing.info.brokerId = brokerId
    }
    return existing
  }
  const record: DeviceRecord = {
    info: { id: deviceId, name: deviceId, brokerId },
    raw: {},
    properties: {},
    rules: {},
  }
  devices.set(deviceId, record)
  return record
}

const scheduleInitialPolling = (deviceId: string) => {
  const record = devices.get(deviceId)
  if (!record || record.poll?.timer || !commandSender) {
    return
  }
  record.poll = { attempts: 0 }
  const poll = record.poll
  const request = () => {
    if (!commandSender) {
      return
    }
    const needsVars =
      !record.properties.VAR && !record.properties.MEM && !record.properties.RuleTimer
    const missing =
      !record.info.name ||
      record.info.name === record.info.id ||
      !record.info.module ||
      !record.info.firmware ||
      !record.info.ip ||
      !record.info.uptime
    if (!missing && !needsVars) {
      window.clearInterval(record.poll?.timer)
      record.poll = undefined
      return
    }
    poll.attempts += 1
    if (poll.attempts > 5) {
      window.clearInterval(poll.timer)
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
        for (let i = 1; i <= 16; i += 1) {
          commandSender(deviceId, `cmnd/${target}/VAR${i}`, '')
          commandSender(deviceId, `cmnd/${target}/MEM${i}`, '')
        }
        for (let i = 1; i <= 8; i += 1) {
          commandSender(deviceId, `cmnd/${target}/RULETIMER${i}`, '')
        }
      }
    }
  }
  // Sofortige Erstabfrage, dann alle 60s bis max 5 Versuche.
  request()
  poll.timer = window.setInterval(request, 60_000)
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
  autoBackupIntervalDays: record.info.autoBackupIntervalDays,
  settingsUi: record.info.settingsUi,
})

const enqueuePersistSnapshot = (deviceId: string, snapshot: PersistSnapshot) => {
  if (!persistFn) {
    return
  }
  if (inFlightPersists.has(deviceId)) {
    pendingPersist.set(deviceId, snapshot)
    return
  }
  inFlightPersists.add(deviceId)
  persistFn(snapshot)
    .catch(() => {
      // Fehler werden aufrufseitig bereits geloggt.
    })
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
    if (!record) {
      return
    }
    if (!record.info.brokerId) {
      // BrokerId fehlt noch (z.B. LWT vor dem ersten Telegramm).
      dirtyDevices.add(id)
      return
    }
    enqueuePersistSnapshot(id, buildSnapshot(record))
  })
}

const markDirty = (record: DeviceRecord) => {
  dirtyDevices.add(record.info.id)
  if (persistInterval) {
    return
  }
  // Periodische Speicherung, um Schreiblast zu reduzieren.
  persistInterval = window.setInterval(() => {
    if (!persistFn) {
      return
    }
    flushPersist()
    if (dirtyDevices.size === 0 && persistInterval) {
      window.clearInterval(persistInterval)
      persistInterval = null
    }
  }, 10_000)
}

export const DeviceState = {
  subscribe(callback: () => void) {
    listeners.add(callback)
    return () => {
      listeners.delete(callback)
    }
  },
  getSnapshot(): Record<string, DeviceInfo> {
    const out: Record<string, DeviceInfo> = {}
    devices.forEach((record, key) => {
      out[key] = { ...record.info, powerChannels: record.info.powerChannels }
    })
    return out
  },
  getRaw(deviceId: string) {
    return devices.get(deviceId)?.raw ?? null
  },
  getRules(deviceId: string) {
    return devices.get(deviceId)?.rules ?? {}
  },
  getProperties(deviceId: string) {
    return devices.get(deviceId)?.properties ?? {}
  },
  getDevice(deviceId: string) {
    return devices.get(deviceId)?.info ?? null
  },
  getKnownTopics(): string[] {
    return Array.from(knownTopics).sort()
  },
  updateRule(deviceId: string, ruleId: number, patch: Partial<RuleConfig>) {
    const record = ensureDevice(deviceId)
    const existing = record.rules[ruleId] ?? defaultRule
    record.rules[ruleId] = { ...existing, ...patch }
    markDirty(record)
    notify()
  },
  updateRuleWithComments(deviceId: string, ruleId: number, originalText: string, sentText: string) {
    const record = ensureDevice(deviceId)
    const existing = record.rules[ruleId] ?? defaultRule
    record.rules[ruleId] = {
      ...existing,
      text: originalText, // Store original text with comments
      originalText,
      sentText, // Store text that was sent (without comments)
    }
    markDirty(record)
    notify()
  },
  setRuleEditing(deviceId: string, ruleId: number, isEditing: boolean) {
    if (!editingRules.has(deviceId)) {
      editingRules.set(deviceId, new Set())
    }
    const editingSet = editingRules.get(deviceId)!
    if (isEditing) {
      editingSet.add(ruleId)
    } else {
      editingSet.delete(ruleId)
      if (editingSet.size === 0) {
        editingRules.delete(deviceId)
      }
    }
  },
  setPersistFn(fn: PersistFn | null) {
    persistFn = fn
  },
  setCommandSender(fn: CommandSender | null) {
    commandSender = fn
  },
  updateInfo(deviceId: string, patch: Partial<DeviceInfo>) {
    const record = ensureDevice(deviceId)
    record.info = mergeInfo(record.info, patch)
    scheduleInitialPolling(deviceId)
    markDirty(record)
    notify()
  },
  /** Aktualisiert den gespeicherten UI-Zustand der Einstellungsseite (Konsole, Bereiche). */
  updateSettingsUi(deviceId: string, patch: Partial<DeviceSettingsUi>) {
    const record = ensureDevice(deviceId)
    record.info.settingsUi = { ...record.info.settingsUi, ...patch }
    markDirty(record)
    notify()
  },
  hydrateFromSnapshots(
    snapshots: Array<{
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
      raw?: Record<string, unknown>
      backups?: { count: number; lastAt: string | null; items?: unknown[] }
      autoBackupIntervalDays?: number | null
      settingsUi?: DeviceSettingsUi
    }>,
  ) {
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
            typeof (item as { data?: unknown }).data === 'string',
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
        daysSinceBackup,
        backupCount,
        backupItems: backupItems.length > 0 ? backupItems : undefined,
        autoBackupIntervalDays:
          snapshot.autoBackupIntervalDays ?? record.info.autoBackupIntervalDays ?? undefined,
        settingsUi: snapshot.settingsUi ?? record.info.settingsUi,
      }
      record.raw = snapshot.raw ?? {}
      // Track known topics from snapshot
      Object.keys(record.raw).forEach((topicKey) => {
        if (topicKey.startsWith('stat/') || topicKey.startsWith('tele/') || topicKey.startsWith('cmnd/')) {
          knownTopics.add(topicKey)
        }
      })
      record.info.powerChannels = resolvePowerChannelsFromRaw(record.raw)
      record.info.hasRaw = Boolean(record.raw && Object.keys(record.raw).length > 0)
      record.info.hasData = true
      Object.values(record.raw).forEach((payload) => {
        if (payload && typeof payload === 'object') {
          updatePropertiesFromPayload(record, payload as Record<string, unknown>)
        }
      })
      notify()
    })
  },
  ingestMessage({
    deviceId,
    scope,
    type,
    payload,
    brokerId,
  }: {
    deviceId: string
    scope: string
    type: string
    payload: Record<string, unknown>
    brokerId?: string
  }) {
    if (deviceId.startsWith('discovery/')) {
      return
    }
    const record = ensureDevice(deviceId, brokerId)
    const payloadAny = payload as Record<string, unknown>
    const topicKey = `${scope}/${type}`
    record.raw[topicKey] = payloadAny
    // Track known topics
    if (scope === 'stat' || scope === 'tele' || scope === 'cmnd') {
      knownTopics.add(topicKey)
    }
    updatePropertiesFromPayload(record, payloadAny)
    record.info.hasRaw = true
    record.info.hasData = true

    const topicNameUpdate = resolveNameFromTopic(record.info, record.info.topic)
    if (topicNameUpdate) {
      record.info = mergeInfo(record.info, topicNameUpdate)
    }

    if (scope === 'stat' && /^RULE\d+$/i.test(type)) {
      const ruleId = Number(type.replace(/\D/g, ''))
      if (ruleId) {
        updateRulesFromPayload(record, ruleId, payload)
      }
    }
    if (scope === 'stat' && type === 'RESULT') {
      ;[1, 2, 3].forEach((ruleId) => {
        if (payload[`Rule${ruleId}`] !== undefined || payload[`RULE${ruleId}`] !== undefined) {
          updateRulesFromPayload(record, ruleId, payload)
        }
      })
    }

    if (type === 'STATE') {
      const wifi = (payloadAny.Wifi ?? payloadAny.WIFI ?? {}) as Record<string, unknown>
      const nameUpdate = resolveNameUpdate(record.info, {
        deviceName: payloadAny.DeviceName,
        friendlyName: payloadAny.FriendlyName,
        topic: record.info.topic,
      })
      const signal = resolveWifiSignal(wifi as Record<string, unknown>)
      record.info = mergeInfo(record.info, {
        ip:
          asString((wifi as Record<string, unknown>).IPAddress) ??
          asString((wifi as Record<string, unknown>).IPaddress),
        uptime:
          typeof payloadAny.Uptime === 'string'
            ? payloadAny.Uptime
            : asString(payloadAny.UptimeSec?.toString()),
        signal,
        ...nameUpdate,
      })
    }

    if (scope === 'stat' && type === 'RESULT') {
      const moduleValue = payloadAny.Module ?? payloadAny.ModuleName ?? payloadAny.Modules
      let moduleName: string | undefined
      if (typeof moduleValue === 'string') {
        moduleName = moduleValue
      } else if (moduleValue && typeof moduleValue === 'object') {
        const firstValue = Object.values(moduleValue as Record<string, unknown>)[0]
        moduleName = typeof firstValue === 'string' ? firstValue : undefined
      }
      if (moduleName) {
        record.info = mergeInfo(record.info, { module: moduleName })
      }
      record.info.powerChannels = resolvePowerChannelsFromRaw(record.raw)
    }

    if (scope === 'stat' && type === 'STATE') {
      record.info.powerChannels = resolvePowerChannelsFromRaw(record.raw)
    }
    if (scope === 'tele' && type === 'STATE') {
      record.info.powerChannels = resolvePowerChannelsFromRaw(record.raw)
    }
    if (/^POWER\d*$/i.test(type)) {
      record.info.powerChannels = resolvePowerChannelsFromRaw(record.raw)
    }

    const status = (payloadAny.Status ?? {}) as Record<string, unknown>
    const statusFwr = (payloadAny.StatusFWR ?? {}) as Record<string, unknown>
    const statusNet = (payloadAny.StatusNET ?? {}) as Record<string, unknown>
    const statusSts = (payloadAny.StatusSTS ?? {}) as Record<string, unknown>
    if (scope === 'stat' && status && typeof status === 'object') {
      const wifi = (statusSts.Wifi ?? statusSts.WIFI ?? payloadAny.Wifi ?? payloadAny.WIFI ?? {}) as Record<string, unknown>
      const topicValue = typeof status.Topic === 'string' ? status.Topic : asString(payloadAny.Topic)
      const statusFriendly =
        (status.FriendlyName as any)?.[0] ??
        (statusNet.FriendlyName as any)?.[0] ??
        (statusSts.FriendlyName as any)?.[0]
      const nameUpdate = resolveNameUpdate(record.info, {
        deviceName: status.DeviceName ?? statusSts.DeviceName ?? payloadAny.DeviceName,
        friendlyName: statusFriendly,
        topic: topicValue,
      })
      const topicNameUpdate = resolveNameFromTopic(record.info, topicValue)
      record.info = mergeInfo(record.info, {
        topic: topicValue,
        module:
          typeof status.Module === 'string'
            ? status.Module
            : asString(payloadAny.Module),
        firmware:
          typeof statusFwr.Version === 'string'
            ? statusFwr.Version
            : asString(payloadAny.Version),
        ip:
          asString(statusNet.IPAddress) ??
          asString((wifi as Record<string, unknown>).IPAddress) ??
          asString((wifi as Record<string, unknown>).IPaddress),
        uptime:
          typeof statusSts.Uptime === 'string'
            ? statusSts.Uptime
            : asString((statusSts.UptimeSec as number | undefined)?.toString()),
        ...nameUpdate,
        ...topicNameUpdate,
      })
    }

    if (type === 'INFO1') {
      const info = (payloadAny.Info1 ?? payloadAny.INFO1 ?? payloadAny) as Record<string, unknown>
      record.info = mergeInfo(record.info, {
        module: (info.Module as string | undefined) ?? (payloadAny.Module as string | undefined),
        firmware:
          (info.Version as string | undefined) ?? (payloadAny.Version as string | undefined),
      })
    }

    if (type === 'INFO2') {
      const info = (payloadAny.Info2 ?? payloadAny.INFO2 ?? payloadAny) as Record<string, unknown>
      const nameUpdate = resolveNameUpdate(record.info, {
        deviceName: info.DeviceName ?? payloadAny.DeviceName,
      })
      record.info = mergeInfo(record.info, { ...nameUpdate })
    }

    record.info.lastSeen = new Date().toISOString()
    scheduleInitialPolling(deviceId)
    markDirty(record)
    notify()
  },
  setOnline(deviceId: string, online: boolean, brokerId?: string) {
    const record = ensureDevice(deviceId, brokerId)
    record.info.online = online
    record.info.lastSeen = new Date().toISOString()
    markDirty(record)
    notify()
  },
}
