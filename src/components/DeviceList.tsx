import type { DeviceInfo } from '../lib/types'

type Props = {
  devices: DeviceInfo[]
  onRestart: (deviceId: string) => void
  restarting: Record<string, boolean>
  onTogglePower: (deviceId: string, channelId: number) => void
  onOpenPowerModal: (deviceId: string) => void
  onOpenTelemetry: (deviceId: string) => void
  onOpenRules: (deviceId: string) => void
  onOpenSettings?: (deviceId: string) => void
  onBackup?: (deviceId: string) => void
  backingUp?: Record<string, boolean>
  backendAvailable?: boolean
}

export default function DeviceList({
  devices,
  onRestart,
  restarting,
  onTogglePower,
  onOpenPowerModal,
  onOpenTelemetry,
  onOpenRules,
  onOpenSettings,
  onBackup,
  backingUp = {},
  backendAvailable = false,
}: Props) {
  if (devices.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-700 bg-slate-950/50 p-8 text-center text-sm text-slate-300">
        Noch keine Geräte gefunden. Sobald Tasmota-Geräte im Broker aktiv sind, erscheinen sie
        automatisch.
      </div>
    )
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/40">
      <table className="min-w-full text-left text-sm text-slate-200">
        <thead className="bg-slate-900/60 text-xs uppercase text-slate-400">
          <tr>
            <th className="w-[10rem] px-4 py-3">Gerät</th>
            <th className="hidden w-[6rem] px-2 py-3 xl:table-cell">Firmware</th>
            <th className="hidden w-12 px-1 py-3 xl:table-cell">Backup</th>
            <th className="hidden px-3 py-3 lg:table-cell">Modul</th>
            <th className="hidden px-4 py-3 md:table-cell">Uptime</th>
            <th className="hidden px-1 py-3 sm:table-cell">LWT</th>
            <th className="hidden px-4 py-3 sm:table-cell">IP-Adresse</th>
            <th className="px-1 py-3 text-left">Power</th>
            <th className="w-[9rem] px-4 py-3 text-center">Aktion</th>
          </tr>
        </thead>
        <tbody>
          {devices.map((device) => (
            <tr
              key={device.id}
              className="cursor-pointer border-t border-slate-800 hover:bg-slate-800/30"
              onDoubleClick={(e) => {
                if ((e.target as HTMLElement).closest('button')) return
                onOpenSettings?.(device.id)
              }}
            >
              <td className="px-4 py-3 font-medium text-white">
                <div className="flex items-center gap-2">
                  <span
                    className="flex h-4 items-end gap-0.5"
                    aria-label="Signalstärke"
                    title={
                      typeof device.signal === 'number'
                        ? `Signal: ${device.signal}%`
                        : 'Signal: unbekannt'
                    }
                  >
                    {[1, 2, 3, 4].map((bar, index) => {
                      const heights = ['h-1.5', 'h-2.5', 'h-3.5', 'h-4']
                      const level =
                        typeof device.signal === 'number'
                          ? Math.min(4, Math.max(1, Math.ceil(device.signal / 25)))
                          : 0
                      const active = level >= bar
                      return (
                        <span
                          key={bar}
                          className={`w-1 rounded-sm ${
                            active ? 'bg-emerald-400' : 'bg-slate-700'
                          } ${heights[index]}`}
                        />
                      )
                    })}
                  </span>
                  <span>{device.name}</span>
                </div>
                <div className="pl-7 text-xs text-slate-400">{device.id}</div>
              </td>
              <td className="hidden px-2 py-3 xl:table-cell">{device.firmware || '-'}</td>
              <td className="hidden px-1 py-3 xl:table-cell">
                {onBackup ? (
                  (() => {
                    const canBackup = backendAvailable && device.ip && !backingUp[device.id]
                    const days = device.daysSinceBackup
                    const count = device.backupCount ?? 0
                    const color =
                      days == null || days >= 100
                        ? 'text-rose-400'
                        : days >= 50
                          ? 'text-blue-400'
                          : 'text-emerald-400'
                    const title = !device.ip
                      ? 'Backup benötigt Gerät-IP'
                      : !backendAvailable
                        ? 'Backup benötigt Backend (Docker-Variante)'
                        : backingUp[device.id]
                          ? 'Backup läuft…'
                          : days != null
                            ? `Letztes Backup vor ${days} Tagen • ${count}/10 gespeichert`
                            : `Noch kein Backup • ${count}/10 gespeichert`
                    return (
                      <div className="flex flex-col items-center gap-1">
                        <button
                        type="button"
                        onClick={() => onBackup(device.id)}
                        disabled={!canBackup}
                        className={`rounded-md border border-slate-700 p-1 disabled:cursor-not-allowed disabled:opacity-50 ${color} ${
                          canBackup ? 'hover:bg-slate-800' : ''
                        }`}
                        aria-label="Backup"
                        title={title}
                      >
                        {backingUp[device.id] ? (
                          <svg
                            className="h-4 w-4 animate-spin"
                            viewBox="0 0 24 24"
                            fill="none"
                            aria-hidden="true"
                          >
                            <circle
                              cx="12"
                              cy="12"
                              r="10"
                              stroke="currentColor"
                              strokeWidth="2"
                            />
                            <path
                              d="M12 2a10 10 0 0 1 10 10"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                            />
                          </svg>
                        ) : (
                          <svg
                            className="h-4 w-4"
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
                        )}
                      </button>
                        <div
                          className="flex gap-px"
                          title={`${count}/10 Backups`}
                          aria-hidden="true"
                        >
                          {Array.from({ length: 10 }, (_, i) => (
                            <span
                              key={i}
                              className={`h-1.5 w-1 rounded-sm ${
                                i < count ? 'bg-slate-400' : 'bg-slate-700/40'
                              }`}
                            />
                          ))}
                        </div>
                      </div>
                    )
                  })()
                ) : (
                  '-'
                )}
              </td>
              <td className="hidden px-3 py-3 lg:table-cell">{device.module || '-'}</td>
              <td className="hidden px-4 py-3 md:table-cell">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onRestart(device.id)}
                    disabled={Boolean(restarting[device.id])}
                    className={`rounded-md border border-slate-700 p-1 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 ${
                      restarting[device.id] ? 'text-rose-300' : 'text-slate-200'
                    }`}
                    aria-label="Neustart"
                    title="Neustart"
                  >
                    <svg
                      className="h-4 w-4"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
                      <polyline points="21 3 21 9 15 9" />
                    </svg>
                  </button>
                  <span>{device.uptime || '-'}</span>
                </div>
              </td>
              <td className="hidden px-1 py-3 sm:table-cell">
                <span
                  className={`inline-flex h-3.5 w-3.5 rounded-full ${
                    device.online === true
                      ? 'bg-emerald-400'
                      : device.online === false
                        ? 'bg-rose-400'
                        : 'bg-slate-500'
                  }`}
                  aria-label={
                    device.online === true
                      ? 'Online'
                      : device.online === false
                        ? 'Offline'
                        : 'Unbekannt'
                  }
                  title={
                    device.online === true
                      ? 'Online'
                      : device.online === false
                        ? 'Offline'
                        : 'Unbekannt'
                  }
                />
              </td>
              <td className="hidden px-4 py-3 sm:table-cell">
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
              </td>
              <td className="min-w-[6rem] px-1 py-3">
                {device.powerChannels && device.powerChannels.length > 0 ? (
                  (() => {
                    const total = device.powerChannels?.length ?? 0
                    const overflow = total > 8
                    const compact = total > 2
                    const shown = overflow ? device.powerChannels.slice(0, 8) : device.powerChannels
                    const layoutClass =
                      total <= 2
                        ? 'inline-flex items-center gap-1'
                        : total <= 4
                          ? 'inline-grid grid-cols-2 justify-items-center gap-x-0.5 gap-y-0.5'
                          : 'inline-grid grid-cols-4 justify-items-center gap-0.5'
                    return (
                      <div className={layoutClass}>
                        {shown.map((channel) => {
                          const active = channel.state === 'ON'
                          const title = channel.label
                            ? `Power ${channel.id}: ${channel.label}`
                            : `Power ${channel.id}`
                          const showIcon = total <= 2
                          return (
                            <button
                              key={channel.id}
                              type="button"
                              onClick={() =>
                                overflow
                                  ? onOpenPowerModal(device.id)
                                  : onTogglePower(device.id, channel.id)
                              }
                              className={`flex items-center justify-center rounded-md border font-semibold ${
                                compact ? 'h-5 w-5 text-[10px]' : 'h-7 w-7 text-xs'
                              } ${
                                active
                                  ? 'border-amber-400/50 bg-amber-400/10 text-amber-300'
                                  : 'border-slate-700 text-slate-200'
                              } hover:bg-slate-800`}
                              aria-pressed={active}
                              aria-label={`Power ${channel.id}`}
                              title={title}
                            >
                              {showIcon ? (
                                <svg
                                  className={compact ? 'h-3 w-3' : 'h-4 w-4'}
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
                              ) : null}
                            </button>
                          )
                        })}
                      </div>
                    )
                  })()
                ) : null}
              </td>
              <td className="w-[9rem] px-4 py-3 text-right">
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    className="rounded-md border border-slate-700 p-1 text-slate-200 hover:bg-slate-800"
                    aria-label="Einstellungen"
                    title="Einstellungen"
                    onClick={(e) => {
                      e.stopPropagation()
                      onOpenSettings?.(device.id)
                    }}
                  >
                    <svg
                      className="h-4 w-4"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <circle cx="12" cy="12" r="3" />
                      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01A1.65 1.65 0 0 0 10 3.09V3a2 2 0 1 1 4 0v.09c0 .66.39 1.25 1 1.51h.01c.51.22 1.1.12 1.5-.27l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06c-.4.4-.5.99-.27 1.5v.01c.26.61.85 1 1.51 1H21a2 2 0 1 1 0 4h-.09c-.66 0-1.25.39-1.51 1z" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    className="rounded-md border border-slate-700 p-1 text-slate-200 hover:bg-slate-800"
                    aria-label="Telemetrie"
                    title="Telemetrie"
                    onClick={() => onOpenTelemetry(device.id)}
                  >
                    <svg
                      className="h-4 w-4"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <polyline points="3 12 9 6 13 10 21 2" />
                      <polyline points="21 8 21 2 15 2" />
                      <path d="M3 22h18" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    className="rounded-md border border-slate-700 p-1 text-slate-200 hover:bg-slate-800"
                    aria-label="Regeln"
                    title="Regeln"
                    onClick={() => onOpenRules(device.id)}
                  >
                    <svg
                      className="h-4 w-4"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M5 4h4v4H5z" />
                      <path d="M15 16h4v4h-4z" />
                      <path d="M7 8v4h4" />
                      <path d="M11 12h4v4" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    className="rounded-md border border-slate-700 p-1 text-slate-200 hover:bg-slate-800"
                    aria-label="Timer"
                    title="Timer"
                  >
                    <svg
                      className="h-4 w-4"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M10 2h4" />
                      <path d="M12 14v-4" />
                      <circle cx="12" cy="14" r="8" />
                    </svg>
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
