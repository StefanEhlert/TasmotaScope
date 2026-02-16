export type MqttSettings = {
  host: string
  port: number
  useTls: boolean
  username: string
  password: string
  clientId?: string
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
  /** Kurz-Infos (Topic, Modul, Firmware, …) aufgeklappt (Standard: true). */
  shortInfoExpanded?: boolean
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
  /** Gespeicherte Backups: createdAt immer, data optional (bei Bedarf per Backend-API laden). */
  backupItems?: { createdAt: string; data?: string }[]
  /** Automatisches Backup: Intervall in Tagen (null/undefined = aus). */
  autoBackupIntervalDays?: number | null
  /** Gerätetyp (Blakadder-id oder Freitext). */
  deviceType?: string
  /** Bilder für Gerätetyp (URLs). */
  deviceTypeImages?: string[]
  /** Bis zu 2 benutzerdefinierte Links (Titel + URL) unter dem Gerätetyp-Button. */
  deviceTypeCustomLinks?: Array<{ title?: string; url?: string }>
  /** Standort (z. B. Gebäude / Etage). */
  location?: string
  /** Raum (z. B. Wohnzimmer). */
  room?: string
  /** Kurze Beschreibung des Projektes. */
  projectDescription?: string
  /** Gespeicherter Zustand der Einstellungsseite (Konsole + Bereiche). */
  settingsUi?: DeviceSettingsUi
}

export type PowerChannel = {
  id: number
  state?: 'ON' | 'OFF'
  label?: string
}
