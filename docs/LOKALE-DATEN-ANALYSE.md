# Wo werden Daten lokal gespeichert?

## localStorage (persistent im Browser)

| Speicherort | Inhalt | Datei |
|-------------|--------|--------|
| `tasmotascope.settings.v1` | CouchDB- und MQTT-Verbindungsdaten (Host, Port, User, Passwort, Datenbankname) | `src/lib/storage.ts` |
| `tasmotascope.activeBrokerId` | ID des zuletzt gewählten MQTT-Brokers | `src/lib/storage.ts` |
| Template-Storage (Rules) | Gespeicherte Rule-Templates (Text) | `src/lib/templateStorage.ts` |

**Hinweis:** Keine gerätebezogenen Daten (keine Backups, kein Auto-Backup-Intervall) werden in localStorage gelegt.

---

## In-Memory (Frontend – nur bis zum Neuladen/DB-Wechsel)

| Speicherort | Inhalt | Quelle der Wahrheit |
|-------------|--------|----------------------|
| **DeviceState** (shared `deviceStore`) | Alle Geräte: Name, IP, Firmware, Modul, Uptime, **autoBackupIntervalDays**, backupCount, backupItems, raw, rules, settingsUi, … | Backend/CouchDB via SSE und Hydration |

- **Problem (behoben):** Beim Wechsel der CouchDB-Datenbank blieb der alte Geräte-Stand im Speicher. Beim Hydratisieren aus den neuen Backend-Daten wurde `autoBackupIntervalDays` mit dem **bisherigen** Eintrag zusammengeführt (`?? record.info.autoBackupIntervalDays`), sodass z. B. „1 Tag“ von der alten DB weiter angezeigt wurde.
- **Lösung:**
  1. Beim erfolgreichen Übernehmen einer neuen CouchDB-Konfiguration wird der Geräte-Store geleert (`DeviceState.clearAllDevices()`) und die Geräteliste zurückgesetzt.
  2. In `hydrateFromSnapshots` gilt für `autoBackupIntervalDays`: **nur** der Wert aus dem Snapshot (Backend) wird übernommen; es gibt keinen Fallback auf den bisherigen lokalen Wert mehr.

---

## Auto-Backup (Überblick)

- **Persistenz:** `autoBackupIntervalDays` wird im Backend in CouchDB pro Gerät gespeichert (Dokument pro Gerät).
- **Frontend:** Änderungen (Einzelgerät oder Bulk „Auto-Backup bei X Tagen“) gehen über `DeviceState.updateInfo(…)`, der Store markiert das Gerät als „dirty“ und schreibt über die Persist-Funktion (`upsertDeviceSnapshot` → CouchDB) ins Backend.
- **Bulk-Operation:** Der Wert für „Auto-Backup bei X Tagen“ kommt aus dem Eingabefeld in der Geräteliste; Standardwert des Feldes ist `DEFAULT_BULK_AUTO_BACKUP_DAYS` (100) in `DeviceList.tsx` – nur UI-Default, kein gespeicherter Gerätewert.
- **Anzeige:** In der Geräte-Einstellungsseite wird „Automatisches Backup“ nur als aktiv angezeigt, wenn `device.autoBackupIntervalDays != null && device.autoBackupIntervalDays > 0`. Die Daten dafür kommen nach dem Fix ausschließlich aus dem Backend (SSE/Hydration).

---

## Kurzfassung

- **Lokal persistent:** Nur Einstellungen (CouchDB/MQTT) und aktiver Broker in localStorage; Rule-Templates separat.
- **Lokal flüchtig:** Kompletter Gerätestand in `DeviceState`; Backend/CouchDB ist die Quelle der Wahrheit. Beim CouchDB-Wechsel wird der Store geleert und neu aus dem Backend befüllt; `autoBackupIntervalDays` wird bei der Hydration nur noch aus dem Snapshot übernommen.
