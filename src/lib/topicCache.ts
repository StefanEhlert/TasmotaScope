import { DeviceState } from '../DeviceState'

export type TopicComponent = {
  brokerId?: string
  deviceId: string
  scope: 'stat' | 'cmnd' | 'tele'
  topic: string // z.B. "eigenesTopic" oder "deviceName"
  component?: string // z.B. "POWER1", "AM2301", "SWITCH1"
  fullTopic: string // z.B. "stat/eigenesTopic/POWER1"
}

class TopicCache {
  private cache: Map<string, TopicComponent[]> = new Map() // Key: brokerId, Value: TopicComponent[]
  private lastUpdate: Map<string, number> = new Map() // Key: brokerId, Value: timestamp
  private updateInterval: number = 10 * 60 * 1000 // 10 Minuten

  /**
   * Erstellt einen Cache-Key aus BrokerID
   */
  private getCacheKey(brokerId?: string): string {
    return brokerId || 'default'
  }

  /**
   * Aktualisiert den Cache für einen bestimmten Broker
   */
  updateCache(brokerId?: string): void {
    const cacheKey = this.getCacheKey(brokerId)
    const components: TopicComponent[] = []

    // Alle Geräte durchgehen
    const devices = DeviceState.getSnapshot()
    
    Object.values(devices).forEach((device) => {
      // Nur Geräte dieses Brokers
      if (device.brokerId !== brokerId && brokerId !== undefined) {
        return
      }

      const deviceTopic = device.topic || device.id
      const raw = DeviceState.getRaw(device.id)
      const properties = DeviceState.getProperties(device.id)

      if (!raw || !deviceTopic) {
        return
      }

      // stat/ Topics für dieses Gerät
      // Power-Channels
      if (device.powerChannels) {
        device.powerChannels.forEach((channel) => {
          components.push({
            brokerId: device.brokerId,
            deviceId: device.id,
            scope: 'stat',
            topic: deviceTopic,
            component: `POWER${channel.id}`,
            fullTopic: `stat/${deviceTopic}/POWER${channel.id}`,
          })
        })
      }

      // Switches
      if (properties?.Switch && typeof properties.Switch === 'object') {
        Object.keys(properties.Switch).forEach((key) => {
          components.push({
            brokerId: device.brokerId,
            deviceId: device.id,
            scope: 'stat',
            topic: deviceTopic,
            component: `SWITCH${key}`,
            fullTopic: `stat/${deviceTopic}/SWITCH${key}`,
          })
        })
      }

      // Sensoren aus SENSOR-Daten
      const sensorEntries = Object.entries(raw).filter(
        ([key]) => key.startsWith('tele/') && key.toUpperCase().endsWith('/SENSOR')
      )

      sensorEntries.forEach(([, payload]) => {
        if (payload && typeof payload === 'object') {
          this.extractSensorComponents(device.brokerId, device.id, deviceTopic, payload as Record<string, unknown>, components)
        }
      })

      // cmnd/ Topics für andere Geräte (steuerbare Komponenten)
      // Power-Channels als cmnd/
      if (device.powerChannels) {
        device.powerChannels.forEach((channel) => {
          components.push({
            brokerId: device.brokerId,
            deviceId: device.id,
            scope: 'cmnd',
            topic: deviceTopic,
            component: `POWER${channel.id}`,
            fullTopic: `cmnd/${deviceTopic}/POWER${channel.id}`,
          })
        })
      }

      // Switches als cmnd/
      if (properties?.Switch && typeof properties.Switch === 'object') {
        Object.keys(properties.Switch).forEach((key) => {
          components.push({
            brokerId: device.brokerId,
            deviceId: device.id,
            scope: 'cmnd',
            topic: deviceTopic,
            component: `SWITCH${key}`,
            fullTopic: `cmnd/${deviceTopic}/SWITCH${key}`,
          })
        })
      }
    })

    this.cache.set(cacheKey, components)
    this.lastUpdate.set(cacheKey, Date.now())
  }

  /**
   * Extrahiert Sensorkomponenten aus SENSOR-Daten
   */
  private extractSensorComponents(
    brokerId: string | undefined,
    deviceId: string,
    deviceTopic: string,
    data: Record<string, unknown>,
    components: TopicComponent[],
    prefix = '',
  ): void {
    Object.entries(data).forEach(([key, value]) => {
      if (key === 'Time' || key === 'Epoch') {
        return
      }

      const fullKey = prefix ? `${prefix}/${key}` : key

      // Bekannte Sensoren erkennen
      const sensorMatch = /^(AM2301|DHT11|DHT22|DS18B20|BME280|BMP280|SHT3X|HTU21|SI7021|LM75AD|MCP230XX|PCF8574|ADS1115|INA219|INA226|VL53L0X|VL53L1X|SR04|HX711|MAX44009|BH1750|TSL2561|VEML6070|VEML7700|MLX90614|MLX90615|MAX6675|MAX31855|MAX31865|MCP9808|SHT30|SHT40|SGP30|SGP40|SCD30|SCD40|SPS30|PMS5003|PMS7003|HPMA115S0|SDS011|SDS018|SDS021|SDS198|PMSA003|PMSX003)$/i.exec(key)
      if (sensorMatch) {
        components.push({
          brokerId,
          deviceId,
          scope: 'stat',
          topic: deviceTopic,
          component: key,
          fullTopic: `stat/${deviceTopic}/${key}`,
        })
      }

      // Verschachtelte Objekte rekursiv durchsuchen
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        this.extractSensorComponents(brokerId, deviceId, deviceTopic, value as Record<string, unknown>, components, fullKey)
      }
    })
  }

  /**
   * Gibt Topics für einen bestimmten Broker zurück (mit automatischem Update wenn nötig)
   */
  getTopics(brokerId?: string, forceUpdate: boolean = false): TopicComponent[] {
    const cacheKey = this.getCacheKey(brokerId)
    const lastUpdateTime = this.lastUpdate.get(cacheKey) || 0
    const now = Date.now()

    // Cache aktualisieren wenn nötig
    if (forceUpdate || !this.cache.has(cacheKey) || (now - lastUpdateTime) > this.updateInterval) {
      this.updateCache(brokerId)
    }

    return this.cache.get(cacheKey) || []
  }

  /**
   * Filtert Topics nach verschiedenen Kriterien
   */
  filterTopics(
    brokerId: string | undefined,
    options: {
      scope?: 'stat' | 'cmnd' | 'tele'
      deviceId?: string
      topicPrefix?: string
      componentPrefix?: string
    }
  ): TopicComponent[] {
    const topics = this.getTopics(brokerId)
    
    return topics.filter(topic => {
      if (options.scope && topic.scope !== options.scope) {
        return false
      }
      if (options.deviceId && topic.deviceId !== options.deviceId) {
        return false
      }
      if (options.topicPrefix && !topic.topic.toLowerCase().startsWith(options.topicPrefix.toLowerCase())) {
        return false
      }
      if (options.componentPrefix && topic.component && !topic.component.toLowerCase().startsWith(options.componentPrefix.toLowerCase())) {
        return false
      }
      return true
    })
  }

  /**
   * Gibt alle eindeutigen Topics zurück (für cmnd/ Vorschläge)
   */
  getUniqueTopics(brokerId?: string, excludeDeviceId?: string): string[] {
    const topics = this.getTopics(brokerId)
    const uniqueTopics = new Set<string>()
    
    topics.forEach(topic => {
      if (!excludeDeviceId || topic.deviceId !== excludeDeviceId) {
        uniqueTopics.add(topic.topic)
      }
    })
    
    return Array.from(uniqueTopics).sort()
  }

  /**
   * Gibt Komponenten für ein bestimmtes Topic zurück
   */
  getComponentsForTopic(brokerId: string | undefined, topic: string, scope: 'stat' | 'cmnd' = 'cmnd'): string[] {
    const topics = this.getTopics(brokerId)
    const components = new Set<string>()
    
    topics.forEach(t => {
      if (t.topic === topic && t.scope === scope && t.component) {
        components.add(t.component)
      }
    })
    
    return Array.from(components).sort()
  }
}

// Singleton-Instanz
export const topicCache = new TopicCache()
