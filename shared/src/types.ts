/** Für Node- und Browser-Umgebung (kein DOM). */

export type DeviceSettingsUi = {
  consoleExpanded?: boolean
  collapsedBlockIds?: string[]
}

export type DeviceInfo = {
  id: string
  name: string
  deviceNameLocked?: boolean
  deviceNameValue?: string
  signal?: number
  powerChannels?: PowerChannel[]
  brokerId?: string
  topic?: string
  module?: string
  ip?: string
  firmware?: string
  uptime?: string
  online?: boolean
  lastSeen?: string
  hasData?: boolean
  hasRaw?: boolean
  daysSinceBackup?: number | null
  backupCount?: number
  backupItems?: { createdAt: string; data: string }[]
  autoBackupIntervalDays?: number | null
  settingsUi?: DeviceSettingsUi
}

export type PowerChannel = {
  id: number
  state?: 'ON' | 'OFF'
  label?: string
}

export type RuleConfig = {
  text: string
  enabled: boolean
  once: boolean
  stopOnError: boolean
  originalText?: string
  sentText?: string
}

/** Snapshot-Format für CouchDB-Persistenz (Backend/Frontend). */
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
