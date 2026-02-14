import type { AppSettings } from './types'

const STORAGE_KEY = 'tasmotascope.settings.v1'
const ACTIVE_BROKER_KEY = 'tasmotascope.activeBrokerId'

export const defaultSettings: AppSettings = {
  mqtt: {
    host: '',
    port: 1883,
    useTls: false,
    username: '',
    password: '',
    clientId: '',
  },
  couchdb: {
    host: '',
    port: 5984,
    useTls: false,
    username: '',
    password: '',
    database: '',
  },
}

export function loadSettings(): AppSettings | null {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    return null
  }
  try {
    const parsed = JSON.parse(raw) as AppSettings
    return {
      mqtt: { ...defaultSettings.mqtt, ...parsed.mqtt },
      couchdb: { ...defaultSettings.couchdb, ...parsed.couchdb },
    }
  } catch {
    return null
  }
}

export function saveSettings(settings: AppSettings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
}

export function loadActiveBrokerId(): string | null {
  return localStorage.getItem(ACTIVE_BROKER_KEY)
}

export function saveActiveBrokerId(id: string | null) {
  if (id == null) {
    localStorage.removeItem(ACTIVE_BROKER_KEY)
  } else {
    localStorage.setItem(ACTIVE_BROKER_KEY, id)
  }
}
