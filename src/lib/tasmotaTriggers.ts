/**
 * Complete list of Tasmota Rule Triggers
 * Based on: https://tasmota.github.io/docs/Rules/#rule-trigger
 */

export interface TriggerCategory {
  name: string
  description: string
  triggers: string[]
}

export const TASMOTA_TRIGGERS: TriggerCategory[] = [
  {
    name: 'System Triggers',
    description: 'System events and boot',
    triggers: [
      'system#boot',
      'system#save',
      'system#wake',
    ],
  },
  {
    name: 'Switch & Button Triggers',
    description: 'Switch and button state changes',
    triggers: [
      'Switch1#State',
      'Switch2#State',
      'Switch3#State',
      'Switch4#State',
      'Button1#State',
      'Button2#State',
      'Button3#State',
      'Button4#State',
    ],
  },
  {
    name: 'Power Triggers',
    description: 'Power/Relay state changes',
    triggers: [
      'Power1#State',
      'Power2#State',
      'Power3#State',
      'Power4#State',
      'Power5#State',
      'Power6#State',
      'Power7#State',
      'Power8#State',
    ],
  },
  {
    name: 'Time Triggers',
    description: 'Time-based triggers',
    triggers: [
      'Time#Minute',
      'Time#Hour',
      'Time#Day',
      'Time#Minute=%value%',
      'Time#Hour=%value%',
      'Time#Day=%value%',
      'Clock#Timer=1',
      'Clock#Timer=2',
      'Clock#Timer=3',
      'Clock#Timer=4',
      'Clock#Timer=5',
      'Clock#Timer=6',
      'Clock#Timer=7',
      'Clock#Timer=8',
    ],
  },
  {
    name: 'Rule Timer Triggers',
    description: 'Rule timer events',
    triggers: [
      'Rules#Timer=1',
      'Rules#Timer=2',
      'Rules#Timer=3',
      'Rules#Timer=4',
      'Rules#Timer=5',
      'Rules#Timer=6',
      'Rules#Timer=7',
      'Rules#Timer=8',
    ],
  },
  {
    name: 'RuleTimer Triggers',
    description: 'RuleTimer component triggers',
    triggers: [
      'RuleTimer1',
      'RuleTimer2',
      'RuleTimer3',
      'RuleTimer4',
      'RuleTimer5',
      'RuleTimer6',
      'RuleTimer7',
      'RuleTimer8',
    ],
  },
  {
    name: 'Event Triggers',
    description: 'Custom event triggers',
    triggers: [
      'event#name',
      'event#name=%value%',
      'event#name>%value%',
      'event#name<%value%',
    ],
  },
  {
    name: 'Telemetry Triggers',
    description: 'Telemetry sensor data (tele- prefix)',
    triggers: [
      'tele-sensor#temperature',
      'tele-sensor#humidity',
      'tele-sensor#pressure',
      'tele-sensor#illuminance',
      'tele-sensor#distance',
      'tele-sensor#motion',
      'tele-sensor#gas',
      'tele-sensor#co2',
      'tele-sensor#tvoc',
      'tele-sensor#pm25',
      'tele-sensor#pm10',
    ],
  },
  {
    name: 'Temperature Sensors',
    description: 'Temperature sensor triggers',
    triggers: [
      'DS18B20#temperature',
      'DS18B20-1#temperature',
      'DS18B20-2#temperature',
      'AM2301#temperature',
      'DHT11#temperature',
      'DHT22#temperature',
      'SI7021#temperature',
      'BME280#temperature',
      'BMP280#temperature',
      'SHT3X#temperature',
      'HTU21#temperature',
      'LM75#temperature',
      'MCP9808#temperature',
    ],
  },
  {
    name: 'Humidity Sensors',
    description: 'Humidity sensor triggers',
    triggers: [
      'AM2301#humidity',
      'DHT11#humidity',
      'DHT22#humidity',
      'SI7021#humidity',
      'BME280#humidity',
      'SHT3X#humidity',
      'HTU21#humidity',
    ],
  },
  {
    name: 'Pressure Sensors',
    description: 'Pressure sensor triggers',
    triggers: [
      'BME280#pressure',
      'BMP280#pressure',
      'BMP085#pressure',
    ],
  },
  {
    name: 'Light & Motion Sensors',
    description: 'Light and motion sensor triggers',
    triggers: [
      'APDS9960#Ambient',
      'APDS9960#Red',
      'APDS9960#Green',
      'APDS9960#Blue',
      'BH1750#Illuminance',
      'TSL2561#Illuminance',
      'TSL2591#Illuminance',
      'PIR#motion',
    ],
  },
  {
    name: 'Analog Triggers',
    description: 'Analog input triggers',
    triggers: [
      'analog#a0',
      'analog#a1',
      'analog#range',
      'analog#range1',
      'analog#range2',
    ],
  },
  {
    name: 'RF & IR Triggers',
    description: 'RF and IR receiver triggers',
    triggers: [
      'RfReceived#data',
      'IrReceived#Data',
      'IrReceived#Protocol',
      'IrReceived#Bits',
    ],
  },
  {
    name: 'Energy Monitoring',
    description: 'Energy monitoring triggers',
    triggers: [
      'ENERGY#Power',
      'ENERGY#Voltage',
      'ENERGY#Current',
      'ENERGY#ApparentPower',
      'ENERGY#ReactivePower',
      'ENERGY#Factor',
      'ENERGY#Total',
      'ENERGY#Today',
      'ENERGY#Yesterday',
      'ENERGY#PowerDelta',
    ],
  },
  {
    name: 'WiFi Triggers',
    description: 'WiFi connection events',
    triggers: [
      'WiFi#Connected',
      'WiFi#Disconnected',
    ],
  },
  {
    name: 'MQTT Triggers',
    description: 'MQTT connection events',
    triggers: [
      'Mqtt#Connected',
      'Mqtt#Disconnected',
      'Mqtt#Fail',
    ],
  },
  {
    name: 'Serial Triggers',
    description: 'Serial communication triggers',
    triggers: [
      'SerialReceived#Data',
      'SerialSend#Data',
    ],
  },
  {
    name: 'Uptime Triggers',
    description: 'Uptime-based triggers',
    triggers: [
      'Uptime#Time',
      'Uptime#Time=%value%',
    ],
  },
  {
    name: 'Tele Triggers',
    description: 'Telemetry period triggers',
    triggers: [
      'Tele#SENSOR',
      'Tele#STATE',
      'Tele#LWT',
    ],
  },
]

/**
 * Get all trigger names as a flat array
 */
export function getAllTriggers(): string[] {
  return TASMOTA_TRIGGERS.flatMap(category => category.triggers)
}

/**
 * Get triggers by category name
 */
export function getTriggersByCategory(categoryName: string): string[] {
  const category = TASMOTA_TRIGGERS.find(cat => cat.name === categoryName)
  return category ? category.triggers : []
}

/**
 * Search triggers by partial match
 */
export function searchTriggers(query: string): string[] {
  const lowerQuery = query.toLowerCase()
  return getAllTriggers().filter(trigger => 
    trigger.toLowerCase().includes(lowerQuery)
  )
}
