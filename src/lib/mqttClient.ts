import mqtt, { type IClientOptions, type MqttClient } from 'mqtt'
import type { MqttSettings } from './types'

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
    clientId: settings.clientId || `tasmotascope-${crypto.randomUUID()}`,
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
      clientId: `tasmotascope-test-${crypto.randomUUID()}`,
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
