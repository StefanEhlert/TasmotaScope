import type { DeviceInfo } from './types'
import { DeviceState } from '../DeviceState'
import { TASMOTA_TRIGGERS, getAllTriggers } from './tasmotaTriggers'

export type ComponentSuggestion = {
  type: 'trigger' | 'topic' | 'command'
  value: string
  description?: string
}

export function extractDeviceComponents(deviceId: string, includeAllBrokerTopics: boolean = false): ComponentSuggestion[] {
  const suggestions: ComponentSuggestion[] = []
  const device = DeviceState.getDevice(deviceId)
  const raw = DeviceState.getRaw(deviceId)
  
  if (!device || !raw) {
    // Even if device is not found, we can still provide broker topics for cmnd/
    if (includeAllBrokerTopics) {
      const knownTopics = DeviceState.getKnownTopics()
      knownTopics.forEach((topic) => {
        suggestions.push({
          type: 'topic',
          value: topic,
          description: `Topic: ${topic}`,
        })
      })
    }
    return suggestions
  }

  // 1. Power-Channels (bereits verfügbar)
  if (device.powerChannels) {
    device.powerChannels.forEach((channel) => {
      suggestions.push({
        type: 'trigger',
        value: `Power${channel.id}`,
        description: `Power Channel ${channel.id}${channel.label ? ` (${channel.label})` : ''}`,
      })
      suggestions.push({
        type: 'trigger',
        value: `Power${channel.id}#State`,
        description: `Power${channel.id} State`,
      })
    })
  }

  // 2. Switches, Buttons aus Properties
  const properties = DeviceState.getProperties(deviceId)
  if (properties) {
    // Switches
    if (properties.Switch && typeof properties.Switch === 'object') {
      Object.keys(properties.Switch).forEach((key) => {
        suggestions.push({
          type: 'trigger',
          value: `Switch${key}`,
          description: `Switch ${key}`,
        })
        suggestions.push({
          type: 'trigger',
          value: `Switch${key}#State`,
          description: `Switch${key} State`,
        })
      })
    }

    // Buttons
    if (properties.Button && typeof properties.Button === 'object') {
      Object.keys(properties.Button).forEach((key) => {
        suggestions.push({
          type: 'trigger',
          value: `Button${key}`,
          description: `Button ${key}`,
        })
        suggestions.push({
          type: 'trigger',
          value: `Button${key}#State`,
          description: `Button${key} State`,
        })
      })
    }
  }

  // 3. Sensoren aus SENSOR-Daten extrahieren
  const sensorEntries = Object.entries(raw).filter(
    ([key]) => key.startsWith('tele/') && key.toUpperCase().endsWith('/SENSOR')
  )

  sensorEntries.forEach(([, payload]) => {
    if (payload && typeof payload === 'object') {
      extractSensorsFromPayload(payload as Record<string, unknown>, suggestions)
    }
  })

  // 4. Gerätespezifische stat/ Topics generieren
  const deviceTopic = device.topic || device.id
  if (deviceTopic) {
    // Power-Channels als stat/ Topics
    if (device.powerChannels) {
      device.powerChannels.forEach((channel) => {
        suggestions.push({
          type: 'topic',
          value: `stat/${deviceTopic}/POWER${channel.id}`,
          description: `Power${channel.id} Status Topic`,
        })
      })
    }

    // Switches als stat/ Topics
    if (properties?.Switch && typeof properties.Switch === 'object') {
      Object.keys(properties.Switch).forEach((key) => {
        suggestions.push({
          type: 'topic',
          value: `stat/${deviceTopic}/SWITCH${key}`,
          description: `Switch${key} Status Topic`,
        })
      })
    }

    // Sensoren als stat/ Topics (aus SENSOR-Daten)
    sensorEntries.forEach(([, payload]) => {
      if (payload && typeof payload === 'object') {
        extractSensorTopics(deviceTopic, payload as Record<string, unknown>, suggestions)
      }
    })
  }

  // 5. Topics aus raw extrahieren
  Object.keys(raw).forEach((topic) => {
    if (topic.startsWith('stat/') || topic.startsWith('tele/') || topic.startsWith('cmnd/')) {
      suggestions.push({
        type: 'topic',
        value: topic,
        description: `Topic: ${topic}`,
      })
    }
  })

  // 6. Bekannte Topics aus DeviceState (für cmnd/ Vorschläge)
  const knownTopics = DeviceState.getKnownTopics()
  knownTopics.forEach((topic) => {
    // Nur hinzufügen, wenn noch nicht vorhanden
    if (!suggestions.some(s => s.value === topic)) {
      suggestions.push({
        type: 'topic',
        value: topic,
        description: `Topic: ${topic}`,
      })
    }
  })

  // 7. Standard Tasmota Triggers hinzufügen (aber Sensoren nur wenn verfügbar)
  addStandardTriggers(deviceId, suggestions)

  return suggestions.sort((a, b) => a.value.localeCompare(b.value))
}

/**
 * Add standard Tasmota triggers, but only sensor triggers that are actually available on the device
 */
function addStandardTriggers(deviceId: string, suggestions: ComponentSuggestion[]) {
  // Get available sensor names from the device
  const availableSensors = getAvailableSensors(deviceId)
  
  // Get available switches, buttons, and power channels from the device
  const availableSwitches = getAvailableSwitches(deviceId)
  const availableButtons = getAvailableButtons(deviceId)
  const availablePowerChannels = getAvailablePowerChannels(deviceId)
  
  // Categories to always include (non-sensor triggers, but we'll filter switches/buttons/power)
  const alwaysIncludeCategories = [
    'System Triggers',
    'Time Triggers',
    'Rule Timer Triggers',
    'RuleTimer Triggers',
    'Event Triggers',
    'Analog Triggers',
    'RF & IR Triggers',
    'Energy Monitoring',
    'WiFi Triggers',
    'MQTT Triggers',
    'Serial Triggers',
    'Uptime Triggers',
    'Tele Triggers',
  ]
  
  // Sensor categories - only include if sensor is available
  const sensorCategories = [
    'Temperature Sensors',
    'Humidity Sensors',
    'Pressure Sensors',
    'Light & Motion Sensors',
  ]
  
  // Add always-included triggers
  TASMOTA_TRIGGERS.forEach(category => {
    if (alwaysIncludeCategories.includes(category.name)) {
      category.triggers.forEach(trigger => {
        // Only add if not already present
        if (!suggestions.some(s => s.value === trigger)) {
          suggestions.push({
            type: 'trigger',
            value: trigger,
            description: `${category.name}: ${trigger}`,
          })
        }
      })
    }
    
    // Handle Switch & Button Triggers - only add available ones
    if (category.name === 'Switch & Button Triggers') {
      category.triggers.forEach(trigger => {
        // Extract component number (e.g., "Switch1#State" -> "1")
        const switchMatch = trigger.match(/^Switch(\d+)#State$/)
        const buttonMatch = trigger.match(/^Button(\d+)#State$/)
        
        let shouldAdd = false
        if (switchMatch) {
          const switchNum = switchMatch[1]
          shouldAdd = availableSwitches.has(switchNum)
        } else if (buttonMatch) {
          const buttonNum = buttonMatch[1]
          shouldAdd = availableButtons.has(buttonNum)
        }
        
        if (shouldAdd && !suggestions.some(s => s.value === trigger)) {
          suggestions.push({
            type: 'trigger',
            value: trigger,
            description: `${category.name}: ${trigger}`,
          })
        }
      })
    }
    
    // Handle Power Triggers - only add available ones
    if (category.name === 'Power Triggers') {
      category.triggers.forEach(trigger => {
        // Extract power channel number (e.g., "Power1#State" -> "1")
        const powerMatch = trigger.match(/^Power(\d+)#State$/)
        if (powerMatch) {
          const powerNum = powerMatch[1]
          if (availablePowerChannels.has(powerNum) && !suggestions.some(s => s.value === trigger)) {
            suggestions.push({
              type: 'trigger',
              value: trigger,
              description: `${category.name}: ${trigger}`,
            })
          }
        }
      })
    }
  })
  
  // Add sensor triggers only for available sensors
  TASMOTA_TRIGGERS.forEach(category => {
    if (sensorCategories.includes(category.name)) {
      category.triggers.forEach(trigger => {
        // Extract sensor name from trigger (e.g., "DS18B20#temperature" -> "DS18B20")
        const sensorMatch = trigger.match(/^([A-Z0-9-]+)#/)
        if (sensorMatch) {
          const sensorName = sensorMatch[1]
          // Check if this sensor is available on the device
          if (availableSensors.has(sensorName.toUpperCase())) {
            // Only add if not already present
            if (!suggestions.some(s => s.value === trigger)) {
              suggestions.push({
                type: 'trigger',
                value: trigger,
                description: `${category.name}: ${trigger}`,
              })
            }
          }
        }
      })
    }
  })
  
  // Add telemetry triggers (tele- prefix) - these are generic and can be used with any sensor
  const telemetryCategory = TASMOTA_TRIGGERS.find(cat => cat.name === 'Telemetry Triggers')
  if (telemetryCategory) {
    telemetryCategory.triggers.forEach(trigger => {
      if (!suggestions.some(s => s.value === trigger)) {
        suggestions.push({
          type: 'trigger',
          value: trigger,
          description: `Telemetry: ${trigger}`,
        })
      }
    })
  }
}

/**
 * Get set of available sensor names from device data
 */
function getAvailableSensors(deviceId: string): Set<string> {
  const sensors = new Set<string>()
  const raw = DeviceState.getRaw(deviceId)
  
  if (!raw) return sensors
  
  // Extract sensor names from SENSOR data
  const sensorEntries = Object.entries(raw).filter(
    ([key]) => key.startsWith('tele/') && key.toUpperCase().endsWith('/SENSOR')
  )
  
  sensorEntries.forEach(([, payload]) => {
    if (payload && typeof payload === 'object') {
      extractSensorNames(payload as Record<string, unknown>, sensors)
    }
  })
  
  return sensors
}

/**
 * Recursively extract sensor names from payload
 */
function extractSensorNames(data: Record<string, unknown>, sensors: Set<string>, prefix = '') {
  Object.entries(data).forEach(([key, value]) => {
    // Skip Time and other meta fields
    if (key === 'Time' || key === 'Epoch') {
      return
    }
    
    // Known sensor names (uppercase for comparison)
    const sensorMatch = /^(AM2301|DHT11|DHT22|DS18B20|BME280|BMP280|SHT3X|HTU21|SI7021|LM75AD|MCP230XX|PCF8574|ADS1115|INA219|INA226|VL53L0X|VL53L1X|SR04|HX711|MAX44009|BH1750|TSL2561|VEML6070|VEML7700|MLX90614|MLX90615|MAX6675|MAX31855|MAX31865|MCP9808|SHT30|SHT40|SGP30|SGP40|SCD30|SCD40|SPS30|PMS5003|PMS7003|HPMA115S0|SDS011|SDS018|SDS021|SDS198|PMSA003|PMSX003|APDS9960)$/i.exec(key)
    if (sensorMatch) {
      sensors.add(key.toUpperCase())
      // Also check for numbered variants (e.g., DS18B20-1)
      if (key.includes('-')) {
        const baseName = key.split('-')[0].toUpperCase()
        sensors.add(baseName)
      }
    }
    
    // Recursively search nested objects
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      extractSensorNames(value as Record<string, unknown>, sensors, prefix)
    }
  })
}

/**
 * Get set of available switch numbers from device data
 */
function getAvailableSwitches(deviceId: string): Set<string> {
  const switches = new Set<string>()
  const properties = DeviceState.getProperties(deviceId)
  
  if (properties?.Switch && typeof properties.Switch === 'object') {
    Object.keys(properties.Switch).forEach(key => {
      switches.add(key)
    })
  }
  
  return switches
}

/**
 * Get set of available button numbers from device data
 */
function getAvailableButtons(deviceId: string): Set<string> {
  const buttons = new Set<string>()
  const properties = DeviceState.getProperties(deviceId)
  
  if (properties?.Button && typeof properties.Button === 'object') {
    Object.keys(properties.Button).forEach(key => {
      buttons.add(key)
    })
  }
  
  return buttons
}

/**
 * Get set of available power channel numbers from device data
 */
function getAvailablePowerChannels(deviceId: string): Set<string> {
  const powerChannels = new Set<string>()
  const device = DeviceState.getDevice(deviceId)
  
  if (device?.powerChannels) {
    device.powerChannels.forEach(channel => {
      powerChannels.add(channel.id.toString())
    })
  }
  
  return powerChannels
}

function extractSensorTopics(
  deviceTopic: string,
  data: Record<string, unknown>,
  suggestions: ComponentSuggestion[],
  prefix = '',
) {
  Object.entries(data).forEach(([key, value]) => {
    // Überspringe Time und andere Meta-Felder
    if (key === 'Time' || key === 'Epoch') {
      return
    }

    const fullKey = prefix ? `${prefix}/${key}` : key

    // Bekannte Sensoren als Topics
    const sensorMatch = /^(AM2301|DHT11|DHT22|DS18B20|BME280|BMP280|SHT3X|HTU21|SI7021|LM75AD|MCP230XX|PCF8574|ADS1115|INA219|INA226|VL53L0X|VL53L1X|SR04|HX711|MAX44009|BH1750|TSL2561|VEML6070|VEML7700|MLX90614|MLX90615|MAX6675|MAX31855|MAX31865|MCP9808|SHT30|SHT40|SGP30|SGP40|SCD30|SCD40|SPS30|PMS5003|PMS7003|HPMA115S0|SDS011|SDS018|SDS021|SDS198|PMSA003|PMSX003)$/i.exec(key)
    if (sensorMatch) {
      suggestions.push({
        type: 'topic',
        value: `stat/${deviceTopic}/${key}`,
        description: `${key} Sensor Topic`,
      })
    }

    // Verschachtelte Objekte rekursiv durchsuchen
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      extractSensorTopics(deviceTopic, value as Record<string, unknown>, suggestions, fullKey)
    }
  })
}

function extractSensorsFromPayload(
  data: Record<string, unknown>,
  suggestions: ComponentSuggestion[],
  prefix = '',
) {
  Object.entries(data).forEach(([key, value]) => {
    // Überspringe Time und andere Meta-Felder
    if (key === 'Time' || key === 'Epoch') {
      return
    }

    const fullKey = prefix ? `${prefix}.${key}` : key

    // Bekannte Sensoren erkennen (AM2301, DHT11, etc.)
    const sensorMatch = /^(AM2301|DHT11|DHT22|DS18B20|BME280|BMP280|SHT3X|HTU21|SI7021|LM75AD|MCP230XX|PCF8574|ADS1115|INA219|INA226|VL53L0X|VL53L1X|SR04|HX711|MAX44009|BH1750|TSL2561|VEML6070|VEML7700|MLX90614|MLX90615|MAX6675|MAX31855|MAX31865|MCP9808|SHT30|SHT40|SGP30|SGP40|SCD30|SCD40|SPS30|PMS5003|PMS7003|HPMA115S0|SDS011|SDS018|SDS021|SDS198|PMSA003|PMSX003)$/i.exec(key)
    if (sensorMatch) {
      suggestions.push({
        type: 'trigger',
        value: `Sensor${fullKey}`,
        description: `${key} Sensor`,
      })
    }

    // Auch Sensordaten-Felder erkennen (Temperature, Humidity, Pressure, etc.)
    const sensorDataFields = ['Temperature', 'Humidity', 'Pressure', 'Illuminance', 'Distance', 'Weight', 'CO2', 'PM2.5', 'PM10']
    if (sensorDataFields.some(field => key.includes(field))) {
      const sensorName = prefix || 'Sensor'
      suggestions.push({
        type: 'trigger',
        value: `Sensor${fullKey}`,
        description: `${key} Sensor Data`,
      })
    }

    // Verschachtelte Objekte rekursiv durchsuchen
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      extractSensorsFromPayload(value as Record<string, unknown>, suggestions, fullKey)
    }
  })
}
