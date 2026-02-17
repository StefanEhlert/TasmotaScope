import { createPortal } from 'react-dom'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { DeviceInfo, PowerChannel } from '../lib/types'
import type { BlakadderListItem } from '../lib/backendClient'
import { getBlakadderList } from '../lib/backendClient'
import { DeviceState } from '../DeviceState'
import { getAvailableSwitches } from '../lib/deviceComponents'
import { getGpioAssignments, getButtonNumbersFromGpioArray } from '../lib/gpioComponents'
import { SWITCH_MODE_OPTIONS, getSwitchModeOption } from '../lib/SwitchMode'
import {
  TASMOTA_WEBUI_THEMES,
  getStoredWebColorArray,
  findThemeIndexByStoredArray,
} from '../lib/tasmotaWebUiThemes'

type Props = {
  device: DeviceInfo | null
  /** Alle Geräte (für Standort-/Raum-Dropdown-Optionen). */
  allDevices?: Record<string, DeviceInfo>
  consoleLines: string[]
  onSendCommand: (deviceId: string, command: string, payload: string) => void
  onTogglePower?: (deviceId: string, channelId: number) => void
  onBackup?: (deviceId: string) => void
  /** Lädt Backup-Daten vom Backend (wenn item.data fehlt). */
  onDownloadBackup?: (deviceId: string, brokerId: string | undefined, index: number) => Promise<string>
  onDeleteBackup?: (deviceId: string, index: number) => void
  onUpdateAutoBackup?: (deviceId: string, intervalDays: number | null) => void
  backingUp?: Record<string, boolean>
  backendAvailable?: boolean
  onBack: () => void
  /** Wird aufgerufen, wenn der Nutzer einen Gerätetyp speichert (damit App veraltete Backend-Daten nicht überschreibt). */
  onDeviceTypeApplied?: (deviceId: string, value: string | undefined) => void
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

function formatBackupDate(isoString: string): string {
  try {
    const d = new Date(isoString)
    if (Number.isNaN(d.getTime())) return isoString
    return d.toLocaleDateString(undefined, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return isoString
  }
}

function getBackupFileName(deviceId: string, createdAt: string): string {
  const datePart = createdAt.slice(0, 10)
  return `tasmota-backup-${deviceId}-${datePart}.dmp`
}

function downloadBackupFile(base64Data: string, deviceId: string, createdAt: string): void {
  try {
    const binary = atob(base64Data)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    const blob = new Blob([bytes])
    const url = URL.createObjectURL(blob)
    const filename = getBackupFileName(deviceId, createdAt)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  } catch (err) {
    console.error('Backup-Download fehlgeschlagen:', err)
  }
}

const DownloadIcon = ({ className }: { className?: string }) => (
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
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
)

const TrashIcon = ({ className }: { className?: string }) => (
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
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <line x1="10" y1="11" x2="10" y2="17" />
    <line x1="14" y1="11" x2="14" y2="17" />
  </svg>
)

function BackupBlock({
  device,
  onCollapse,
  onDeleteBackup,
  onDownloadBackup,
  onUpdateAutoBackup,
  onBackup,
  backingUp = {},
  backendAvailable = false,
}: {
  device: DeviceInfo
  onCollapse: () => void
  onDeleteBackup?: (deviceId: string, index: number) => void
  onDownloadBackup?: (deviceId: string, brokerId: string | undefined, index: number) => Promise<string>
  onUpdateAutoBackup?: (deviceId: string, intervalDays: number | null) => void
  onBackup?: (deviceId: string) => void
  backingUp?: Record<string, boolean>
  backendAvailable?: boolean
}) {
  const [downloadingIndex, setDownloadingIndex] = useState<number | null>(null)
  const canBackup =
    backendAvailable && !!device.ip && device.online === true && !backingUp[device.id]
  const days = device.daysSinceBackup
  const count = device.backupCount ?? 0
  const items = device.backupItems ?? []
  const DEFAULT_AUTO_BACKUP_DAYS = 100
  const enabledFromDevice =
    device.autoBackupIntervalDays != null && device.autoBackupIntervalDays > 0
  const [autoBackupEnabled, setAutoBackupEnabled] = useState(enabledFromDevice)
  const deviceDays =
    device.autoBackupIntervalDays != null
      ? Math.max(1, Math.min(365, device.autoBackupIntervalDays))
      : DEFAULT_AUTO_BACKUP_DAYS
  const [inputDays, setInputDays] = useState(String(deviceDays))
  useEffect(() => {
    setAutoBackupEnabled(enabledFromDevice)
  }, [enabledFromDevice])
  useEffect(() => {
    setInputDays(String(deviceDays))
  }, [deviceDays])
  const parsedDays = (() => {
    const v = parseInt(inputDays, 10)
    return Number.isNaN(v) || v < 1 || v > 365
      ? DEFAULT_AUTO_BACKUP_DAYS
      : Math.max(1, Math.min(365, v))
  })()
  const statusColor =
    days == null || days >= 100
      ? 'text-rose-400'
      : days >= 50
        ? 'text-blue-400'
        : 'text-emerald-400'

  return (
    <ConfigBlock title="Backup" onCollapse={onCollapse}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-stretch">
          <div className="w-full min-w-0 max-w-full space-y-3 sm:max-w-[50%]">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-slate-400">Letztes Backup:</span>
            <span className={statusColor}>
              {days != null
                ? days >= 100
                  ? 'Nie / sehr lange her'
                  : `vor ${days} Tag${days !== 1 ? 'en' : ''}`
                : 'Noch kein Backup'}
            </span>
            <span className="text-slate-500">·</span>
            <span className="text-slate-200">{count}/10</span>
          </div>
          {items.length > 0 && (
            <ul className="w-full list-none space-y-1.5 rounded-md border border-slate-800 bg-slate-900/40 p-2">
              {items.map((item, index) => {
                const fileName = getBackupFileName(device.id, item.createdAt)
                return (
                  <li
                    key={item.createdAt + index}
                    className="flex min-w-0 items-center justify-between gap-2 text-sm"
                  >
                    <span className="shrink-0 text-slate-300">
                      {formatBackupDate(item.createdAt)}
                    </span>
                    <span
                      className="min-w-0 flex-1 truncate text-slate-400"
                      title={fileName}
                    >
                      {fileName}
                    </span>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        disabled={downloadingIndex === index}
                        onClick={async () => {
                          if (typeof item.data === 'string') {
                            downloadBackupFile(item.data, device.id, item.createdAt)
                            return
                          }
                          if (!onDownloadBackup) return
                          setDownloadingIndex(index)
                          try {
                            const data = await onDownloadBackup(device.id, device.brokerId, index)
                            downloadBackupFile(data, device.id, item.createdAt)
                          } catch (err) {
                            console.error('Backup-Download fehlgeschlagen:', err)
                            alert(`Download fehlgeschlagen: ${err instanceof Error ? err.message : 'Unbekannter Fehler'}`)
                          } finally {
                            setDownloadingIndex(null)
                          }
                        }}
                        className="rounded p-1.5 text-slate-400 hover:bg-slate-700 hover:text-slate-200 disabled:opacity-50"
                        title="Backup-Datei herunterladen"
                        aria-label="Herunterladen"
                      >
                        <DownloadIcon className="h-4 w-4" />
                      </button>
                      {onDeleteBackup && (
                        <button
                          type="button"
                          onClick={() => onDeleteBackup(device.id, index)}
                          className="rounded p-1.5 text-slate-400 hover:bg-slate-700 hover:text-rose-400"
                          title="Backup löschen"
                          aria-label="Löschen"
                        >
                          <TrashIcon className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
          </div>

          {onUpdateAutoBackup && (
          <div className="flex w-full min-w-0 max-w-full flex-col gap-3 sm:max-w-[50%]">
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <span className="text-slate-400">Optionen</span>
            </div>
            <div className="rounded-md border border-slate-800 bg-slate-900/40 p-4 shrink-0">
              <h4 className="text-sm font-semibold text-slate-200">
                Automatisches Backup
              </h4>
              <p className="mt-1 text-xs text-slate-400">
                Sobald das letzte Backup älter als die gewählte Anzahl Tage ist, wird
                automatisch ein neues Backup erstellt (Backend prüft alle 24 Stunden).
              </p>
              <label className="mt-3 flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={autoBackupEnabled}
                onChange={(e) => {
                  const checked = e.target.checked
                  setAutoBackupEnabled(checked)
                  onUpdateAutoBackup(device.id, checked ? parsedDays : null)
                }}
                className="h-4 w-4 shrink-0 rounded border-slate-600 bg-slate-800 text-emerald-500 focus:ring-emerald-500/50"
              />
              <span className="text-sm text-slate-300">Aktivieren</span>
            </label>
            {autoBackupEnabled && (
              <div className="mt-2 flex items-center gap-2">
                <label htmlFor="auto-backup-days" className="text-sm text-slate-400">
                  Alle
                </label>
                <input
                  id="auto-backup-days"
                  type="number"
                  min={1}
                  max={365}
                  value={inputDays}
                  onChange={(e) => setInputDays(e.target.value)}
                  onBlur={() => {
                    const v = Math.max(1, Math.min(365, parsedDays))
                    setInputDays(String(v))
                    onUpdateAutoBackup(device.id, v)
                  }}
                  className="w-16 rounded border border-slate-700 bg-slate-800 px-2 py-1 text-sm text-slate-200"
                />
                <span className="text-sm text-slate-400">Tage</span>
              </div>
            )}
            </div>
            {onBackup && (
              <div className="flex min-h-[2.5rem] min-w-0 flex-1 flex-col justify-end pt-3">
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => onBackup(device.id)}
                    disabled={!canBackup}
                    className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                    title={
                      !device.ip
                        ? 'Backup benötigt Gerät-IP'
                        : device.online !== true
                          ? 'Backup nur bei LWT Online möglich'
                          : !backendAvailable
                            ? 'Backend nicht verfügbar'
                            : backingUp[device.id]
                              ? 'Backup läuft…'
                              : 'Aktuelles Backup erstellen'
                    }
                  >
                    {backingUp[device.id] ? 'Backup läuft…' : 'Aktuelles Backup erstellen'}
                  </button>
                </div>
              </div>
            )}
          </div>
          )}
        </div>
      </div>
    </ConfigBlock>
  )
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

function formatSwitchState(value: unknown): string {
  if (value === undefined || value === null) return '—'
  if (typeof value === 'string') {
    const u = value.trim().toUpperCase()
    if (u === 'ON' || u === '1') return 'ON'
    if (u === 'OFF' || u === '0') return 'OFF'
    return value
  }
  if (typeof value === 'number') return value === 1 ? 'ON' : value === 0 ? 'OFF' : String(value)
  if (typeof value === 'boolean') return value ? 'ON' : 'OFF'
  return String(value)
}

const WIFI_PASSWORD_STORAGE_KEY = 'tasmotascope:wifi:password'

function getStoredWifiPassword(deviceId: string, slot: 1 | 2): string {
  try {
    const raw = localStorage.getItem(`${WIFI_PASSWORD_STORAGE_KEY}:${deviceId}:${slot}`)
    return typeof raw === 'string' ? raw : ''
  } catch {
    return ''
  }
}

function setStoredWifiPassword(deviceId: string, slot: 1 | 2, value: string): void {
  try {
    if (value) {
      localStorage.setItem(`${WIFI_PASSWORD_STORAGE_KEY}:${deviceId}:${slot}`, value)
    } else {
      localStorage.removeItem(`${WIFI_PASSWORD_STORAGE_KEY}:${deviceId}:${slot}`)
    }
  } catch {
    // localStorage voll oder nicht verfügbar
  }
}

function WiFiConfigContent({
  device,
  onSendCommand,
  storeTick,
}: {
  device: DeviceInfo
  onSendCommand: (deviceId: string, command: string, payload: string) => void
  storeTick?: number
}) {
  const properties = DeviceState.getProperties(device.id)
  const requestedWifiRef = useRef<string | null>(null)
  const onSendCommandRef = useRef(onSendCommand)
  onSendCommandRef.current = onSendCommand
  const [ssid1Value, setSsid1Value] = useState('')
  const [ssid2Value, setSsid2Value] = useState('')
  const [password1Value, setPassword1Value] = useState('')
  const [password2Value, setPassword2Value] = useState('')
  const [showPassword1, setShowPassword1] = useState(false)
  const [showPassword2, setShowPassword2] = useState(false)
  const ssid1FocusedRef = useRef(false)
  const ssid2FocusedRef = useRef(false)
  const requestedSetOption53Ref = useRef<string | null>(null)
  const requestedSetOption56Ref = useRef<string | null>(null)
  const requestedSetOption142Ref = useRef<string | null>(null)
  const [setOption53, setSetOption53] = useState<'ON' | 'OFF'>('OFF')
  const [setOption56, setSetOption56] = useState<'ON' | 'OFF'>('OFF')
  const [setOption142, setSetOption142] = useState<'ON' | 'OFF'>('OFF')

  useEffect(() => {
    if (!device?.id) return
    if (requestedWifiRef.current === device.id) return
    requestedWifiRef.current = device.id
    const send = onSendCommandRef.current
    send(device.id, 'SSID1', '')
    send(device.id, 'SSID2', '')
  }, [device?.id])

  useEffect(() => {
    if (!device?.id) return
    if (requestedSetOption53Ref.current === device.id) return
    requestedSetOption53Ref.current = device.id
    onSendCommandRef.current(device.id, 'SetOption53', '')
  }, [device?.id])

  useEffect(() => {
    if (!device?.id) return
    if (requestedSetOption56Ref.current === device.id) return
    requestedSetOption56Ref.current = device.id
    onSendCommandRef.current(device.id, 'SetOption56', '')
  }, [device?.id])

  useEffect(() => {
    if (!device?.id) return
    if (requestedSetOption142Ref.current === device.id) return
    requestedSetOption142Ref.current = device.id
    onSendCommandRef.current(device.id, 'SetOption142', '')
  }, [device?.id])

  useEffect(() => {
    if (!device?.id) return
    setPassword1Value(getStoredWifiPassword(device.id, 1))
    setPassword2Value(getStoredWifiPassword(device.id, 2))
  }, [device?.id])

  const raw = DeviceState.getRaw(device.id) as Record<string, unknown> | null | undefined
  const result = raw?.['stat/RESULT'] as Record<string, unknown> | undefined
  const getFromObject = (obj: Record<string, unknown> | undefined, key: string): string => {
    if (!obj) return ''
    const exact = obj[key]
    if (typeof exact === 'string') return exact
    if (exact != null) return String(exact)
    const keyLower = key.toLowerCase()
    const entry = Object.entries(obj).find(([k]) => k.toLowerCase() === keyLower)
    if (entry) return typeof entry[1] === 'string' ? entry[1] : entry[1] != null ? String(entry[1]) : ''
    return ''
  }
  const get = (key: string): string => {
    const fromProps = getFromObject(properties as Record<string, unknown>, key)
    if (fromProps) return fromProps
    const fromResult = getFromObject(result, key)
    if (fromResult) return fromResult
    const topicKey = `stat/${key}`
    const fromTopic = raw?.[topicKey] as Record<string, unknown> | undefined
    return getFromObject(fromTopic, key)
  }

  const ssid1FromStore = get('SSID1')
  const ssid2FromStore = get('SSID2')
  useEffect(() => {
    if (!ssid1FocusedRef.current) setSsid1Value(ssid1FromStore)
  }, [ssid1FromStore, storeTick])
  useEffect(() => {
    if (!ssid2FocusedRef.current) setSsid2Value(ssid2FromStore)
  }, [ssid2FromStore, storeTick])

  const handleSsid1Blur = () => {
    ssid1FocusedRef.current = false
    onSendCommandRef.current(device.id, 'SSID1', ssid1Value.trim())
  }
  const handleSsid2Blur = () => {
    ssid2FocusedRef.current = false
    onSendCommandRef.current(device.id, 'SSID2', ssid2Value.trim())
  }
  const handlePassword1Blur = () => {
    onSendCommandRef.current(device.id, 'Password1', password1Value)
    setStoredWifiPassword(device.id, 1, password1Value)
  }
  const handlePassword2Blur = () => {
    onSendCommandRef.current(device.id, 'Password2', password2Value)
    setStoredWifiPassword(device.id, 2, password2Value)
  }

  const setOption53FromStore = ((): 'ON' | 'OFF' | undefined => {
    const v = properties?.SetOption53
    if (typeof v === 'string') {
      const u = v.trim().toUpperCase()
      if (u === 'ON' || u === 'OFF') return u
    }
    const fromResult = result?.SetOption53
    if (typeof fromResult === 'string') {
      const u = String(fromResult).trim().toUpperCase()
      if (u === 'ON' || u === 'OFF') return u
    }
    if (fromResult !== undefined && fromResult !== null) return fromResult === 1 || fromResult === true ? 'ON' : 'OFF'
    return undefined
  })()
  useEffect(() => {
    if (setOption53FromStore !== undefined) setSetOption53(setOption53FromStore)
  }, [setOption53FromStore, storeTick])

  const handleSetOption53Change = (value: 'ON' | 'OFF') => {
    setSetOption53(value)
    onSendCommandRef.current(device.id, 'SetOption53', value)
  }

  const setOption56FromStore = ((): 'ON' | 'OFF' | undefined => {
    const v = properties?.SetOption56
    if (typeof v === 'string') {
      const u = v.trim().toUpperCase()
      if (u === 'ON' || u === 'OFF') return u
    }
    const fromResult = result?.SetOption56
    if (typeof fromResult === 'string') {
      const u = String(fromResult).trim().toUpperCase()
      if (u === 'ON' || u === 'OFF') return u
    }
    if (fromResult !== undefined && fromResult !== null) return fromResult === 1 || fromResult === true ? 'ON' : 'OFF'
    return undefined
  })()
  useEffect(() => {
    if (setOption56FromStore !== undefined) setSetOption56(setOption56FromStore)
  }, [setOption56FromStore, storeTick])

  const handleSetOption56Change = (value: 'ON' | 'OFF') => {
    setSetOption56(value)
    onSendCommandRef.current(device.id, 'SetOption56', value)
  }

  const setOption142FromStore = ((): 'ON' | 'OFF' | undefined => {
    const v = properties?.SetOption142
    if (typeof v === 'string') {
      const u = v.trim().toUpperCase()
      if (u === 'ON' || u === 'OFF') return u
    }
    const fromResult = result?.SetOption142
    if (typeof fromResult === 'string') {
      const u = String(fromResult).trim().toUpperCase()
      if (u === 'ON' || u === 'OFF') return u
    }
    if (fromResult !== undefined && fromResult !== null) return fromResult === 1 || fromResult === true ? 'ON' : 'OFF'
    return undefined
  })()
  useEffect(() => {
    if (setOption142FromStore !== undefined) setSetOption142(setOption142FromStore)
  }, [setOption142FromStore, storeTick])

  const handleSetOption142Change = (value: 'ON' | 'OFF') => {
    setSetOption142(value)
    onSendCommandRef.current(device.id, 'SetOption142', value)
  }

  const inputClass = 'min-h-[2.5rem] w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-slate-100 placeholder:text-slate-500 focus:border-emerald-500/50 focus:outline-none focus:ring-1 focus:ring-emerald-500/30'

  return (
    <div className="flex w-full gap-4">
      <div className="w-1/2 min-w-0">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-400">SSID 1</span>
          <input
            type="text"
            autoComplete="off"
            value={ssid1Value}
            onChange={(e) => setSsid1Value(e.target.value)}
            onFocus={() => { ssid1FocusedRef.current = true }}
            onBlur={handleSsid1Blur}
            className={inputClass}
          />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-400">Passwort 1</span>
          <div className="flex min-h-[2.5rem] items-center gap-1 rounded-md border border-slate-700 bg-slate-900">
            <input
              type={showPassword1 ? 'text' : 'password'}
              autoComplete="new-password"
              value={password1Value}
              onChange={(e) => setPassword1Value(e.target.value)}
              onBlur={handlePassword1Blur}
              placeholder="Nur setzbar, nicht lesbar"
              className="flex-1 min-w-0 rounded-md border-0 bg-transparent px-3 py-2 font-mono text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-0"
            />
            <button
              type="button"
              onClick={() => setShowPassword1((v) => !v)}
              className="shrink-0 px-2 py-2 text-slate-400 hover:text-slate-200"
              title={showPassword1 ? 'Passwort verbergen' : 'Passwort anzeigen'}
              aria-label={showPassword1 ? 'Passwort verbergen' : 'Passwort anzeigen'}
            >
              {showPassword1 ? (
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                  <line x1="1" y1="1" x2="23" y2="23" />
                </svg>
              ) : (
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              )}
            </button>
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-400">SSID 2</span>
          <input
            type="text"
            autoComplete="off"
            value={ssid2Value}
            onChange={(e) => setSsid2Value(e.target.value)}
            onFocus={() => { ssid2FocusedRef.current = true }}
            onBlur={handleSsid2Blur}
            className={inputClass}
          />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-400">Passwort 2</span>
          <div className="flex min-h-[2.5rem] items-center gap-1 rounded-md border border-slate-700 bg-slate-900">
            <input
              type={showPassword2 ? 'text' : 'password'}
              autoComplete="new-password"
              value={password2Value}
              onChange={(e) => setPassword2Value(e.target.value)}
              onBlur={handlePassword2Blur}
              placeholder="Nur setzbar, nicht lesbar"
              className="flex-1 min-w-0 rounded-md border-0 bg-transparent px-3 py-2 font-mono text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-0"
            />
            <button
              type="button"
              onClick={() => setShowPassword2((v) => !v)}
              className="shrink-0 px-2 py-2 text-slate-400 hover:text-slate-200"
              title={showPassword2 ? 'Passwort verbergen' : 'Passwort anzeigen'}
              aria-label={showPassword2 ? 'Passwort verbergen' : 'Passwort anzeigen'}
            >
              {showPassword2 ? (
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                  <line x1="1" y1="1" x2="23" y2="23" />
                </svg>
              ) : (
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </div>
      </div>

      <div className="border-l border-slate-700 shrink-0" aria-hidden="true" />

      <div className="flex w-1/2 min-w-0 flex-col gap-4">
        <div className="flex gap-4">
          <div className="w-1/2 min-w-0">
            <div className="flex flex-col gap-1">
              <span
                className="text-xs font-medium text-slate-400"
                title="Zeige Hostname und IP-Adresse in der WebUI an oder nicht"
              >
                SetOption53
              </span>
              <select
                value={setOption53}
                onChange={(e) => handleSetOption53Change((e.target.value as 'ON' | 'OFF'))}
                className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 focus:border-emerald-500/50 focus:outline-none focus:ring-1 focus:ring-emerald-500/30"
              >
                <option value="ON">ON = Hostname und IP-Adresse anzeigen</option>
                <option value="OFF">OFF = Hostname und IP-Adresse nicht anzeigen</option>
              </select>
            </div>
          </div>
          <div className="w-1/2 min-w-0">
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-slate-400">
                SetOption56
              </span>
              <select
                value={setOption56}
                onChange={(e) => handleSetOption56Change((e.target.value as 'ON' | 'OFF'))}
                className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 focus:border-emerald-500/50 focus:outline-none focus:ring-1 focus:ring-emerald-500/30"
              >
                <option value="ON">ON = Stärkstes WiFi wählen</option>
                <option value="OFF">OFF = disable (default)</option>
              </select>
            </div>
          </div>
        </div>
        <div className="w-1/2 min-w-0">
          <div className="flex flex-col gap-1">
            <span
              className="text-xs font-medium text-slate-400"
              title="1s auf WiFi-Verbindung warten - löst Probleme bei manchen Fritzboxen"
            >
              SetOption142
            </span>
            <select
              value={setOption142}
              onChange={(e) => handleSetOption142Change((e.target.value as 'ON' | 'OFF'))}
              className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 focus:border-emerald-500/50 focus:outline-none focus:ring-1 focus:ring-emerald-500/30"
            >
              <option value="ON">ON = 1s auf WiFi-Verbindung warten</option>
              <option value="OFF">OFF = disable (default)</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  )
}

function SwitcheConfigContent({
  device,
  onSendCommand,
  storeTick,
}: {
  device: DeviceInfo
  onSendCommand: (deviceId: string, command: string, payload: string) => void
  storeTick?: number
}) {
  const switchNumbers = useMemo(
    () => Array.from(getAvailableSwitches(device.id)).sort((a, b) => Number(a) - Number(b)),
    [device.id],
  )
  const [selectedSwitch, setSelectedSwitch] = useState<string>(switchNumbers[0] ?? '1')
  const properties = DeviceState.getProperties(device.id)
  const [switchMode, setSwitchMode] = useState<number>(0)
  const [showSwitchModeInfoModal, setShowSwitchModeInfoModal] = useState(false)
  const [showSwitchTopicList, setShowSwitchTopicList] = useState(false)
  const [switchTopicListPosition, setSwitchTopicListPosition] = useState<{ top: number; left: number; width: number } | null>(null)
  const switchTopicWrapRef = useRef<HTMLDivElement>(null)
  const switchTopicListRef = useRef<HTMLDivElement>(null)
  const switchTopicFocusedRef = useRef(false)
  const [setOption32, setSetOption32] = useState<number>(10)
  const [setOption114, setSetOption114] = useState<'ON' | 'OFF'>('OFF')
  const [switchTopicValue, setSwitchTopicValue] = useState<string>('0')
  const [switchTextValue, setSwitchTextValue] = useState<string>('')

  // Zustand: direkt aus properties.Switch[selectedSwitch] (wie Zustand – keine lokale State-Fallback)
  const currentState = properties?.Switch && typeof properties.Switch === 'object'
    ? (properties.Switch as Record<string, unknown>)[selectedSwitch]
    : undefined
  const stateDisplay = formatSwitchState(currentState)

  // SwitchMode: wie Zustand direkt aus properties lesen; Fallback auf raw['stat/RESULT'], falls nur dort vorhanden
  const displaySwitchMode = (() => {
    const fromProps =
      properties?.SwitchMode && typeof properties.SwitchMode === 'object'
        ? (properties.SwitchMode as Record<string, unknown>)[selectedSwitch]
        : undefined
    let v = fromProps
    if (v === undefined || v === null) {
      const raw = DeviceState.getRaw(device.id) as Record<string, unknown> | null | undefined
      const result = raw?.['stat/RESULT']
      if (result && typeof result === 'object')
        v = (result as Record<string, unknown>)[`SwitchMode${selectedSwitch}`]
    }
    if (v === undefined || v === null) return 0
    if (typeof v === 'number' && Number.isFinite(v)) return v
    if (typeof v === 'string') {
      const n = parseInt(v, 10)
      if (Number.isFinite(n)) return n
    }
    return 0
  })()
  const currentModeOption = getSwitchModeOption(displaySwitchMode)

  const onSendCommandRef = useRef(onSendCommand)
  onSendCommandRef.current = onSendCommand
  const requestedSwitchModesForDeviceRef = useRef<string | null>(null)
  const requestedSetOption32Ref = useRef<string | null>(null)
  const requestedSetOption114Ref = useRef<string | null>(null)
  const requestedSwitchTopicRef = useRef<string | null>(null)
  const requestedSwitchTextRef = useRef<string | null>(null)
  const switchTextFocusedRef = useRef(false)
  const pendingEmptySwitchTextRef = useRef<string | null>(null)

  // Einmal pro Gerät beim Anzeigen SwitchMode(x), SwitchText(x), SetOption32, SetOption114 und SwitchTopic abfragen (ohne Payload)
  useEffect(() => {
    if (!device?.id || switchNumbers.length === 0) return
    const send = onSendCommandRef.current
    if (requestedSwitchModesForDeviceRef.current !== device.id) {
      requestedSwitchModesForDeviceRef.current = device.id
      switchNumbers.forEach((num) => {
        send(device.id, `SwitchMode${num}`, '')
      })
    }
    if (requestedSwitchTextRef.current !== device.id) {
      requestedSwitchTextRef.current = device.id
      switchNumbers.forEach((num) => {
        send(device.id, `SwitchText${num}`, '')
      })
    }
    if (requestedSetOption32Ref.current !== device.id) {
      requestedSetOption32Ref.current = device.id
      send(device.id, 'SetOption32', '')
    }
    if (requestedSetOption114Ref.current !== device.id) {
      requestedSetOption114Ref.current = device.id
      send(device.id, 'SetOption114', '')
    }
    if (requestedSwitchTopicRef.current !== device.id) {
      requestedSwitchTopicRef.current = device.id
      send(device.id, 'SwitchTopic', '')
    }
  }, [device?.id, switchNumbers])

  useEffect(() => {
    if (switchNumbers.length > 0 && !switchNumbers.includes(selectedSwitch)) {
      setSelectedSwitch(switchNumbers[0])
    }
  }, [switchNumbers, selectedSwitch])

  useEffect(() => {
    pendingEmptySwitchTextRef.current = null
  }, [selectedSwitch])

  // SwitchMode-State mit Store synchron halten, wenn sich Switch oder Store ändert
  useEffect(() => {
    const props = DeviceState.getProperties(device.id)
    let v =
      props?.SwitchMode && typeof props.SwitchMode === 'object'
        ? (props.SwitchMode as Record<string, unknown>)[selectedSwitch]
        : undefined
    if (v === undefined || v === null) {
      const raw = DeviceState.getRaw(device.id) as Record<string, unknown> | null | undefined
      const result = raw?.['stat/RESULT']
      if (result && typeof result === 'object')
        v = (result as Record<string, unknown>)[`SwitchMode${selectedSwitch}`]
    }
    const n = typeof v === 'number' ? v : typeof v === 'string' ? parseInt(String(v), 10) : undefined
    setSwitchMode(Number.isFinite(n) ? n! : 0)
  }, [device.id, selectedSwitch, storeTick])

  // SwitchText-Wert aus Store lesen (pro Switch) und State synchron halten, wenn nicht fokussiert
  const switchTextFromStore = ((): string | undefined => {
    const props = DeviceState.getProperties(device.id)
    let v: unknown =
      props?.SwitchText && typeof props.SwitchText === 'object'
        ? (props.SwitchText as Record<string, unknown>)[selectedSwitch]
        : undefined
    if (v === undefined || v === null) {
      const raw = DeviceState.getRaw(device.id) as Record<string, unknown> | null | undefined
      const result = raw?.['stat/RESULT']
      if (result && typeof result === 'object')
        v = (result as Record<string, unknown>)[`SwitchText${selectedSwitch}`]
    }
    return v !== undefined && v !== null ? String(v) : undefined
  })()
  useEffect(() => {
    if (!switchTextFocusedRef.current && switchTextFromStore !== undefined) {
      if (pendingEmptySwitchTextRef.current === selectedSwitch) {
        if (switchTextFromStore === '') {
          setSwitchTextValue('')
          pendingEmptySwitchTextRef.current = null
        }
      } else {
        setSwitchTextValue(switchTextFromStore)
      }
    }
  }, [switchTextFromStore, selectedSwitch, storeTick])

  const handleSwitchTextBlur = () => {
    switchTextFocusedRef.current = false
    const trimmed = switchTextValue.trim()
    // Leeres Feld: Tasmota setzt String-Befehle mit Payload "" (zwei Anführungszeichen) auf leeren Wert zurück.
    const payload = trimmed === '' ? '""' : trimmed
    onSendCommand(device.id, `SwitchText${selectedSwitch}`, payload)
    if (trimmed === '') pendingEmptySwitchTextRef.current = selectedSwitch
  }

  // SetOption32-Wert aus Store (properties oder raw) lesen und State synchron halten
  const setOption32FromStore = (() => {
    const v = properties?.SetOption32
    if (v !== undefined && v !== null) {
      const n = typeof v === 'number' ? v : typeof v === 'string' ? parseInt(String(v), 10) : undefined
      if (typeof n === 'number' && Number.isFinite(n)) return Math.min(100, Math.max(1, n))
    }
    const raw = DeviceState.getRaw(device.id) as Record<string, unknown> | null | undefined
    const result = raw?.['stat/RESULT']
    if (result && typeof result === 'object') {
      const r = (result as Record<string, unknown>).SetOption32
      const n = typeof r === 'number' ? r : typeof r === 'string' ? parseInt(String(r), 10) : undefined
      if (typeof n === 'number' && Number.isFinite(n)) return Math.min(100, Math.max(1, n))
    }
    return undefined
  })()
  useEffect(() => {
    if (setOption32FromStore !== undefined) setSetOption32(setOption32FromStore)
  }, [setOption32FromStore, storeTick])

  const handleSetOption32Change = (value: number) => {
    setSetOption32(Math.min(100, Math.max(1, value)))
  }

  const handleSetOption32Commit = (e: React.PointerEvent<HTMLInputElement>) => {
    const value = Number((e.currentTarget as HTMLInputElement).value)
    const clamped = Math.min(100, Math.max(1, value))
    onSendCommand(device.id, 'SetOption32', String(clamped))
  }

  // SetOption114-Wert aus Store lesen (ON/OFF) und State synchron halten
  const setOption114FromStore = ((): 'ON' | 'OFF' | undefined => {
    const toOnOff = (v: unknown): 'ON' | 'OFF' | undefined => {
      if (v === undefined || v === null) return undefined
      if (typeof v === 'string') {
        const u = v.trim().toUpperCase()
        if (u === 'ON') return 'ON'
        if (u === 'OFF') return 'OFF'
        if (u === '1') return 'ON'
        if (u === '0') return 'OFF'
      }
      if (typeof v === 'number') return v === 1 ? 'ON' : 'OFF'
      if (typeof v === 'boolean') return v ? 'ON' : 'OFF'
      return undefined
    }
    const v = toOnOff(properties?.SetOption114)
    if (v !== undefined) return v
    const raw = DeviceState.getRaw(device.id) as Record<string, unknown> | null | undefined
    const result = raw?.['stat/RESULT']
    if (result && typeof result === 'object')
      return toOnOff((result as Record<string, unknown>).SetOption114)
    return undefined
  })()
  useEffect(() => {
    if (setOption114FromStore !== undefined) setSetOption114(setOption114FromStore)
  }, [setOption114FromStore, storeTick])

  const handleSetOption114Change = (value: 'ON' | 'OFF') => {
    setSetOption114(value)
    onSendCommand(device.id, 'SetOption114', value)
  }

  // SwitchTopic-Wert aus Store lesen und State synchron halten
  const switchTopicFromStore = ((): string | undefined => {
    const v = properties?.SwitchTopic
    if (v !== undefined && v !== null) {
      if (typeof v === 'number' && (v === 0 || v === 1 || v === 2)) return String(v)
      if (typeof v === 'string') return v.trim()
    }
    const raw = DeviceState.getRaw(device.id) as Record<string, unknown> | null | undefined
    const result = raw?.['stat/RESULT']
    if (result && typeof result === 'object') {
      const r = (result as Record<string, unknown>).SwitchTopic
      if (typeof r === 'number' && (r === 0 || r === 1 || r === 2)) return String(r)
      if (typeof r === 'string') return String(r).trim()
    }
    return undefined
  })()
  useEffect(() => {
    if (switchTopicFromStore !== undefined && !switchTopicFocusedRef.current) {
      setSwitchTopicValue(switchTopicFromStore)
    }
  }, [switchTopicFromStore, storeTick])

  const handleSwitchTopicBlur = () => {
    const trimmed = switchTopicValue.trim()
    const toSend = trimmed === '' ? '0' : trimmed
    onSendCommand(device.id, 'SwitchTopic', toSend)
    if (trimmed === '') setSwitchTopicValue('0')
  }

  const handleSwitchTopicOptionPick = (value: string) => {
    setSwitchTopicValue(value)
    onSendCommand(device.id, 'SwitchTopic', value)
    setShowSwitchTopicList(false)
  }

  useLayoutEffect(() => {
    if (!showSwitchTopicList || !switchTopicWrapRef.current) {
      setSwitchTopicListPosition(null)
      return
    }
    const rect = switchTopicWrapRef.current.getBoundingClientRect()
    setSwitchTopicListPosition({
      top: rect.bottom + 2,
      left: rect.left,
      width: rect.width,
    })
  }, [showSwitchTopicList])

  useEffect(() => {
    if (!showSwitchTopicList) return
    const close = (e: MouseEvent) => {
      const target = e.target as Node
      const inWrap = switchTopicWrapRef.current?.contains(target)
      const inList = switchTopicListRef.current?.contains(target)
      if (!inWrap && !inList) setShowSwitchTopicList(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [showSwitchTopicList])

  if (switchNumbers.length === 0) {
    return (
      <p className="text-slate-400">Keine Switche an diesem Gerät verfügbar.</p>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-400">Switch</span>
          <select
            value={selectedSwitch}
            onChange={(e) => setSelectedSwitch(e.target.value)}
            className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 focus:border-emerald-500/50 focus:outline-none focus:ring-1 focus:ring-emerald-500/30"
          >
            {switchNumbers.map((num) => (
              <option key={num} value={num}>
                Switch {num}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-400">Zustand</span>
          <div className="min-w-[5rem] rounded-md border border-slate-700 bg-slate-900/80 px-3 py-2 font-mono text-slate-200">
            {stateDisplay}
          </div>
        </label>
        <label className="flex flex-col gap-1 shrink-0">
          <span
            className="text-xs font-medium text-slate-400"
            title="Ersetzt den Default-Wert Switch(x) als Label in JSON-Nachrichten"
          >
            SwitchText
          </span>
          <input
            type="text"
            autoComplete="off"
            maxLength={64}
            size={40}
            value={switchTextValue}
            onChange={(e) => setSwitchTextValue(e.target.value)}
            onFocus={() => { switchTextFocusedRef.current = true }}
            onBlur={handleSwitchTextBlur}
            placeholder={`Label für Switch ${selectedSwitch} (leer = Default)`}
            className="w-[40ch] max-w-[40ch] rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 placeholder:text-slate-500 focus:border-emerald-500/50 focus:outline-none focus:ring-1 focus:ring-emerald-500/30"
          />
        </label>
        <label className="flex flex-col gap-1 flex-1 min-w-0">
          <span className="text-xs font-medium text-slate-400">SwitchMode</span>
          <div className="flex gap-2 items-center min-w-0">
            <select
              value={switchMode}
              onChange={(e) => {
                const v = Number(e.target.value)
                setSwitchMode(v)
                onSendCommand(device.id, `SwitchMode${selectedSwitch}`, String(v))
              }}
              className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 focus:border-emerald-500/50 focus:outline-none focus:ring-1 focus:ring-emerald-500/30 flex-1 min-w-0"
            >
              {SWITCH_MODE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setShowSwitchModeInfoModal(true)}
              className="rounded-md border border-slate-700 bg-slate-800 p-2 text-slate-300 hover:bg-slate-700 hover:text-slate-200 shrink-0"
              title="Erklärung anzeigen"
              aria-label="SwitchMode-Erklärung anzeigen"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 16v-4" />
                <path d="M12 8h.01" />
              </svg>
            </button>
          </div>
        </label>
      </div>

      <div className="border-b border-slate-700" aria-hidden="true" />

      <div className="flex flex-wrap items-center gap-4">
        <label className="flex flex-col gap-1 w-1/3 min-w-0">
          <span
            className="text-xs font-medium text-slate-400"
            title="Zeigt die aktuelle Zeit an, die der Button gedrückt sein muss, bis die Halten-Funktionalität des Buttons ausgelöst wird. Der Wert bedeutet Zehntelsekunden, der Standardwert ist 40 also 4 Sekunden."
          >
            SetOption32
          </span>
          <div className="flex gap-3 items-center">
            <input
              type="range"
              min={1}
              max={100}
              value={setOption32}
              onChange={(e) => handleSetOption32Change(Number(e.target.value))}
              onPointerUp={handleSetOption32Commit}
              className="flex-1 h-2 rounded-lg appearance-none bg-slate-700 accent-emerald-500 min-w-0"
            />
            <span className="min-w-[2.5rem] text-right font-mono text-slate-200 tabular-nums shrink-0">
              {setOption32}
            </span>
          </div>
        </label>

        <label className="flex flex-col gap-1">
          <span
            className="text-xs font-medium text-slate-400"
            title='Entkoppelt alle Switche von den Relais und sendet stattdessen eine MQTT-Nachricht - Beispielsweise: {"Switch1":{"Action":"ON"}}'
          >
            SetOption114
          </span>
          <select
            value={setOption114}
            onChange={(e) => handleSetOption114Change((e.target.value as 'ON' | 'OFF'))}
            className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 focus:border-emerald-500/50 focus:outline-none focus:ring-1 focus:ring-emerald-500/30 min-w-[12rem]"
          >
            <option value="OFF">OFF = disable (default)</option>
            <option value="ON">ON = enable</option>
          </select>
        </label>

        <label className="flex flex-col gap-1 min-w-0 flex-1">
          <span
            className="text-xs font-medium text-slate-400"
            title="0 = keine MQTT-Nachricht, 1 = Topic = Geräte-Topic, 2 = Firmware-Default, oder eigenes Topic (Zeichenfolge)"
          >
            SwitchTopic
          </span>
          <div ref={switchTopicWrapRef} className="relative flex min-w-[12rem]">
            <input
              type="text"
              autoComplete="off"
              value={switchTopicValue}
              onChange={(e) => setSwitchTopicValue(e.target.value)}
              onFocus={() => { switchTopicFocusedRef.current = true }}
              onBlur={() => {
                switchTopicFocusedRef.current = false
                handleSwitchTopicBlur()
              }}
              placeholder="0, 1, 2 oder eigenes Topic"
              className="rounded-l-md border border-slate-700 border-r-0 bg-slate-900 px-3 py-2 text-slate-100 placeholder:text-slate-500 focus:border-emerald-500/50 focus:outline-none focus:ring-1 focus:ring-emerald-500/30 flex-1 min-w-0"
            />
            <button
              type="button"
              onClick={() => setShowSwitchTopicList((v) => !v)}
              className="rounded-r-md border border-slate-700 bg-slate-800 px-2 py-2 text-slate-300 hover:bg-slate-700 hover:text-slate-200 shrink-0"
              title="Vorschläge anzeigen"
              aria-expanded={showSwitchTopicList}
              aria-haspopup="listbox"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
            {showSwitchTopicList && switchTopicListPosition && createPortal(
              <div
                ref={switchTopicListRef}
                role="listbox"
                className="fixed z-[200] max-h-48 overflow-auto rounded-md border border-slate-700 bg-slate-900 shadow-lg"
                style={{
                  top: switchTopicListPosition.top,
                  left: switchTopicListPosition.left,
                  width: switchTopicListPosition.width,
                }}
              >
                {[
                  { value: '0', label: '0 = disable MQTT-Nachricht' },
                  { value: '1', label: '1 = MQTT auf Geräte-Topic' },
                  { value: '2', label: '2 = Firmware-Default' },
                ].map((opt) => (
                  <div
                    key={opt.value}
                    role="option"
                    aria-selected={switchTopicValue === opt.value}
                    onClick={() => handleSwitchTopicOptionPick(opt.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        handleSwitchTopicOptionPick(opt.value)
                      }
                    }}
                    className="cursor-pointer px-3 py-2 text-slate-200 hover:bg-slate-700 focus:bg-slate-700 focus:outline-none"
                    tabIndex={0}
                  >
                    {opt.label}
                  </div>
                ))}
              </div>,
              document.body
            )}
          </div>
        </label>
      </div>

      {showSwitchModeInfoModal && currentModeOption && createPortal(
        <div
          className="fixed inset-0 z-[220] flex items-center justify-center bg-black/60 p-4"
          onClick={() => setShowSwitchModeInfoModal(false)}
          onKeyDown={(e) => e.key === 'Escape' && setShowSwitchModeInfoModal(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="switchmode-modal-title"
        >
          <div
            className="rounded-xl border border-slate-700 bg-slate-900 shadow-xl max-w-md w-full p-4 text-left"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="switchmode-modal-title" className="text-sm font-semibold text-slate-200 mb-2">
              SwitchMode {currentModeOption.value}
            </h3>
            <p className="text-sm text-slate-300 whitespace-pre-wrap leading-relaxed">
              {currentModeOption.description}
            </p>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => setShowSwitchModeInfoModal(false)}
                className="rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-200 hover:bg-slate-700"
              >
                Schließen
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}

function ButtonsConfigContent({ device, storeTick }: { device: DeviceInfo; storeTick?: number }) {
  const buttonNumbers = useMemo(() => {
    const raw = DeviceState.getRaw(device.id) as Record<string, unknown> | null | undefined
    const fromTemplate = raw?.['stat/Template']
    const fromResult = raw?.['stat/RESULT']
    const payloadTemplate = fromTemplate && typeof fromTemplate === 'object' ? (fromTemplate as Record<string, unknown>) : undefined
    const payloadResult = fromResult && typeof fromResult === 'object' ? (fromResult as Record<string, unknown>) : undefined
    const gpioArray = Array.isArray(payloadTemplate?.GPIO)
      ? (payloadTemplate!.GPIO as number[])
      : Array.isArray(payloadResult?.GPIO)
        ? (payloadResult!.GPIO as number[])
        : []
    return getButtonNumbersFromGpioArray(gpioArray).map(String)
  }, [device.id, storeTick])
  const [selectedButton, setSelectedButton] = useState<string>(buttonNumbers[0] ?? '1')
  const properties = DeviceState.getProperties(device.id)
  const currentState = properties?.Button && typeof properties.Button === 'object'
    ? (properties.Button as Record<string, unknown>)[selectedButton]
    : undefined
  const stateDisplay = formatSwitchState(currentState)

  useEffect(() => {
    if (buttonNumbers.length > 0 && !buttonNumbers.includes(selectedButton)) {
      setSelectedButton(buttonNumbers[0])
    }
  }, [buttonNumbers, selectedButton])

  if (buttonNumbers.length === 0) {
    return (
      <p className="text-slate-400">Keine Buttons an diesem Gerät verfügbar.</p>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-400">Button</span>
          <select
            value={selectedButton}
            onChange={(e) => setSelectedButton(e.target.value)}
            className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 focus:border-emerald-500/50 focus:outline-none focus:ring-1 focus:ring-emerald-500/30"
          >
            {buttonNumbers.map((num) => (
              <option key={num} value={num}>
                Button {num}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-400">Zustand</span>
          <div className="min-w-[5rem] rounded-md border border-slate-700 bg-slate-900/80 px-3 py-2 font-mono text-slate-200">
            {stateDisplay}
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
  allDevices = {},
  consoleLines,
  onSendCommand,
  onTogglePower,
  onBackup,
  onDownloadBackup,
  onDeleteBackup,
  onUpdateAutoBackup,
  backingUp = {},
  backendAvailable = false,
  onBack,
  onDeviceTypeApplied,
}: Props) {
  const [inputValue, setInputValue] = useState('')
  const [blakadderList, setBlakadderList] = useState<BlakadderListItem[]>([])
  const [deviceTypeInput, setDeviceTypeInput] = useState('')
  const [deviceTypeDropdownOpen, setDeviceTypeDropdownOpen] = useState(false)
  const [deviceTypeHighlightedIndex, setDeviceTypeHighlightedIndex] = useState(0)
  const [deviceTypeImageIndex, setDeviceTypeImageIndex] = useState(0)
  const [deviceTypeImageLightboxOpen, setDeviceTypeImageLightboxOpen] = useState(false)
  const [customLinkDialogOpen, setCustomLinkDialogOpen] = useState(false)
  const [customLinkDialogSlot, setCustomLinkDialogSlot] = useState<0 | 1>(0)
  const [customLinkDialogTitle, setCustomLinkDialogTitle] = useState('')
  const [customLinkDialogUrl, setCustomLinkDialogUrl] = useState('')
  const deviceTypeInputRef = useRef<HTMLInputElement>(null)
  const deviceTypeFileInputRef = useRef<HTMLInputElement>(null)
  const deviceTypeColumnRef = useRef<HTMLDivElement>(null)
  const lastAppliedDeviceTypeRef = useRef<string | null>(null)
  const autoAppliedModuleForDeviceRef = useRef<string | null>(null)
  const [storeTick, setStoreTick] = useState(0)
  const [deviceTypeColumnHeight, setDeviceTypeColumnHeight] = useState<number | null>(null)
  useEffect(() => {
    if (!device?.id) return
    return DeviceState.subscribe(() => setStoreTick((t) => t + 1))
  }, [device?.id])
  const consoleExpanded = device?.settingsUi?.consoleExpanded ?? true
  const shortInfoExpanded = device?.settingsUi?.shortInfoExpanded ?? true
  const collapsedBlockIds = new Set(device?.settingsUi?.collapsedBlockIds ?? [])

  useLayoutEffect(() => {
    const el = deviceTypeColumnRef.current
    if (!el) return
    const update = () => {
      const h = el.offsetHeight
      setDeviceTypeColumnHeight(h > 0 ? h : null)
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [device?.id, shortInfoExpanded])

  const setConsoleExpanded = (value: boolean) => {
    if (device) DeviceState.updateSettingsUi(device.id, { consoleExpanded: value })
  }
  const setShortInfoExpanded = (value: boolean) => {
    if (device) {
      DeviceState.updateSettingsUi(device.id, { shortInfoExpanded: value })
      DeviceState.triggerPersist(device.id)
    }
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

  const deviceTypeDisplayLabel = useMemo(() => {
    const dt = device?.deviceType?.trim()
    if (!dt) return ''
    const item = blakadderList.find((x) => x.id === dt)
    return item ? item.label : dt
  }, [device?.deviceType, blakadderList])

  const gpioAssignments = useMemo(() => {
    if (!device?.id) return []
    const raw = DeviceState.getRaw(device.id) as Record<string, unknown> | null | undefined
    const fromTemplate = raw?.['stat/Template']
    const fromResult = raw?.['stat/RESULT']
    const payloadTemplate = fromTemplate && typeof fromTemplate === 'object' ? (fromTemplate as Record<string, unknown>) : undefined
    const payloadResult = fromResult && typeof fromResult === 'object' ? (fromResult as Record<string, unknown>) : undefined
    const gpioArray =
      Array.isArray(payloadTemplate?.GPIO)
        ? (payloadTemplate.GPIO as number[])
        : Array.isArray(payloadResult?.GPIO)
          ? (payloadResult.GPIO as number[])
          : []
    return getGpioAssignments(gpioArray)
  }, [device?.id, storeTick])

  const webUiStoredColors = useMemo(() => {
    if (!device?.id) return undefined
    const raw = DeviceState.getRaw(device.id) as Record<string, unknown> | null | undefined
    return getStoredWebColorArray(raw)
  }, [device?.id, storeTick])
  const currentWebUiThemeIndex = useMemo(
    () => findThemeIndexByStoredArray(webUiStoredColors, TASMOTA_WEBUI_THEMES),
    [webUiStoredColors]
  )
  const [webUiThemeCarouselIndex, setWebUiThemeCarouselIndex] = useState(0)
  const [webUiThemeImageErrors, setWebUiThemeImageErrors] = useState<Set<number>>(new Set())
  const hasDeviceThemeSlot = currentWebUiThemeIndex === -1 && (webUiStoredColors?.length ?? 0) > 0
  useEffect(() => {
    if (currentWebUiThemeIndex >= 0) {
      setWebUiThemeCarouselIndex(currentWebUiThemeIndex)
    } else if (hasDeviceThemeSlot) {
      setWebUiThemeCarouselIndex(-1)
    }
  }, [currentWebUiThemeIndex, hasDeviceThemeSlot])
  useEffect(() => {
    setWebUiThemeImageErrors(new Set())
  }, [device?.id])

  const devicesMap = allDevices ?? {}
  const locationOptions = useMemo(() => {
    const set = new Set<string>()
    Object.values(devicesMap).forEach((d) => {
      const v = d.location?.trim()
      if (v) set.add(v)
    })
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'de'))
  }, [devicesMap])
  const roomOptions = useMemo(() => {
    const set = new Set<string>()
    Object.values(devicesMap).forEach((d) => {
      const v = d.room?.trim()
      if (v) set.add(v)
    })
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'de'))
  }, [devicesMap])

  const [locationDropdownOpen, setLocationDropdownOpen] = useState(false)
  const [locationHighlightedIndex, setLocationHighlightedIndex] = useState(0)
  const [roomDropdownOpen, setRoomDropdownOpen] = useState(false)
  const [roomHighlightedIndex, setRoomHighlightedIndex] = useState(0)
  const locationInputRef = useRef<HTMLInputElement>(null)
  const roomInputRef = useRef<HTMLInputElement>(null)
  const [locationDropdownRect, setLocationDropdownRect] = useState<{ top: number; left: number; width: number } | null>(null)
  const [roomDropdownRect, setRoomDropdownRect] = useState<{ top: number; left: number; width: number } | null>(null)

  useEffect(() => {
    setLocationHighlightedIndex((i) => (locationOptions.length ? Math.min(i, locationOptions.length - 1) : 0))
  }, [locationOptions.length])
  useEffect(() => {
    setRoomHighlightedIndex((i) => (roomOptions.length ? Math.min(i, roomOptions.length - 1) : 0))
  }, [roomOptions.length])

  useLayoutEffect(() => {
    if (locationDropdownOpen && locationOptions.length > 0 && locationInputRef.current) {
      const rect = locationInputRef.current.getBoundingClientRect()
      setLocationDropdownRect({ top: rect.bottom + 4, left: rect.left, width: rect.width })
    } else {
      setLocationDropdownRect(null)
    }
  }, [locationDropdownOpen, locationOptions.length])
  useLayoutEffect(() => {
    if (roomDropdownOpen && roomOptions.length > 0 && roomInputRef.current) {
      const rect = roomInputRef.current.getBoundingClientRect()
      setRoomDropdownRect({ top: rect.bottom + 4, left: rect.left, width: rect.width })
    } else {
      setRoomDropdownRect(null)
    }
  }, [roomDropdownOpen, roomOptions.length])

  const [locationLocal, setLocationLocal] = useState(() => '')
  const [roomLocal, setRoomLocal] = useState(() => '')
  const [projectDescriptionLocal, setProjectDescriptionLocal] = useState(() => '')
  const locationFocusedRef = useRef(false)
  const roomFocusedRef = useRef(false)
  const projectDescriptionFocusedRef = useRef(false)

  useEffect(() => {
    if (!device) return
    if (!locationFocusedRef.current) setLocationLocal(device.location ?? '')
  }, [device?.id, device?.location])
  useEffect(() => {
    if (!device) return
    if (!roomFocusedRef.current) setRoomLocal(device.room ?? '')
  }, [device?.id, device?.room])
  useEffect(() => {
    if (!device) return
    if (!projectDescriptionFocusedRef.current) setProjectDescriptionLocal(device.projectDescription ?? '')
  }, [device?.id, device?.projectDescription])

  useEffect(() => {
    if (device) {
      setLocationLocal(device.location ?? '')
      setRoomLocal(device.room ?? '')
      setProjectDescriptionLocal(device.projectDescription ?? '')
    }
  }, [device?.id])

  const locationInput = locationLocal
  const roomInput = roomLocal
  const projectDescriptionInput = projectDescriptionLocal
  const setLocationInput = (value: string) => {
    setLocationLocal(value)
    if (device) {
      DeviceState.updateInfo(device.id, { location: value === '' ? undefined : value })
      DeviceState.triggerPersist(device.id)
    }
  }
  const setRoomInput = (value: string) => {
    setRoomLocal(value)
    if (device) {
      DeviceState.updateInfo(device.id, { room: value === '' ? undefined : value })
      DeviceState.triggerPersist(device.id)
    }
  }
  const projectDescriptionPersistTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const setProjectDescriptionInput = (value: string) => {
    setProjectDescriptionLocal(value)
    if (device) {
      DeviceState.updateInfo(device.id, { projectDescription: value === '' ? undefined : value })
      if (projectDescriptionPersistTimeoutRef.current) clearTimeout(projectDescriptionPersistTimeoutRef.current)
      projectDescriptionPersistTimeoutRef.current = setTimeout(() => {
        projectDescriptionPersistTimeoutRef.current = null
        DeviceState.triggerPersist(device.id)
      }, 800)
    }
  }
  const persistProjectDescription = () => {
    if (projectDescriptionPersistTimeoutRef.current) {
      clearTimeout(projectDescriptionPersistTimeoutRef.current)
      projectDescriptionPersistTimeoutRef.current = null
    }
    if (device) DeviceState.triggerPersist(device.id)
  }

  const filteredBlakadderOptions = useMemo(() => {
    const q = deviceTypeInput.trim().toLowerCase()
    if (!q) return blakadderList.slice(0, 50)
    return blakadderList.filter(
      (x) => x.label.toLowerCase().includes(q) || x.id.toLowerCase().includes(q)
    ).slice(0, 50)
  }, [blakadderList, deviceTypeInput])

  const deviceTypeOptionCount =
    filteredBlakadderOptions.length > 0
      ? filteredBlakadderOptions.length
      : deviceTypeInput.trim()
        ? 1
        : 0

  const applyDeviceType = useCallback(
    (value: string) => {
      if (!device) return
      const trimmed = value.trim()
      const finalValue = trimmed || undefined
      lastAppliedDeviceTypeRef.current = trimmed || null
      onDeviceTypeApplied?.(device.id, finalValue)
      DeviceState.updateInfo(device.id, { deviceType: finalValue })
      setDeviceTypeDropdownOpen(false)
    },
    [device, onDeviceTypeApplied]
  )

  const currentBlakadderItem = useMemo(() => {
    const dt = device?.deviceType?.trim()
    if (!dt) return null
    return blakadderList.find((x) => x.id === dt) ?? null
  }, [device?.deviceType, blakadderList])

  const templateImageUrl = useMemo(() => {
    const url = currentBlakadderItem?.image
    return typeof url === 'string' && url.trim() ? url.trim() : undefined
  }, [currentBlakadderItem])

  const productUrl = useMemo(() => {
    const url = currentBlakadderItem?.product
    return typeof url === 'string' && url.trim() ? url.trim() : undefined
  }, [currentBlakadderItem])

  const productDomainLabel = useMemo(() => {
    if (!productUrl) return ''
    try {
      const u = new URL(productUrl)
      return u.hostname.replace(/^www\./i, '')
    } catch {
      return productUrl
    }
  }, [productUrl])

  const allDeviceTypeImages = useMemo(() => {
    const template = templateImageUrl ? [templateImageUrl] : []
    const custom = device?.deviceTypeImages ?? []
    return [...template, ...custom]
  }, [templateImageUrl, device?.deviceTypeImages])

  const currentDeviceTypeImage = allDeviceTypeImages[deviceTypeImageIndex] ?? null
  const isCurrentImageCustom = templateImageUrl ? deviceTypeImageIndex > 0 : deviceTypeImageIndex >= 0

  useEffect(() => {
    const max = Math.max(0, allDeviceTypeImages.length - 1)
    setDeviceTypeImageIndex((i) => (i > max ? max : i))
  }, [allDeviceTypeImages.length])

  const handleAddDeviceTypeImage = useCallback(async () => {
    if (!device) return
    try {
      const items = await navigator.clipboard.read().catch(() => [])
      for (const item of items) {
        for (const type of item.types) {
          if (type.startsWith('image/')) {
            const blob = await item.getType(type)
            const dataUrl = await new Promise<string>((resolve, reject) => {
              const r = new FileReader()
              r.onload = () => resolve(String(r.result))
              r.onerror = reject
              r.readAsDataURL(blob)
            })
            const alreadyInList = allDeviceTypeImages.some((url) => url === dataUrl)
            if (alreadyInList) {
              deviceTypeFileInputRef.current?.click()
              return
            }
            const next = [...(device.deviceTypeImages ?? []), dataUrl]
            DeviceState.updateInfo(device.id, { deviceTypeImages: next })
            setDeviceTypeImageIndex(templateImageUrl ? next.length : next.length - 1)
            return
          }
        }
      }
    } catch {
      // Clipboard nicht lesbar oder kein Bild
    }
    deviceTypeFileInputRef.current?.click()
  }, [device, templateImageUrl, allDeviceTypeImages])

  const handleDeviceTypeFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!device) return
      const file = e.target.files?.[0]
      e.target.value = ''
      if (!file || !file.type.startsWith('image/')) return
      const reader = new FileReader()
      reader.onload = () => {
        const dataUrl = String(reader.result)
        const next = [...(device.deviceTypeImages ?? []), dataUrl]
        DeviceState.updateInfo(device.id, { deviceTypeImages: next })
        setDeviceTypeImageIndex(templateImageUrl ? next.length : next.length - 1)
      }
      reader.readAsDataURL(file)
    },
    [device, templateImageUrl]
  )

  const handleRemoveDeviceTypeImage = useCallback(() => {
    if (!device || !isCurrentImageCustom) return
    const custom = device.deviceTypeImages ?? []
    const customIndex = templateImageUrl ? deviceTypeImageIndex - 1 : deviceTypeImageIndex
    if (customIndex < 0 || customIndex >= custom.length) return
    const next = custom.filter((_: string, i: number) => i !== customIndex)
    DeviceState.updateInfo(device.id, { deviceTypeImages: next.length ? next : undefined })
    setDeviceTypeImageIndex((i) => Math.max(0, i - 1))
  }, [device, isCurrentImageCustom, templateImageUrl, deviceTypeImageIndex])

  const customLinkSlots = useMemo((): Array<{ title?: string; url?: string }> => {
    const c = device?.deviceTypeCustomLinks
    if (Array.isArray(c) && c.length >= 2) return [c[0] ?? {}, c[1] ?? {}]
    return [{}, {}]
  }, [device?.deviceTypeCustomLinks])

  const openCustomLinkDialog = useCallback((slot: 0 | 1, title?: string, url?: string) => {
    setCustomLinkDialogSlot(slot)
    setCustomLinkDialogTitle(title ?? '')
    setCustomLinkDialogUrl(url ?? '')
    setCustomLinkDialogOpen(true)
  }, [])

  const saveCustomLink = useCallback(() => {
    if (!device) return
    const title = customLinkDialogTitle.trim() || undefined
    const url = customLinkDialogUrl.trim() || undefined
    const next: Array<{ title?: string; url?: string }> = [
      customLinkDialogSlot === 0 ? { title, url } : (customLinkSlots[0] ?? {}),
      customLinkDialogSlot === 1 ? { title, url } : (customLinkSlots[1] ?? {}),
    ]
    DeviceState.updateInfo(device.id, { deviceTypeCustomLinks: next })
    DeviceState.triggerPersist(device.id)
    setCustomLinkDialogOpen(false)
  }, [device, customLinkDialogSlot, customLinkDialogTitle, customLinkDialogUrl, customLinkSlots])

  const clearCustomLinkSlot = useCallback(
    (slot: 0 | 1, e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (!device) return
      const next: Array<{ title?: string; url?: string }> = [
        slot === 0 ? {} : (customLinkSlots[0] ?? {}),
        slot === 1 ? {} : (customLinkSlots[1] ?? {}),
      ]
      DeviceState.updateInfo(device.id, { deviceTypeCustomLinks: next })
      DeviceState.triggerPersist(device.id)
    },
    [device, customLinkSlots]
  )

  useEffect(() => {
    setDeviceTypeHighlightedIndex((i) =>
      deviceTypeOptionCount > 0 ? Math.min(i, deviceTypeOptionCount - 1) : 0
    )
  }, [deviceTypeOptionCount])
  useEffect(() => {
    setDeviceTypeHighlightedIndex(0)
  }, [deviceTypeInput])
  useEffect(() => {
    if (device?.id) getBlakadderList().then(setBlakadderList)
  }, [device?.id])
  useEffect(() => {
    lastAppliedDeviceTypeRef.current = null
    autoAppliedModuleForDeviceRef.current = null
  }, [device?.id])
  useEffect(() => {
    if (!device?.id || !applyDeviceType) return
    const dt = device.deviceType?.trim()
    if (dt) return
    const moduleName = device.module?.trim()
    if (!moduleName || blakadderList.length === 0) return
    if (autoAppliedModuleForDeviceRef.current === device.id) return
    const modNorm = moduleName.toLowerCase()
    const matches = blakadderList.filter(
      (item) =>
        item.label.toLowerCase().includes(modNorm) || item.id.toLowerCase().includes(modNorm)
    )
    if (matches.length < 1 || matches.length > 10) return
    const sorted = [...matches].sort((a, b) => {
      const aLabel = a.label.toLowerCase()
      const bLabel = b.label.toLowerCase()
      const aExact = aLabel === modNorm ? 0 : aLabel.startsWith(modNorm) ? 1 : 2
      const bExact = bLabel === modNorm ? 0 : bLabel.startsWith(modNorm) ? 1 : 2
      return aExact - bExact || aLabel.localeCompare(bLabel)
    })
    autoAppliedModuleForDeviceRef.current = device.id
    applyDeviceType(sorted[0].id)
  }, [device?.id, device?.deviceType, device?.module, blakadderList, applyDeviceType])
  useEffect(() => {
    if (deviceTypeInputRef.current && document.activeElement === deviceTypeInputRef.current) {
      return
    }
    const pending = lastAppliedDeviceTypeRef.current
    if (pending !== null) {
      const expectedLabel = blakadderList.find((x) => x.id === pending)?.label ?? pending
      if (deviceTypeDisplayLabel === expectedLabel) {
        lastAppliedDeviceTypeRef.current = null
        setDeviceTypeInput(deviceTypeDisplayLabel)
      }
      return
    }
    setDeviceTypeInput(deviceTypeDisplayLabel)
  }, [deviceTypeDisplayLabel, blakadderList])

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
          <div className="rounded-xl border border-slate-800 bg-slate-950/40 overflow-visible">
            <div className="flex items-start gap-2 rounded-t-xl border-b border-slate-800 bg-slate-900/60 px-4 py-4">
              <div className="min-w-0 flex-1 grid grid-cols-2 gap-2 text-sm text-slate-200 md:grid-cols-3">
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
              <button
                type="button"
                onClick={() => setShortInfoExpanded(!shortInfoExpanded)}
                className="shrink-0 rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                aria-label={shortInfoExpanded ? 'Kurz-Infos einklappen' : 'Kurz-Infos aufklappen'}
                title={shortInfoExpanded ? 'Einklappen' : 'Aufklappen'}
              >
                <span
                  className={`inline-flex h-5 w-5 items-center justify-center transition-transform ${
                    shortInfoExpanded ? 'rotate-180' : ''
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
            </div>
            {shortInfoExpanded && (
            <div className="min-h-[4rem] overflow-visible p-4 flex items-start gap-4">
              <div
                ref={deviceTypeColumnRef}
                className="w-1/3 min-w-0 flex flex-col overflow-hidden shrink-0"
                style={
                  deviceTypeColumnHeight != null && deviceTypeColumnHeight > 0
                    ? { height: `${deviceTypeColumnHeight}px`, minHeight: `${deviceTypeColumnHeight}px` }
                    : undefined
                }
              >
                <div className="w-full max-w-full overflow-visible">
                  <label htmlFor="device-type-input" className="mb-1 block text-xs font-medium text-slate-400">
                    Gerätetyp
                  </label>
                <div className="relative overflow-visible">
                  <input
                    id="device-type-input"
                    ref={deviceTypeInputRef}
                    type="text"
                    value={deviceTypeInput}
                    onChange={(e) => {
                      setDeviceTypeInput(e.target.value)
                      setDeviceTypeDropdownOpen(true)
                    }}
                    onFocus={() => {
                      setDeviceTypeDropdownOpen(true)
                      setDeviceTypeHighlightedIndex(0)
                    }}
                    onBlur={() => {
                      setTimeout(() => {
                        setDeviceTypeDropdownOpen(false)
                        if (!device) return
                        const trimmed = deviceTypeInput.trim()
                        const currentId = device.deviceType ?? ''
                        if (trimmed === currentId) return
                        const byLabel = blakadderList.find((x) => x.label === trimmed)
                        applyDeviceType(byLabel ? byLabel.id : trimmed)
                      }, 150)
                    }}
                    onKeyDown={(e) => {
                      const open = deviceTypeDropdownOpen && deviceTypeOptionCount > 0
                      if (e.key === 'Escape') {
                        setDeviceTypeDropdownOpen(false)
                        setDeviceTypeInput(deviceTypeDisplayLabel)
                        return
                      }
                      if (open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
                        e.preventDefault()
                        setDeviceTypeHighlightedIndex((i) => {
                          const next = e.key === 'ArrowDown' ? i + 1 : i - 1
                          return Math.max(0, Math.min(deviceTypeOptionCount - 1, next))
                        })
                        return
                      }
                      if (open && e.key === 'Enter') {
                        e.preventDefault()
                        if (filteredBlakadderOptions.length > 0) {
                          const item = filteredBlakadderOptions[deviceTypeHighlightedIndex]
                          if (item) {
                            setDeviceTypeInput(item.label)
                            applyDeviceType(item.id)
                            setDeviceTypeDropdownOpen(false)
                          }
                        } else if (deviceTypeInput.trim()) {
                          applyDeviceType(deviceTypeInput)
                          setDeviceTypeDropdownOpen(false)
                        }
                        return
                      }
                      if (e.key === 'Enter' && filteredBlakadderOptions.length === 0 && deviceTypeInput.trim()) {
                        applyDeviceType(deviceTypeInput)
                      }
                    }}
                    placeholder="Suchen oder Freitext…"
                    className="w-full rounded-md border border-slate-700 bg-slate-900 py-2 pl-3 pr-10 text-sm text-slate-100 placeholder:text-slate-500 focus:border-emerald-500/50 focus:outline-none focus:ring-1 focus:ring-emerald-500/30"
                    autoComplete="off"
                  />
                  {device?.deviceType ? (
                    <a
                      href={`https://templates.blakadder.com/${encodeURIComponent(device.deviceType)}.html`}
                      target="_blank"
                      rel="noreferrer"
                      title="Geräteseite auf templates.blakadder.com öffnen"
                      className="absolute right-1 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                      aria-label="Geräteseite auf templates.blakadder.com öffnen"
                    >
                      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                        <polyline points="15 3 21 3 21 9" />
                        <line x1="10" y1="14" x2="21" y2="3" />
                      </svg>
                    </a>
                  ) : null}
                  {deviceTypeDropdownOpen && (deviceTypeInput || filteredBlakadderOptions.length > 0) && (
                    <ul
                      className="absolute left-0 right-0 top-full z-[100] mt-1 max-h-60 overflow-auto rounded-md border border-slate-700 bg-slate-900 py-1 shadow-lg"
                      role="listbox"
                      aria-activedescendant={
                        deviceTypeOptionCount > 0
                          ? filteredBlakadderOptions.length > 0
                            ? `device-type-option-${deviceTypeHighlightedIndex}`
                            : 'device-type-freetext'
                          : undefined
                      }
                    >
                      {filteredBlakadderOptions.map((item, index) => (
                        <li
                          key={item.id}
                          id={
                            filteredBlakadderOptions.length > 0
                              ? `device-type-option-${index}`
                              : undefined
                          }
                          role="option"
                          aria-selected={deviceTypeHighlightedIndex === index}
                          className={`cursor-pointer px-3 py-2 text-sm hover:bg-slate-800 ${
                            deviceTypeHighlightedIndex === index ? 'bg-slate-800 text-slate-100' : 'text-slate-200'
                          }`}
                          onMouseDown={(e) => {
                            e.preventDefault()
                            setDeviceTypeInput(item.label)
                            applyDeviceType(item.id)
                          }}
                        >
                          {item.label}
                        </li>
                      ))}
                      {filteredBlakadderOptions.length === 0 && deviceTypeInput.trim() && (
                        <li
                          id="device-type-freetext"
                          role="option"
                          aria-selected={deviceTypeHighlightedIndex === 0}
                          className={`cursor-pointer px-3 py-2 text-sm hover:bg-slate-800 ${
                            deviceTypeHighlightedIndex === 0 ? 'bg-slate-800 text-slate-300' : 'text-slate-400'
                          }`}
                          onMouseDown={(e) => {
                            e.preventDefault()
                            applyDeviceType(deviceTypeInput)
                          }}
                        >
                          Als Freitext verwenden: &quot;{deviceTypeInput.trim()}&quot;
                        </li>
                      )}
                    </ul>
                  )}
                </div>
                </div>
                <div className="mt-3 flex min-w-0 items-start gap-2">
                <div className="min-w-0 flex-1 basis-0">
                <div
                  className="relative aspect-square w-full overflow-hidden rounded-lg border border-slate-700 bg-white group"
                  role={currentDeviceTypeImage ? 'button' : undefined}
                  tabIndex={currentDeviceTypeImage ? 0 : undefined}
                  onClick={currentDeviceTypeImage ? () => setDeviceTypeImageLightboxOpen(true) : undefined}
                  onKeyDown={currentDeviceTypeImage ? (e) => e.key === 'Enter' && setDeviceTypeImageLightboxOpen(true) : undefined}
                >
                  {currentDeviceTypeImage ? (
                    <img
                      src={currentDeviceTypeImage}
                      alt=""
                      className="h-full w-full cursor-pointer object-contain"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-slate-500 text-xs">
                      Kein Bild
                    </div>
                  )}
                  {deviceTypeImageIndex > 0 && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setDeviceTypeImageIndex((i) => Math.max(0, i - 1)) }}
                      className="absolute left-1 top-1/2 -translate-y-1/2 rounded bg-slate-800/90 p-1.5 text-slate-200 opacity-0 shadow group-hover:opacity-100 hover:bg-slate-700"
                      aria-label="Vorheriges Bild"
                    >
                      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="15 18 9 12 15 6" />
                      </svg>
                    </button>
                  )}
                  {deviceTypeImageIndex < allDeviceTypeImages.length - 1 && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setDeviceTypeImageIndex((i) => Math.min(allDeviceTypeImages.length - 1, i + 1)) }}
                      className="absolute right-1 top-1/2 -translate-y-1/2 rounded bg-slate-800/90 p-1.5 text-slate-200 opacity-0 shadow group-hover:opacity-100 hover:bg-slate-700"
                      aria-label="Nächstes Bild"
                    >
                      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    </button>
                  )}
                  <div className="absolute bottom-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      onClick={handleAddDeviceTypeImage}
                      className="rounded bg-slate-800/90 p-1.5 text-slate-200 shadow hover:bg-slate-700"
                      title="Bild hinzufügen (Zwischenablage oder Datei)"
                      aria-label="Bild hinzufügen"
                    >
                      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="12" y1="5" x2="12" y2="19" />
                        <line x1="5" y1="12" x2="19" y2="12" />
                      </svg>
                    </button>
                    {isCurrentImageCustom && (
                      <button
                        type="button"
                        onClick={handleRemoveDeviceTypeImage}
                        className="rounded bg-slate-800/90 p-1.5 text-slate-200 shadow hover:bg-red-700"
                        title="Dieses Bild entfernen"
                        aria-label="Bild entfernen"
                      >
                        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          <line x1="10" y1="11" x2="10" y2="17" />
                          <line x1="14" y1="11" x2="14" y2="17" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
                </div>
                <div className="flex min-w-0 flex-1 basis-0 flex-col gap-2 self-start">
                  {productUrl && productDomainLabel && (
                    <a
                      href={productUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-center text-sm text-slate-200 hover:bg-slate-700 hover:text-white"
                      title={productUrl}
                    >
                      <span className="block truncate">{productDomainLabel}</span>
                    </a>
                  )}
                  {([0, 1] as const).map((slot) => {
                    const link = customLinkSlots[slot]
                    const hasLink = typeof link?.url === 'string' && link.url.trim() !== ''
                    const label = hasLink ? (link.title?.trim() || 'Unbenannter Link') : 'Weiteren Link einfügen...'
                    return (
                      <div key={slot} className="group/btn relative w-full">
                        {hasLink ? (
                          <>
                            <a
                              href={link!.url!.trim()}
                              target="_blank"
                              rel="noreferrer"
                              className="block w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-center text-sm text-slate-200 hover:bg-slate-700 hover:text-white"
                              title={link!.url}
                            >
                              <span className="block truncate">{label}</span>
                            </a>
                            <button
                              type="button"
                              onClick={(e) => clearCustomLinkSlot(slot, e)}
                              className="absolute -right-1 -top-1 z-10 rounded-full bg-slate-700 p-1 opacity-0 shadow group-hover/btn:opacity-100 hover:bg-red-600"
                              aria-label="Link entfernen"
                              title="Link zurücksetzen"
                            >
                              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="3 6 5 6 21 6" />
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                <line x1="10" y1="11" x2="10" y2="17" />
                                <line x1="14" y1="11" x2="14" y2="17" />
                              </svg>
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={() => openCustomLinkDialog(slot)}
                            className="w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-200 hover:bg-slate-700 hover:text-white"
                          >
                            {label}
                          </button>
                        )}
                      </div>
                    )
                  })}
                  {(currentBlakadderItem?.model ?? currentBlakadderItem?.type ?? currentBlakadderItem?.category) && (
                    <div className="flex flex-col gap-0.5 text-xs text-slate-400">
                      {currentBlakadderItem?.model != null && currentBlakadderItem.model !== '' && (
                        <div><span className="text-slate-500">model:</span> {currentBlakadderItem.model}</div>
                      )}
                      {currentBlakadderItem?.type != null && currentBlakadderItem.type !== '' && (
                        <div><span className="text-slate-500">type:</span> {currentBlakadderItem.type}</div>
                      )}
                      {currentBlakadderItem?.category != null && currentBlakadderItem.category !== '' && (
                        <div><span className="text-slate-500">category:</span> {currentBlakadderItem.category}</div>
                      )}
                    </div>
                  )}
                </div>
                </div>
              </div>
              <div
                className="w-1/6 min-w-0 flex flex-col overflow-hidden shrink-0"
                style={
                  deviceTypeColumnHeight != null && deviceTypeColumnHeight > 0
                    ? { height: `${deviceTypeColumnHeight}px`, minHeight: `${deviceTypeColumnHeight}px` }
                    : undefined
                }
              >
                <label className="mb-1 block shrink-0 text-xs font-medium text-slate-400">
                  GPIO-Zuordnungen
                </label>
                <div className="telemetry-scroll min-h-0 flex-1 overflow-auto rounded-lg border border-slate-700 bg-slate-800/50">
                  {gpioAssignments.length === 0 ? (
                    <p className="p-2 text-xs text-slate-500">Keine Daten. Template wird beim Öffnen angefragt.</p>
                  ) : (
                    <table className="w-full border-collapse border-t border-slate-700 text-left text-xs">
                      <thead className="sticky top-0 z-[1] bg-slate-800/95 shadow-[0_1px_0_0_rgba(51,65,85,0.5)]">
                        <tr>
                          <th className="px-2 py-1 font-medium text-slate-400">GPIO</th>
                          <th className="px-2 py-1 font-medium text-slate-400">Komponente</th>
                        </tr>
                      </thead>
                      <tbody>
                        {gpioAssignments.map(({ gpio, label }) => (
                          <tr key={gpio} className="border-b border-slate-700/50">
                            <td className="px-2 py-0.5 text-slate-300">{gpio}</td>
                            <td className="px-2 py-0.5 text-slate-200">{label}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
              <div
                className="w-1/6 min-w-0 flex flex-col overflow-hidden shrink-0"
                style={
                  deviceTypeColumnHeight != null && deviceTypeColumnHeight > 0
                    ? { height: `${deviceTypeColumnHeight}px`, minHeight: `${deviceTypeColumnHeight}px` }
                    : undefined
                }
              >
                <label className="mb-1 block shrink-0 text-xs font-medium text-slate-400">
                  WebUI-Theme
                </label>
                <div className="group relative min-h-0 flex-1 overflow-hidden rounded-lg border border-slate-700 bg-slate-800/50">
                  {TASMOTA_WEBUI_THEMES.length > 0 ? (
                    (() => {
                      const showDeviceSlot = hasDeviceThemeSlot && webUiThemeCarouselIndex === -1
                      const safeIndex = Math.max(0, Math.min(webUiThemeCarouselIndex, TASMOTA_WEBUI_THEMES.length - 1))
                      const currentTheme = TASMOTA_WEBUI_THEMES[safeIndex]
                      const displayThemeName = showDeviceSlot
                        ? 'Geräte-Theme (nicht in Liste)'
                        : (currentTheme?.name ?? '')
                      const displayColors = showDeviceSlot
                        ? (webUiStoredColors ?? []).slice(0, 10)
                        : (currentTheme?.colors ?? [])
                      const showThemeImage = !showDeviceSlot && !!currentTheme?.image && !webUiThemeImageErrors.has(safeIndex)
                      const themeSlotCount = hasDeviceThemeSlot ? TASMOTA_WEBUI_THEMES.length + 1 : TASMOTA_WEBUI_THEMES.length
                      const canGoPrev = () =>
                        setWebUiThemeCarouselIndex((i) => {
                          if (hasDeviceThemeSlot) return i <= -1 ? TASMOTA_WEBUI_THEMES.length - 1 : i - 1
                          return i <= 0 ? TASMOTA_WEBUI_THEMES.length - 1 : i - 1
                        })
                      const canGoNext = () =>
                        setWebUiThemeCarouselIndex((i) => {
                          if (hasDeviceThemeSlot) return i >= TASMOTA_WEBUI_THEMES.length - 1 ? -1 : i + 1
                          return i >= TASMOTA_WEBUI_THEMES.length - 1 ? 0 : i + 1
                        })
                      return (
                        <>
                          <div className="absolute left-0 right-0 top-0 z-10 px-1 py-0.5 text-center text-[10px] font-medium text-slate-400">
                            {displayThemeName}
                          </div>
                          <div className="flex h-full min-h-[4rem] flex-col gap-1 p-2 pt-5">
                            <div className="relative flex-1 min-h-12 w-full overflow-hidden rounded border border-slate-600">
                              <div
                                className="absolute inset-0"
                                style={{
                                  background: displayColors.length
                                    ? `linear-gradient(to right, ${displayColors.join(', ')})`
                                    : undefined,
                                  backgroundColor: !displayColors.length ? 'rgb(51 65 85)' : undefined,
                                }}
                                title={displayThemeName}
                                aria-hidden
                              />
                              {showThemeImage && (
                                <img
                                  src={(() => {
                                    const base = (import.meta.env?.BASE_URL ?? '/').replace(/\/$/, '') || ''
                                    const path = (currentTheme?.image ?? '').replace(/^\//, '')
                                    return path ? `${base}/${path}` : ''
                                  })()}
                                  alt=""
                                  className="absolute inset-0 h-full w-full object-cover object-center"
                                  title={currentTheme?.name}
                                  onError={() =>
                                    setWebUiThemeImageErrors((prev) => new Set(prev).add(safeIndex))
                                  }
                                />
                              )}
                            </div>
                            {themeSlotCount > 1 && (
                              <>
                                <button
                                  type="button"
                                  className="absolute left-0 top-1/2 z-20 -translate-y-1/2 rounded-r bg-slate-800/90 p-1 opacity-0 shadow transition-opacity group-hover:opacity-100 hover:bg-slate-700"
                                  aria-label="Vorheriges Theme"
                                  onClick={canGoPrev}
                                >
                                  <svg className="h-4 w-4 text-slate-200" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <polyline points="15 18 9 12 15 6" />
                                  </svg>
                                </button>
                                <button
                                  type="button"
                                  className="absolute right-0 top-1/2 z-20 -translate-y-1/2 rounded-l bg-slate-800/90 p-1 opacity-0 shadow transition-opacity group-hover:opacity-100 hover:bg-slate-700"
                                  aria-label="Nächstes Theme"
                                  onClick={canGoNext}
                                >
                                  <svg className="h-4 w-4 text-slate-200" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <polyline points="9 18 15 12 9 6" />
                                  </svg>
                                </button>
                              </>
                            )}
                            {device && !showDeviceSlot && currentWebUiThemeIndex !== safeIndex && (
                              <button
                                type="button"
                                className="absolute bottom-1 right-1 z-20 rounded bg-emerald-600/90 p-1.5 opacity-0 shadow transition-opacity group-hover:opacity-100 hover:bg-emerald-500"
                                aria-label="Theme anwenden"
                                title="Theme anwenden"
                                onClick={() => {
                                  if (currentTheme?.payload) onSendCommand(device.id, 'WebColor', currentTheme.payload)
                                }}
                              >
                            <svg className="h-4 w-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                              <polyline points="7 10 12 15 17 10" />
                              <line x1="12" y1="15" x2="12" y2="3" />
                            </svg>
                          </button>
                        )}
                      </div>
                        </>
                      );
                    })()
                  ) : (
                    <div className="flex h-full min-h-[4rem] items-center justify-center p-2 text-xs text-slate-500">
                      Keine Themes
                    </div>
                  )}
                </div>
              </div>
              <div
                className="min-w-0 flex-1 flex flex-col overflow-hidden shrink-0"
                style={
                  deviceTypeColumnHeight != null && deviceTypeColumnHeight > 0
                    ? { height: `${deviceTypeColumnHeight}px`, minHeight: `${deviceTypeColumnHeight}px` }
                    : undefined
                }
              >
                <label className="mb-1 block shrink-0 text-xs font-medium text-slate-400">
                  Position &amp; Projektbeschreibung
                </label>
                <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden rounded-lg border border-slate-700 bg-slate-800/50 p-2">
                  <div className="relative shrink-0">
                    <label htmlFor="device-location-input" className="mb-0.5 block text-[10px] text-slate-500">
                      Standort
                    </label>
                    <input
                      ref={locationInputRef}
                      id="device-location-input"
                      type="text"
                      value={locationInput}
                      onChange={(e) => setLocationInput(e.target.value)}
                      onFocus={() => {
                        locationFocusedRef.current = true
                        if (locationOptions.length > 0) {
                          setLocationDropdownOpen(true)
                          const idx = locationOptions.indexOf(locationInput.trim())
                          setLocationHighlightedIndex(idx >= 0 ? idx : 0)
                        }
                      }}
                      onBlur={() => {
                        locationFocusedRef.current = false
                        setTimeout(() => setLocationDropdownOpen(false), 150)
                      }}
                      onKeyDown={(e) => {
                        if (!locationDropdownOpen || locationOptions.length === 0) return
                        if (e.key === 'ArrowDown') {
                          e.preventDefault()
                          setLocationHighlightedIndex((i) => Math.min(locationOptions.length - 1, i + 1))
                          return
                        }
                        if (e.key === 'ArrowUp') {
                          e.preventDefault()
                          setLocationHighlightedIndex((i) => Math.max(0, i - 1))
                          return
                        }
                        if (e.key === 'Enter' && locationOptions.length > 0) {
                          e.preventDefault()
                          const opt = locationOptions[locationHighlightedIndex]
                          if (opt != null) {
                            setLocationInput(opt)
                            setLocationDropdownOpen(false)
                          }
                        }
                      }}
                      placeholder="z. B. EG, Keller"
                      className="w-full rounded border border-slate-600 bg-slate-900 py-1.5 pl-2 pr-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-emerald-500/50 focus:outline-none focus:ring-1 focus:ring-emerald-500/30"
                      autoComplete="off"
                    />
                    {locationDropdownOpen && locationOptions.length > 0 && locationDropdownRect &&
                      createPortal(
                        <ul
                          className="fixed z-[200] max-h-40 overflow-auto rounded border border-slate-700 bg-slate-900 py-1 shadow-lg"
                          role="listbox"
                          aria-activedescendant={`location-option-${locationHighlightedIndex}`}
                          style={{
                            top: locationDropdownRect.top,
                            left: locationDropdownRect.left,
                            minWidth: locationDropdownRect.width,
                          }}
                        >
                          {locationOptions.map((opt, index) => (
                            <li
                              key={opt}
                              id={`location-option-${index}`}
                              role="option"
                              aria-selected={locationHighlightedIndex === index}
                              className={`cursor-pointer px-2 py-1.5 text-sm hover:bg-slate-800 ${
                                locationHighlightedIndex === index ? 'bg-slate-800 text-slate-100' : 'text-slate-200'
                              }`}
                              onMouseDown={(ev) => {
                                ev.preventDefault()
                                setLocationInput(opt)
                                setLocationDropdownOpen(false)
                              }}
                            >
                              {opt}
                            </li>
                          ))}
                        </ul>,
                        document.body
                      )}
                  </div>
                  <div className="relative shrink-0">
                    <label htmlFor="device-room-input" className="mb-0.5 block text-[10px] text-slate-500">
                      Raum
                    </label>
                    <input
                      ref={roomInputRef}
                      id="device-room-input"
                      type="text"
                      value={roomInput}
                      onChange={(e) => setRoomInput(e.target.value)}
                      onFocus={() => {
                        roomFocusedRef.current = true
                        if (roomOptions.length > 0) {
                          setRoomDropdownOpen(true)
                          const idx = roomOptions.indexOf(roomInput.trim())
                          setRoomHighlightedIndex(idx >= 0 ? idx : 0)
                        }
                      }}
                      onBlur={() => {
                        roomFocusedRef.current = false
                        setTimeout(() => setRoomDropdownOpen(false), 150)
                      }}
                      onKeyDown={(e) => {
                        if (!roomDropdownOpen || roomOptions.length === 0) return
                        if (e.key === 'ArrowDown') {
                          e.preventDefault()
                          setRoomHighlightedIndex((i) => Math.min(roomOptions.length - 1, i + 1))
                          return
                        }
                        if (e.key === 'ArrowUp') {
                          e.preventDefault()
                          setRoomHighlightedIndex((i) => Math.max(0, i - 1))
                          return
                        }
                        if (e.key === 'Enter' && roomOptions.length > 0) {
                          e.preventDefault()
                          const opt = roomOptions[roomHighlightedIndex]
                          if (opt != null) {
                            setRoomInput(opt)
                            setRoomDropdownOpen(false)
                          }
                        }
                      }}
                      placeholder="z. B. Wohnzimmer"
                      className="w-full rounded border border-slate-600 bg-slate-900 py-1.5 pl-2 pr-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-emerald-500/50 focus:outline-none focus:ring-1 focus:ring-emerald-500/30"
                      autoComplete="off"
                    />
                    {roomDropdownOpen && roomOptions.length > 0 && roomDropdownRect &&
                      createPortal(
                        <ul
                          className="fixed z-[200] max-h-40 overflow-auto rounded border border-slate-700 bg-slate-900 py-1 shadow-lg"
                          role="listbox"
                          aria-activedescendant={`room-option-${roomHighlightedIndex}`}
                          style={{
                            top: roomDropdownRect.top,
                            left: roomDropdownRect.left,
                            minWidth: roomDropdownRect.width,
                          }}
                        >
                          {roomOptions.map((opt, index) => (
                            <li
                              key={opt}
                              id={`room-option-${index}`}
                              role="option"
                              aria-selected={roomHighlightedIndex === index}
                              className={`cursor-pointer px-2 py-1.5 text-sm hover:bg-slate-800 ${
                                roomHighlightedIndex === index ? 'bg-slate-800 text-slate-100' : 'text-slate-200'
                              }`}
                              onMouseDown={(ev) => {
                                ev.preventDefault()
                                setRoomInput(opt)
                                setRoomDropdownOpen(false)
                              }}
                            >
                            {opt}
                          </li>
                        ))}
                        </ul>,
                        document.body
                      )}
                  </div>
                  <div className="flex min-h-0 flex-1 flex-col shrink-0">
                    <label htmlFor="device-project-description" className="mb-0.5 block text-[10px] text-slate-500">
                      Kurze Beschreibung des Projektes
                    </label>
                    <textarea
                      id="device-project-description"
                      value={projectDescriptionInput}
                      onChange={(e) => setProjectDescriptionInput(e.target.value)}
                      onFocus={() => { projectDescriptionFocusedRef.current = true }}
                      onBlur={() => {
                        projectDescriptionFocusedRef.current = false
                        persistProjectDescription()
                      }}
                      placeholder="z. B. Steuerung der Beleuchtung im Wohnzimmer"
                      rows={3}
                      className="telemetry-scroll min-h-0 flex-1 resize-none overflow-auto rounded border border-slate-600 bg-slate-900 p-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-emerald-500/50 focus:outline-none focus:ring-1 focus:ring-emerald-500/30"
                    />
                  </div>
                </div>
              </div>
            </div>
            )}
            <input
              ref={deviceTypeFileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleDeviceTypeFileSelect}
            />
            {customLinkDialogOpen && (
              <div
                className="fixed inset-0 z-[210] flex items-center justify-center bg-black/60 p-4"
                onClick={() => setCustomLinkDialogOpen(false)}
                role="dialog"
                aria-modal="true"
                aria-label="Link bearbeiten"
              >
                <div
                  className="w-full max-w-md rounded-xl border border-slate-600 bg-slate-900 p-4 shadow-xl"
                  onClick={(e) => e.stopPropagation()}
                >
                  <h3 className="mb-3 text-sm font-semibold text-slate-200">Titel und Link</h3>
                  <div className="space-y-3">
                    <div>
                      <label htmlFor="custom-link-title" className="mb-1 block text-xs text-slate-400">Titel</label>
                      <input
                        id="custom-link-title"
                        type="text"
                        value={customLinkDialogTitle}
                        onChange={(e) => setCustomLinkDialogTitle(e.target.value)}
                        placeholder="z. B. Hersteller"
                        className="w-full rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
                      />
                    </div>
                    <div>
                      <label htmlFor="custom-link-url" className="mb-1 block text-xs text-slate-400">Link (URL)</label>
                      <input
                        id="custom-link-url"
                        type="url"
                        value={customLinkDialogUrl}
                        onChange={(e) => setCustomLinkDialogUrl(e.target.value)}
                        placeholder="https://..."
                        className="w-full rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
                      />
                    </div>
                  </div>
                  <div className="mt-4 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setCustomLinkDialogOpen(false)}
                      className="rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-300 hover:bg-slate-800"
                    >
                      Abbrechen
                    </button>
                    <button
                      type="button"
                      onClick={saveCustomLink}
                      disabled={!customLinkDialogUrl.trim()}
                      className="rounded-lg bg-emerald-600 px-3 py-2 text-sm text-white hover:bg-emerald-500 disabled:opacity-50 disabled:hover:bg-emerald-600"
                    >
                      Übernehmen
                    </button>
                  </div>
                </div>
              </div>
            )}
            {deviceTypeImageLightboxOpen && currentDeviceTypeImage && (
              <div
                className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-4"
                onClick={() => setDeviceTypeImageLightboxOpen(false)}
                role="dialog"
                aria-modal="true"
                aria-label="Bild vergrößert anzeigen"
              >
                <div
                  className="relative flex max-h-[90vh] max-w-5xl flex-1 flex-col items-center justify-center rounded-xl border border-slate-600 bg-white shadow-xl"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    onClick={() => setDeviceTypeImageLightboxOpen(false)}
                    className="absolute right-2 top-2 z-10 rounded p-2 text-slate-600 hover:bg-slate-200 hover:text-slate-900"
                    aria-label="Schließen"
                  >
                    <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                  <div className="relative flex min-h-0 w-full flex-1 items-center justify-center p-12 pt-14">
                    <img
                      src={currentDeviceTypeImage}
                      alt=""
                      className="max-h-[75vh] max-w-full object-contain"
                    />
                    {deviceTypeImageIndex > 0 && (
                      <button
                        type="button"
                        onClick={() => setDeviceTypeImageIndex((i) => Math.max(0, i - 1))}
                        className="absolute left-2 top-1/2 -translate-y-1/2 rounded-lg bg-slate-800/90 p-3 text-slate-200 shadow hover:bg-slate-700"
                        aria-label="Vorheriges Bild"
                      >
                        <svg className="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="15 18 9 12 15 6" />
                        </svg>
                      </button>
                    )}
                    {deviceTypeImageIndex < allDeviceTypeImages.length - 1 && (
                      <button
                        type="button"
                        onClick={() => setDeviceTypeImageIndex((i) => Math.min(allDeviceTypeImages.length - 1, i + 1))}
                        className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg bg-slate-800/90 p-3 text-slate-200 shadow hover:bg-slate-700"
                        aria-label="Nächstes Bild"
                      >
                        <svg className="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="9 18 15 12 9 6" />
                        </svg>
                      </button>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 p-3">
                    <div>
                      {productUrl && productDomainLabel && (
                        <a
                          href={productUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-lg border border-slate-500 bg-slate-700 px-3 py-2 text-sm text-white hover:bg-slate-600"
                          title={productUrl}
                        >
                          {productDomainLabel}
                        </a>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={handleAddDeviceTypeImage}
                        className="rounded-lg bg-slate-700 px-3 py-2 text-sm text-white hover:bg-slate-600"
                        title="Bild hinzufügen (Zwischenablage oder Datei)"
                      >
                        Bild hinzufügen
                      </button>
                      {isCurrentImageCustom && (
                        <button
                          type="button"
                          onClick={handleRemoveDeviceTypeImage}
                          className="rounded-lg bg-red-600 px-3 py-2 text-sm text-white hover:bg-red-500"
                          title="Dieses Bild entfernen"
                        >
                          Bild entfernen
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
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
              | { id: string; title: string; type: 'backup' }
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
              ...(onBackup && device
                ? [{ id: 'backup', title: 'Backup', type: 'backup' as const }]
                : []),
              ...CONFIG_BLOCK_IDS.map((id) => ({ id, title: id, type: 'config' as const })),
            ]

            const collapsedList = blockList.filter((b) => collapsedBlockIds.has(b.id))
            const expandedList = blockList.filter((b) => !collapsedBlockIds.has(b.id))
            const expandedGridBlocks = expandedList.filter(
              (b): b is BlockItem & { type: 'sensor' | 'power' } =>
                b.type === 'sensor' || b.type === 'power',
            )
            const expandedBackupBlock = expandedList.find(
              (b): b is BlockItem & { type: 'backup' } => b.type === 'backup',
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
                  {expandedBackupBlock && device && (
                    <div className="device-settings-expanded-item w-full">
                      <BackupBlock
                        device={device}
                        onCollapse={() => setCollapsed(expandedBackupBlock.id, true)}
                        onDeleteBackup={onDeleteBackup}
                        onDownloadBackup={onDownloadBackup}
                        onUpdateAutoBackup={onUpdateAutoBackup}
                        onBackup={onBackup}
                        backingUp={backingUp}
                        backendAvailable={backendAvailable}
                      />
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
                            ) : block.id === 'Switche' && device ? (
                              <SwitcheConfigContent
                                device={device}
                                onSendCommand={onSendCommand}
                                storeTick={storeTick}
                              />
                            ) : block.id === 'Buttons' && device ? (
                              <ButtonsConfigContent device={device} storeTick={storeTick} />
                            ) : block.id === 'WiFi' && device ? (
                              <WiFiConfigContent
                                device={device}
                                onSendCommand={onSendCommand}
                                storeTick={storeTick}
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
