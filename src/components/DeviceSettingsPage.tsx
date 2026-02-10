import { useEffect, useRef, useState } from 'react'
import type { DeviceInfo, PowerChannel } from '../lib/types'
import { DeviceState } from '../DeviceState'

type Props = {
  device: DeviceInfo | null
  consoleLines: string[]
  onSendCommand: (deviceId: string, command: string, payload: string) => void
  onTogglePower?: (deviceId: string, channelId: number) => void
  onBack: () => void
}

export type SensorSection = { name: string; data: Record<string, unknown> }

function getSensorSections(deviceId: string): SensorSection[] {
  const raw = DeviceState.getRaw(deviceId)
  if (!raw) return []
  const entries = Object.entries(raw).filter(
    ([key, payload]) =>
      typeof payload === 'object' &&
      payload !== null &&
      key.startsWith('tele/') &&
      key.toUpperCase().endsWith('/SENSOR'),
  ) as [string, Record<string, unknown>][]
  if (entries.length === 0) return []
  const getTime = (p: Record<string, unknown>): number => {
    const t = p.Time
    if (typeof t !== 'string') return 0
    const ts = Date.parse(t)
    return Number.isNaN(ts) ? 0 : ts
  }
  const [, latest] = entries.reduce<[number, Record<string, unknown>]>(
    (acc, [, payload]) => {
      const t = getTime(payload)
      return t > acc[0] ? [t, payload] : acc
    },
    [0, entries[0][1]],
  )
  const sections: SensorSection[] = []
  for (const [key, value] of Object.entries(latest)) {
    if (key === 'Time' || key === 'Epoch') continue
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      sections.push({ name: key, data: value as Record<string, unknown> })
    }
  }
  return sections
}

const SENSOR_LABEL_DE: Record<string, string> = {
  Temperature: 'Temperatur',
  Humidity: 'Luftfeuchte',
  Pressure: 'Luftdruck',
  Illuminance: 'Beleuchtungsstärke',
  Distance: 'Distanz',
  Weight: 'Gewicht',
  CO2: 'CO₂',
  'PM2.5': 'Feinstaub PM2.5',
  PM10: 'Feinstaub PM10',
  Id: 'ID',
  DewPoint: 'Taupunkt',
  Battery: 'Batterie',
  Voltage: 'Spannung',
  Current: 'Strom',
  Power: 'Leistung',
  Energy: 'Energie',
  Total: 'Gesamt',
  Yesterday: 'Gestern',
  Today: 'Heute',
  Factor: 'Faktor',
  ApparentPower: 'Scheinleistung',
  ReactivePower: 'Blindleistung',
  ImportActiveEnergy: 'Bezogene Energie',
  ExportActiveEnergy: 'Gelieferte Energie',
  Light: 'Licht',
  Noise: 'Lautstärke',
  Gas: 'Gas',
  NH3: 'NH₃',
  NOx: 'NOx',
  VOC: 'VOC',
  ECO2: 'eCO₂',
  TVOC: 'TVOC',
  H2: 'H₂',
  Ethanol: 'Ethanol',
  Range: 'Reichweite',
}

const SENSOR_UNIT: Record<string, string> = {
  Temperature: '°C',
  Humidity: '%',
  Pressure: ' hPa',
  Illuminance: ' lx',
  Distance: ' cm',
  Weight: ' kg',
  CO2: ' ppm',
  'PM2.5': ' µg/m³',
  PM10: ' µg/m³',
  DewPoint: '°C',
  Voltage: ' V',
  Current: ' A',
  Power: ' W',
  Energy: ' kWh',
  ApparentPower: ' VA',
  ReactivePower: ' var',
  Light: ' lx',
  Noise: ' dB',
}

function sensorLabel(key: string): string {
  return SENSOR_LABEL_DE[key] ?? key
}

function sensorUnit(key: string): string {
  return SENSOR_UNIT[key] ?? ''
}

function formatSensorValue(value: unknown, unit = ''): string {
  if (value === null || value === undefined) return '-'
  if (typeof value === 'number') return String(value) + unit
  if (typeof value === 'string' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

const PowerIcon = ({ className }: { className?: string }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M12 2v6" />
    <path d="M6.38 4.62a9 9 0 1 0 11.24 0" />
  </svg>
)

const ChevronDown = ({ className }: { className?: string }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M6 9l6 6 6-6" />
  </svg>
)
const ChevronRight = ({ className }: { className?: string }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M9 6l6 6-6 6" />
  </svg>
)

const CONFIG_BLOCK_IDS = [
  'Power',
  'Switche',
  'Buttons',
  'WiFi',
  'MQTT',
  'Timer',
  'Optionen',
  'Sonstiges',
] as const

function ConfigBlock({
  title,
  onCollapse,
  children,
}: {
  title: string
  onCollapse?: () => void
  children?: React.ReactNode
}) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/40 overflow-hidden">
      <div className="min-h-[3rem] flex items-center justify-between gap-2 rounded-t-xl border-b border-slate-800 bg-slate-900/60 px-4 py-3 text-sm font-semibold text-slate-200">
        <span>{title}</span>
        {onCollapse && (
          <button
            type="button"
            onClick={onCollapse}
            className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
            aria-label="Bereich einklappen"
            title="Einklappen"
          >
            <ChevronDown className="h-4 w-4" />
          </button>
        )}
      </div>
      <div className="min-h-[7.5rem] p-4 text-sm text-slate-400">
        {children ?? null}
      </div>
    </div>
  )
}

/** PulseTime: 0 = aus, 1–111 = 0.1s Schritte, 112–64900 = (Wert−100) Sekunden */
function pulseTimeValueToSeconds(value: number): number {
  if (value <= 0) return 0
  if (value <= 111) return value * 0.1
  return value - 100
}

function formatPulseTimeDuration(seconds: number): string {
  if (seconds <= 0) return 'Aus (0)'
  if (seconds < 1) {
    return `${Math.round(seconds * 1000)} ms`
  }
  if (seconds < 120) {
    return `${seconds % 1 === 0 ? seconds : seconds.toFixed(1)} s`
  }
  if (seconds < 3600) {
    const min = seconds / 60
    return `${min % 1 === 0 ? min : min.toFixed(1)} min`
  }
  const h = seconds / 3600
  return `${h % 1 === 0 ? h : h.toFixed(1)} h`
}

/**
 * Schieberegler in 5 Segmenten:
 * 1) Aus (0) – kleiner Bereich
 * 2) 0,1 s–10,9 s (Wert 1–109) – kleiner Bereich
 * 3) 10 s–240 s, jede Sekunde (Wert 110–340) – großer Bereich, fein einstellbar
 * 4) 2 min–120 min, jede Minute (Wert 220, 280, …, 7300) – großer Bereich
 * 5) 2 h–18 h (Wert 7360–64900) – komprimiert
 */
const SLIDER_MAX = 1000
const SEG_A_END = 15       // pos 0–15 → Wert 0 (Aus), kleiner Bereich
const SEG_B_END = 75       // pos 15–75 → Wert 1–109 (0,1–10,9 s)
const SEG_C_END = 306      // pos 75–306 → Wert 110–340 (10–240 s, 231 Schritte)
const SEG_D_END = 425      // pos 306–425 → Minuten 2–120 (119 Werte)
// pos 425–1000 → Wert 7360–64900 (Stunden)

const SECONDS_VAL_MIN = 110   // 10 s
const SECONDS_VAL_MAX = 340   // 240 s
const MINUTES_VAL_START = 220 // 2 min = 120 s
const MINUTES_VAL_STEP = 60
const MINUTES_COUNT = 119     // 2..120
const HOURS_VAL_START = 7360  // 121 min = 7260 s → 7360
const HOURS_VAL_END = 64900

function sliderPositionToValue(position: number): number {
  if (position <= 0) return 0
  if (position >= SLIDER_MAX) return HOURS_VAL_END
  if (position < SEG_A_END) return 0
  if (position < SEG_B_END) {
    return Math.round(1 + ((position - SEG_A_END) / (SEG_B_END - SEG_A_END)) * 108)
  }
  if (position < SEG_C_END) {
    return Math.round(
      SECONDS_VAL_MIN + ((position - SEG_B_END) / (SEG_C_END - SEG_B_END)) * (SECONDS_VAL_MAX - SECONDS_VAL_MIN),
    )
  }
  if (position < SEG_D_END) {
    const t = (position - SEG_C_END) / (SEG_D_END - SEG_C_END)
    const index = Math.min(MINUTES_COUNT - 1, Math.round(t * (MINUTES_COUNT - 1)))
    return MINUTES_VAL_START + index * MINUTES_VAL_STEP
  }
  return Math.round(
    HOURS_VAL_START +
      ((position - SEG_D_END) / (SLIDER_MAX - SEG_D_END)) * (HOURS_VAL_END - HOURS_VAL_START),
  )
}

function valueToSliderPosition(value: number): number {
  if (value <= 0) return 0
  if (value >= HOURS_VAL_END) return SLIDER_MAX
  if (value <= 109) {
    return SEG_A_END + ((value - 1) / 108) * (SEG_B_END - SEG_A_END)
  }
  if (value <= SECONDS_VAL_MAX) {
    return SEG_B_END + ((value - SECONDS_VAL_MIN) / (SECONDS_VAL_MAX - SECONDS_VAL_MIN)) * (SEG_C_END - SEG_B_END)
  }
  if (value >= HOURS_VAL_START) {
    return SEG_D_END + ((value - HOURS_VAL_START) / (HOURS_VAL_END - HOURS_VAL_START)) * (SLIDER_MAX - SEG_D_END)
  }
  if (value >= MINUTES_VAL_START) {
    const index = Math.round((value - MINUTES_VAL_START) / MINUTES_VAL_STEP)
    const clamped = Math.max(0, Math.min(MINUTES_COUNT - 1, index))
    return SEG_C_END + (clamped / (MINUTES_COUNT - 1)) * (SEG_D_END - SEG_C_END)
  }
  return SEG_C_END
}

function PowerConfigContent({
  device,
  onSendCommand,
}: {
  device: DeviceInfo
  onSendCommand: (deviceId: string, command: string, payload: string) => void
}) {
  const channels = device.powerChannels ?? []
  const [selectedId, setSelectedId] = useState<number>(channels[0]?.id ?? 1)
  const [nameValue, setNameValue] = useState('')
  const [pulseTimeValue, setPulseTimeValue] = useState(0)
  const [powerOnState, setPowerOnState] = useState(3)

  const selectedChannel = channels.find((ch) => ch.id === selectedId) ?? channels[0] ?? null

  useEffect(() => {
    if (channels.length > 0 && !channels.some((ch) => ch.id === selectedId)) {
      setSelectedId(channels[0].id)
    }
  }, [channels, selectedId])

  useEffect(() => {
    if (selectedChannel) {
      setNameValue(selectedChannel.label?.trim() ? selectedChannel.label : `Power${selectedChannel.id}`)
    }
  }, [selectedChannel?.id])

  const handleSendName = () => {
    const command = `WebButton${selectedId}`
    onSendCommand(device.id, command, nameValue.trim() || `Power${selectedId}`)
  }

  const handleSendPulseTime = () => {
    const command = `PulseTime${selectedId}`
    onSendCommand(device.id, command, String(pulseTimeValue))
  }

  const handleSendPowerOnState = () => {
    onSendCommand(device.id, 'PowerOnState', String(powerOnState))
  }


  const pulseTimeSeconds = pulseTimeValueToSeconds(pulseTimeValue)
  const pulseTimeDisplay =
    pulseTimeValue === 0
      ? 'Aus (0)'
      : `${formatPulseTimeDuration(pulseTimeSeconds)} (${pulseTimeValue})`

  if (channels.length === 0) {
    return (
      <p className="text-slate-400">Keine Power-Kanäle an diesem Gerät verfügbar.</p>
    )
  }

  const statusText = selectedChannel
    ? selectedChannel.state === 'ON'
      ? 'ON (1)'
      : selectedChannel.state === 'OFF'
        ? 'OFF (0)'
        : '—'
    : '—'

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-400">Kanal</span>
          <select
            value={selectedId}
            onChange={(e) => setSelectedId(Number(e.target.value))}
            className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 focus:border-emerald-500/50 focus:outline-none focus:ring-1 focus:ring-emerald-500/30"
          >
            {channels.map((ch) => (
              <option key={ch.id} value={ch.id}>
                Power {ch.id}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-400">Status</span>
          <div className="min-w-[5rem] rounded-md border border-slate-700 bg-slate-900/80 px-3 py-2 font-mono text-slate-200">
            {statusText}
          </div>
        </label>
        <label className="flex flex-col gap-1 flex-1 min-w-[12rem]">
          <span className="text-xs font-medium text-slate-400">Name (WebButton)</span>
          <div className="flex gap-1">
            <input
              type="text"
              value={nameValue}
              onChange={(e) => setNameValue(e.target.value)}
              placeholder={`Power${selectedId}`}
              className="flex-1 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 placeholder:text-slate-500 focus:border-emerald-500/50 focus:outline-none focus:ring-1 focus:ring-emerald-500/30"
            />
            <button
              type="button"
              onClick={handleSendName}
              className="rounded-md border border-slate-700 bg-slate-800 p-2 text-slate-300 hover:bg-slate-700 hover:text-slate-200"
              title="Name an Gerät senden (WebButton)"
              aria-label="Name an Gerät senden"
            >
              <svg
                className="h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
                <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
                <path d="M16 21h5v-5" />
              </svg>
            </button>
          </div>
        </label>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1 flex-1 min-w-[12rem]">
          <span className="text-xs font-medium text-slate-400">PulseTime</span>
          <div className="flex gap-3 items-center">
            <input
              type="range"
              min={0}
              max={SLIDER_MAX}
              value={valueToSliderPosition(pulseTimeValue)}
              onChange={(e) => setPulseTimeValue(sliderPositionToValue(Number(e.target.value)))}
              className="flex-1 h-2 rounded-lg appearance-none bg-slate-700 accent-emerald-500"
            />
            <div
              className="min-w-[7rem] rounded-md border border-slate-700 bg-slate-900/80 px-3 py-2 font-mono text-slate-200 text-right tabular-nums"
              aria-live="polite"
            >
              {pulseTimeDisplay}
            </div>
            <button
              type="button"
              onClick={handleSendPulseTime}
              className="rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-300 hover:bg-slate-700 hover:text-slate-200 shrink-0"
              title="PulseTime an Gerät senden"
            >
              Senden
            </button>
          </div>
        </label>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-400">PowerOnState</span>
          <div className="flex gap-2 items-center">
            <select
              value={powerOnState}
              onChange={(e) => setPowerOnState(Number(e.target.value))}
              className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 focus:border-emerald-500/50 focus:outline-none focus:ring-1 focus:ring-emerald-500/30 min-w-[18rem]"
            >
              <option value={0}>0 / OFF – nach Neustart aus lassen</option>
              <option value={1}>1 / ON – nach Neustart einschalten</option>
              <option value={2}>2 / TOGGLE – von letztem Zustand umschalten</option>
              <option value={3}>3 – letzter gespeicherter Zustand (Standard)</option>
              <option value={4}>4 – einschalten, weitere Steuerung deaktivieren</option>
              <option value={5}>5 – nach PulseTime einschalten (invertierter PulseTime)</option>
            </select>
            <button
              type="button"
              onClick={handleSendPowerOnState}
              className="rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-300 hover:bg-slate-700 hover:text-slate-200 shrink-0"
              title="PowerOnState an Gerät senden"
            >
              Senden
            </button>
          </div>
        </label>
      </div>
    </div>
  )
}

function PowerChannelsBlock({
  deviceId,
  channels,
  onTogglePower,
  onCollapse,
}: {
  deviceId: string
  channels: PowerChannel[]
  onTogglePower: (deviceId: string, channelId: number) => void
  onCollapse?: () => void
}) {
  const n = channels.length
  const gridClass =
    n <= 1
      ? 'grid grid-cols-1 gap-3'
      : n <= 2
        ? 'grid grid-cols-2 gap-3'
        : n <= 4
          ? 'grid grid-cols-2 gap-2'
          : n <= 8
            ? 'grid grid-cols-4 gap-2'
            : 'grid grid-cols-4 gap-1.5'
  const paddingClass =
    n <= 1 ? 'p-8' : n <= 2 ? 'px-2 py-8' : 'p-4'
  const iconClass =
    n <= 1 ? 'h-10 w-10' : n <= 2 ? 'h-10 w-10' : n <= 4 ? 'h-7 w-7' : n <= 8 ? 'h-6 w-6' : 'h-5 w-5'
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/40 overflow-hidden">
      <div className="min-h-[3rem] flex items-center justify-between gap-2 rounded-t-xl border-b border-slate-800 bg-slate-900/60 px-4 py-3 text-sm font-semibold text-slate-200">
        <span>Schaltkanäle</span>
        {onCollapse && (
          <button
            type="button"
            onClick={onCollapse}
            className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
            aria-label="Bereich einklappen"
            title="Einklappen"
          >
            <ChevronDown className="h-4 w-4" />
          </button>
        )}
      </div>
      <div className={n <= 1 ? 'flex justify-center items-center p-8' : paddingClass}>
        <div className={n <= 1 ? 'w-1/2 max-w-[8rem] grid grid-cols-1 gap-3' : gridClass}>
          {channels.map((channel) => {
            const active = channel.state === 'ON'
            const title = channel.label?.trim() ? channel.label : `Power${channel.id}`
            return (
              <button
                key={channel.id}
                type="button"
                onClick={() => onTogglePower(deviceId, channel.id)}
                className={`flex aspect-square w-full items-center justify-center rounded-md border font-semibold transition-colors hover:bg-slate-800 ${
                  active
                    ? 'border-amber-400/50 bg-amber-400/10 text-amber-300'
                    : 'border-slate-700 text-slate-200'
                }`}
                aria-pressed={active}
                aria-label={title}
                title={title}
              >
                <PowerIcon className={iconClass} />
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function SensorBlock({
  section,
  onCollapse,
}: {
  section: SensorSection
  onCollapse?: () => void
}) {
  const entries = Object.entries(section.data).filter(
    ([, v]) => v !== null && v !== undefined && (typeof v !== 'object' || Array.isArray(v)),
  )
  const nested = Object.entries(section.data).filter(
    ([, v]) => v !== null && typeof v === 'object' && !Array.isArray(v),
  )
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/40 overflow-hidden">
      <div className="min-h-[3rem] flex items-center justify-between gap-2 rounded-t-xl border-b border-slate-800 bg-slate-900/60 px-4 py-3 text-sm font-semibold text-slate-200">
        <span>{section.name}</span>
        {onCollapse && (
          <button
            type="button"
            onClick={onCollapse}
            className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
            aria-label="Bereich einklappen"
            title="Einklappen"
          >
            <ChevronDown className="h-4 w-4" />
          </button>
        )}
      </div>
      <div className="space-y-1 p-4 text-sm">
        {entries.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4 text-slate-200">
            <span className="text-slate-400">{sensorLabel(k)}</span>
            <span className="text-slate-100 tabular-nums">{formatSensorValue(v, sensorUnit(k))}</span>
          </div>
        ))}
        {nested.map(([key, val]) => (
          <details key={key} className="rounded border border-slate-800/60">
            <summary className="cursor-pointer py-1 text-slate-300">{sensorLabel(key)}</summary>
            <div className="ml-2 mt-1 space-y-1 border-l border-slate-700 pl-2">
              {Object.entries(val as Record<string, unknown>).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-2 text-xs">
                  <span className="text-slate-400">{sensorLabel(k)}</span>
                  <span className="text-slate-200 tabular-nums">{formatSensorValue(v, sensorUnit(k))}</span>
                </div>
              ))}
            </div>
          </details>
        ))}
      </div>
    </div>
  )
}

const TelemetryConsole = ({ lines }: { lines: string[] }) => {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [autoScroll, setAutoScroll] = useState(true)

  useEffect(() => {
    if (!autoScroll) return
    const el = containerRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [lines, autoScroll])

  const handleScroll = () => {
    const el = containerRef.current
    if (!el) return
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight
    setAutoScroll(distance < 12)
  }

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="telemetry-scroll h-40 w-full overflow-auto whitespace-pre rounded-md border border-slate-800 bg-slate-950/50 p-2 font-mono text-xs text-emerald-300"
    >
      {lines.length === 0 ? 'Keine Daten empfangen.' : lines.join('\n')}
    </div>
  )
}

export default function DeviceSettingsPage({
  device,
  consoleLines,
  onSendCommand,
  onTogglePower,
  onBack,
}: Props) {
  const [inputValue, setInputValue] = useState('')
  const consoleExpanded = device?.settingsUi?.consoleExpanded ?? true
  const collapsedBlockIds = new Set(device?.settingsUi?.collapsedBlockIds ?? [])

  const setConsoleExpanded = (value: boolean) => {
    if (device) DeviceState.updateSettingsUi(device.id, { consoleExpanded: value })
  }
  const setCollapsed = (id: string, collapsed: boolean) => {
    if (!device) return
    const next = new Set(collapsedBlockIds)
    if (collapsed) next.add(id)
    else next.delete(id)
    DeviceState.updateSettingsUi(device.id, { collapsedBlockIds: Array.from(next) })
  }

  const handleSubmit = () => {
    const trimmed = inputValue.trim()
    if (!trimmed || !device) return
    const spaceIndex = trimmed.indexOf(' ')
    const command = spaceIndex >= 0 ? trimmed.slice(0, spaceIndex) : trimmed
    const payload = spaceIndex >= 0 ? trimmed.slice(spaceIndex + 1).trim() : ''
    if (command) {
      onSendCommand(device.id, command, payload)
      setInputValue('')
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-white">
          Einstellungen - {device?.name ?? 'Unbekannt'}
        </h2>
        <button
          type="button"
          onClick={onBack}
          className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800"
        >
          Zurück
        </button>
      </div>

      {device ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2 rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-sm text-slate-200 md:grid-cols-3">
            <div>
              <span className="text-slate-400">Topic:</span> {device.topic || device.id}
            </div>
            <div>
              <span className="text-slate-400">Modul:</span> {device.module || '-'}
            </div>
            <div>
              <span className="text-slate-400">Firmware:</span> {device.firmware || '-'}
            </div>
            <div>
              <span className="text-slate-400">Uptime:</span> {device.uptime || '-'}
            </div>
            <div>
              <span className="text-slate-400">LWT:</span>{' '}
              <span
                className={
                  device.online === true
                    ? 'text-emerald-300'
                    : device.online === false
                      ? 'text-rose-300'
                      : 'text-slate-300'
                }
              >
                {device.online === true ? 'Online' : device.online === false ? 'Offline' : 'Unbekannt'}
              </span>
            </div>
            <div>
              <span className="text-slate-400">IP-Adresse:</span>{' '}
              {device.ip ? (
                <a
                  className="text-emerald-300 hover:text-emerald-200"
                  href={`http://${device.ip}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {device.ip}
                </a>
              ) : (
                '-'
              )}
            </div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-950/40 overflow-hidden p-4">
            <button
              type="button"
              onClick={() => setConsoleExpanded(!consoleExpanded)}
              className="-mx-4 -mt-4 mb-3 flex min-h-[3rem] w-[calc(100%+2rem)] items-center justify-between rounded-t-xl border-b border-slate-800 bg-slate-900/60 px-4 py-3 text-sm font-semibold text-slate-200 hover:bg-slate-800/60 transition-colors"
            >
              <span>Konsole</span>
              <span
                className={`inline-flex h-5 w-5 items-center justify-center text-slate-400 transition-transform ${
                  consoleExpanded ? 'rotate-180' : ''
                }`}
                aria-hidden
              >
                <svg
                  className="h-4 w-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </span>
            </button>

            {consoleExpanded && (
              <div className="space-y-4">
                <div>
                  <TelemetryConsole lines={consoleLines} />
                </div>

                <div>
                  <label htmlFor="device-cmd-input" className="mb-2 block text-xs font-semibold text-slate-400">
                    Befehl senden (z. B. PulseTime1 200)
                  </label>
                  <div className="flex gap-2">
                    <input
                      id="device-cmd-input"
                      type="text"
                      value={inputValue}
                      onChange={(e) => setInputValue(e.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder={`Befehl für ${device.topic || device.id}...`}
                      className="flex-1 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-sm text-slate-100 placeholder:text-slate-500 focus:border-emerald-500/50 focus:outline-none focus:ring-1 focus:ring-emerald-500/30"
                    />
                    <button
                      type="button"
                      onClick={handleSubmit}
                      disabled={!inputValue.trim()}
                      className="rounded-md border border-slate-700 bg-slate-800 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Senden
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {(() => {
            const sections = device ? getSensorSections(device.id) : []
            const hasPower =
              device?.powerChannels && device.powerChannels.length > 0 && onTogglePower

            type BlockItem =
              | { id: string; title: string; type: 'sensor'; section: SensorSection }
              | {
                  id: string
                  title: string
                  type: 'power'
                  deviceId: string
                  channels: PowerChannel[]
                }
              | { id: string; title: string; type: 'config' }
            const blockList: BlockItem[] = [
              ...sections.map((section) => ({
                id: `sensor-${section.name}`,
                title: section.name,
                type: 'sensor' as const,
                section,
              })),
              ...(hasPower && device
                ? [
                    {
                      id: 'power',
                      title: 'Schaltkanäle',
                      type: 'power' as const,
                      deviceId: device.id,
                      channels: device.powerChannels!,
                    },
                  ]
                : []),
              ...CONFIG_BLOCK_IDS.map((id) => ({ id, title: id, type: 'config' as const })),
            ]

            const collapsedList = blockList.filter((b) => collapsedBlockIds.has(b.id))
            const expandedList = blockList.filter((b) => !collapsedBlockIds.has(b.id))
            const expandedGridBlocks = expandedList.filter(
              (b): b is BlockItem & { type: 'sensor' | 'power' } =>
                b.type === 'sensor' || b.type === 'power',
            )
            const expandedConfigBlocks = expandedList.filter(
              (b): b is BlockItem & { type: 'config' } => b.type === 'config',
            )

            return (
              <div className="flex gap-4 items-start transition-[gap] duration-200 ease-out">
                {collapsedList.length > 0 && (
                  <div
                    className="device-settings-collapsed-column flex flex-col gap-2 shrink-0 w-10"
                    role="list"
                    aria-label="Eingeklappte Bereiche"
                  >
                    {collapsedList.map((block) => (
                      <button
                        key={block.id}
                        type="button"
                        onClick={() => setCollapsed(block.id, false)}
                        className="device-settings-collapsed-item flex flex-col items-center gap-1 rounded-lg border border-slate-700 bg-slate-900/80 px-1.5 py-2 text-slate-300 hover:bg-slate-800 hover:text-slate-200 hover:border-slate-600 min-h-[4rem] transition-colors duration-150"
                        title={block.title}
                        aria-label={`${block.title} aufklappen`}
                      >
                        <span
                          className="text-xs font-medium truncate max-w-full text-center leading-tight"
                          style={{ writingMode: 'vertical-rl', textOrientation: 'mixed' }}
                        >
                          {block.title}
                        </span>
                        <ChevronRight className="h-4 w-4 shrink-0" />
                      </button>
                    ))}
                  </div>
                )}
                <div className="flex-1 min-w-0 flex flex-col gap-4">
                  {expandedGridBlocks.length > 0 && (
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      {expandedGridBlocks.map((block) => (
                        <div key={block.id} className="device-settings-expanded-item min-w-0">
                          {block.type === 'sensor' ? (
                            <SensorBlock
                              section={block.section}
                              onCollapse={() => setCollapsed(block.id, true)}
                            />
                          ) : (
                            <PowerChannelsBlock
                              deviceId={block.deviceId}
                              channels={block.channels}
                              onTogglePower={onTogglePower!}
                              onCollapse={() => setCollapsed(block.id, true)}
                            />
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {expandedConfigBlocks.length > 0 && (
                    <div className="space-y-4 w-full">
                      {expandedConfigBlocks.map((block) => (
                        <div key={block.id} className="device-settings-expanded-item w-full">
                          <ConfigBlock
                            title={block.title}
                            onCollapse={() => setCollapsed(block.id, true)}
                          >
                            {block.id === 'Power' && device ? (
                              <PowerConfigContent
                                device={device}
                                onSendCommand={onSendCommand}
                              />
                            ) : null}
                          </ConfigBlock>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )
          })()}
        </div>
      ) : (
        <p className="text-sm text-slate-400">Gerät nicht gefunden.</p>
      )}
    </div>
  )
}
