import type { HydrateSnapshot } from 'tasmotascope-shared'

/**
 * Konvertiert die Backend-API-Antwort (GET /api/devices oder SSE) in HydrateSnapshot[]
 * für DeviceState.hydrateFromSnapshots().
 */
export function apiDevicesToHydrateSnapshots(
  apiDevices: Record<string, Record<string, unknown>>
): HydrateSnapshot[] {
  return Object.entries(apiDevices).map(([deviceId, d]) => {
    const raw = (d.raw as Record<string, unknown> | undefined) ?? {}
    const rules = (d.rules as Record<number, { text: string; enabled: boolean; once: boolean; stopOnError: boolean }> | undefined)
    const backupItems = (d.backupItems as { createdAt: string; data: string }[] | undefined) ?? []
    const lastAt =
      backupItems.length > 0
        ? backupItems.reduce((latest, item) =>
            item.createdAt > latest ? item.createdAt : latest
          , backupItems[0].createdAt)
        : null
    return {
      deviceId,
      brokerId: typeof d.brokerId === 'string' ? d.brokerId : undefined,
      lastSeen: typeof d.lastSeen === 'string' ? d.lastSeen : undefined,
      online: typeof d.online === 'boolean' ? d.online : undefined,
      topic: typeof d.topic === 'string' ? d.topic : undefined,
      fields: {
        name: typeof d.name === 'string' ? d.name : undefined,
        ip: typeof d.ip === 'string' ? d.ip : undefined,
        firmware: typeof d.firmware === 'string' ? d.firmware : undefined,
        module: typeof d.module === 'string' ? d.module : undefined,
        uptime: typeof d.uptime === 'string' ? d.uptime : undefined,
        signal: typeof d.signal === 'number' ? d.signal : undefined,
      },
      raw: Object.keys(raw).length > 0 ? raw : undefined,
      rules: rules && Object.keys(rules).length > 0 ? rules : undefined,
      backups:
        (d.backupCount as number | undefined) != null || lastAt
          ? {
              count: (d.backupCount as number) ?? 0,
              lastAt,
              items: backupItems,
            }
          : undefined,
      autoBackupIntervalDays:
        d.autoBackupIntervalDays !== undefined && d.autoBackupIntervalDays !== null
          ? (d.autoBackupIntervalDays as number)
          : undefined,
      settingsUi: (d.settingsUi as HydrateSnapshot['settingsUi']) ?? undefined,
    } satisfies HydrateSnapshot
  })
}
