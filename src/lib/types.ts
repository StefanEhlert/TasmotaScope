export type MqttSettings = {
  host: string
  port: number
  useTls: boolean
  username: string
  password: string
  clientId?: string
  path: string
}

export type CouchDbSettings = {
  host: string
  port: number
  useTls: boolean
  username: string
  password: string
  database: string
}

export type AppSettings = {
  mqtt: MqttSettings
  couchdb: CouchDbSettings
}

export type BrokerConfig = {
  id: string
  name: string
  mqtt: MqttSettings
}

/** Persistierter UI-Zustand der Geräte-Einstellungsseite (Konsole, Sensoren, Power, Config). */
export type DeviceSettingsUi = {
  /** Konsole aufgeklappt (Standard: true). */
  consoleExpanded?: boolean
  /** IDs eingeklappter Bereiche (Sensoren, Schaltkanäle, Config-Blöcke). Leer = alle aufgeklappt. */
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
  /** Gespeicherte Backups (von CouchDB): Datum + Base64-Daten für Download. */
  backupItems?: { createdAt: string; data: string }[]
  /** Automatisches Backup: Intervall in Tagen (null/undefined = aus). */
  autoBackupIntervalDays?: number | null
  /** Gespeicherter Zustand der Einstellungsseite (Konsole + Bereiche). */
  settingsUi?: DeviceSettingsUi
}

export type PowerChannel = {
  id: number
  state?: 'ON' | 'OFF'
  label?: string
}
