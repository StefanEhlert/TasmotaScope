import mqtt, { type IClientOptions, type MqttClient } from 'mqtt'
import type { MqttSettings } from './types'

function randomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  const bytes = new Uint8Array(16)
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256)
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = Array.from(bytes, (b) => b!.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function normalizePath(path: string) {
  if (!path) {
    return '/'
  }
  return path.startsWith('/') ? path : `/${path}`
}

export function buildMqttUrl(settings: MqttSettings): string {
  const protocol = settings.useTls ? 'wss' : 'ws'
  const path = normalizePath(settings.path || '/')
  return `${protocol}://${settings.host}:${settings.port}${path}`
}

function buildClientOptions(settings: MqttSettings): IClientOptions {
  return {
    username: settings.username || undefined,
    password: settings.password || undefined,
    clientId: settings.clientId || `tasmotascope-${randomId()}`,
    clean: true,
    keepalive: 30,
    reconnectPeriod: 2000,
    connectTimeout: 5000,
  }
}

export function createMqttClient(settings: MqttSettings): MqttClient {
  const url = buildMqttUrl(settings)
  return mqtt.connect(url, buildClientOptions(settings))
}

export async function testMqttConnection(settings: MqttSettings, timeoutMs = 5000): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const url = buildMqttUrl(settings)
    const client = mqtt.connect(url, {
      ...buildClientOptions(settings),
      clientId: `tasmotascope-test-${randomId()}`,
      reconnectPeriod: 0,
    })

    const timeout = window.setTimeout(() => {
      client.end(true)
      reject(new Error('MQTT-Verbindung Timeout.'))
    }, timeoutMs)

    client.on('connect', () => {
      window.clearTimeout(timeout)
      client.end(true, () => resolve())
    })

    client.on('error', (error) => {
      window.clearTimeout(timeout)
      client.end(true)
      reject(error)
    })
  })
}
