import express from 'express'
import cors from 'cors'
import { backupRouter, runScheduledAutoBackups } from './backup.js'

const app = express()
const PORT = process.env.PORT || 3001

app.use(cors())
app.use(express.json({ limit: '1mb' }))
app.use('/api', backupRouter)

/**
 * CouchDB aus Umgebungsvariablen für den Auto-Backup-Scheduler.
 * Optionale Variablen: COUCHDB_HOST, COUCHDB_DATABASE, COUCHDB_PORT (default 5984),
 * COUCHDB_SECURE (1/true), COUCHDB_USER, COUCHDB_PASSWORD.
 */
function getCouchDbFromEnv(): { host: string; port: number; useTls: boolean; username: string; password: string; database: string } | null {
  const host = process.env.COUCHDB_HOST
  const database = process.env.COUCHDB_DATABASE
  if (!host || !database) return null
  const port = parseInt(process.env.COUCHDB_PORT ?? '5984', 10)
  const useTls = process.env.COUCHDB_SECURE === '1' || process.env.COUCHDB_SECURE === 'true'
  const username = process.env.COUCHDB_USER ?? ''
  const password = process.env.COUCHDB_PASSWORD ?? ''
  return { host, port, useTls, username, password, database }
}

const AUTO_BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000 // 24 Stunden

app.listen(PORT, () => {
  console.log(`TasmotaScope Backend listening on port ${PORT}`)

  const couchdb = getCouchDbFromEnv()
  if (couchdb) {
    const run = () => {
      runScheduledAutoBackups(couchdb).catch((err) => {
        console.error('[Auto-Backup] Scheduler-Fehler:', err)
      })
    }
    setTimeout(run, 60_000) // erster Lauf nach 1 Minute
    setInterval(run, AUTO_BACKUP_INTERVAL_MS)
    console.log('Auto-Backup-Scheduler aktiv (alle 24 h)')
  } else {
    console.log('Auto-Backup-Scheduler inaktiv (COUCHDB_HOST und COUCHDB_DATABASE nicht gesetzt)')
  }
})
