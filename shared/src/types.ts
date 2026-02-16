/** Für Node- und Browser-Umgebung (kein DOM). */

export type DeviceSettingsUi = {
  consoleExpanded?: boolean
  /** Kurz-Infos (Topic, Modul, Firmware, …) aufgeklappt (Standard: true). */
  shortInfoExpanded?: boolean
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
  /** createdAt immer; data optional (Download ggf. per Backend-API). */
  backupItems?: { createdAt: string; data?: string }[]
  autoBackupIntervalDays?: number | null
  /** Gerätetyp (Blakadder-id oder Freitext). */
  deviceType?: string
  /** Vom Nutzer hinzugefügte Bild-URLs (Data-URLs oder externe URLs) für die Gerätetyp-Anzeige. */
  deviceTypeImages?: string[]
  /** Bis zu 2 benutzerdefinierte Links (Titel + URL) unter dem Gerätetyp-Button. */
  deviceTypeCustomLinks?: Array<{ title?: string; url?: string }>
  /** Standort (z. B. Gebäude / Etage). */
  location?: string
  /** Raum (z. B. Wohnzimmer). */
  room?: string
  /** Kurze Beschreibung des Projektes. */
  projectDescription?: string
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
  /** WebButton(x)-Namen pro Kanal-ID, vom Listener aus MQTT-Payloads gesammelt und persistiert. */
  webButtonLabels?: Record<number, string>
  rules?: Record<number, RuleConfig>
  autoBackupIntervalDays?: number | null
  deviceType?: string
  deviceTypeImages?: string[]
  deviceTypeCustomLinks?: Array<{ title?: string; url?: string }>
  location?: string
  room?: string
  projectDescription?: string
  settingsUi?: DeviceSettingsUi
}
