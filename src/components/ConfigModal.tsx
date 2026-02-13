import { useEffect, useMemo, useState } from 'react'
import type { CouchDbSettings } from '../lib/types'
import { buildCouchDbCompose } from '../lib/dockerCompose'

export type ConnectionResult = {
  couchOk: boolean
  couchError?: string
}

type Props = {
  isOpen: boolean
  initialCouchDb: CouchDbSettings
  canClose: boolean
  onClose: () => void
  onApply: (couchdb: CouchDbSettings) => Promise<ConnectionResult>
}

const toNumber = (value: string) => (value ? Number(value) : 0)

export default function ConfigModal({
  isOpen,
  initialCouchDb,
  canClose,
  onClose,
  onApply,
}: Props) {
  const [form, setForm] = useState<CouchDbSettings>(initialCouchDb)
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<ConnectionResult | null>(null)
  const [copyHint, setCopyHint] = useState<string | null>(null)

  useEffect(() => {
    if (isOpen) {
      setForm(initialCouchDb)
      setResult(null)
      setCopyHint(null)
    }
  }, [initialCouchDb, isOpen])

  const couchValid = useMemo(() => {
    const { host, port, username, password, database } = form
    return (
      Boolean(host.trim()) &&
      Boolean(username.trim()) &&
      Boolean(password.trim()) &&
      Boolean(database.trim()) &&
      Number.isFinite(port) &&
      port > 0
    )
  }, [form])

  if (!isOpen) {
    return null
  }

  const updateField = <K extends keyof CouchDbSettings>(key: K, value: CouchDbSettings[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const onCopyCompose = async () => {
    try {
      await navigator.clipboard.writeText(buildCouchDbCompose(form))
      setCopyHint('Docker-Compose in die Zwischenablage kopiert.')
    } catch {
      setCopyHint('Kopieren fehlgeschlagen.')
    }
  }

  const handleApply = async () => {
    setSubmitting(true)
    setResult(null)
    setCopyHint(null)
    try {
      const res = await onApply(form)
      setResult(res)
      if (res.couchOk) {
        setSubmitting(false)
        return
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4 py-8">
      <div className="w-full max-w-2xl rounded-2xl bg-slate-900 p-6 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-white">CouchDB verbinden</h2>
            <p className="mt-1 text-sm text-slate-300">
              Backend-URL ist fest (/api). Bitte CouchDB-Daten eingeben – das Backend verbindet sich
              und startet den MQTT-Listener.
            </p>
          </div>
          {canClose && (
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-700 px-3 py-1 text-sm text-slate-200 hover:bg-slate-800"
            >
              Schließen
            </button>
          )}
        </div>

        <section className="mt-6 rounded-xl border border-slate-800 bg-slate-950/40 p-4">
          <h3 className="text-sm font-semibold text-slate-100">CouchDB</h3>
          <div className="mt-3 space-y-3">
            <label className="block text-xs text-slate-300">
              Host
              <input
                value={form.host}
                onChange={(e) => updateField('host', e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
                placeholder="localhost"
              />
            </label>
            <label className="block text-xs text-slate-300">
              Port
              <input
                value={form.port}
                onChange={(e) => updateField('port', toNumber(e.target.value))}
                type="number"
                className="mt-1 w-full rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
                placeholder="5984"
              />
            </label>
            <label className="flex items-center gap-2 text-xs text-slate-300">
              <input
                type="checkbox"
                checked={form.useTls}
                onChange={(e) => updateField('useTls', e.target.checked)}
                className="h-4 w-4 rounded border-slate-700 bg-slate-900"
              />
              TLS (HTTPS)
            </label>
            <label className="block text-xs text-slate-300">
              Benutzer
              <input
                value={form.username}
                onChange={(e) => updateField('username', e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
              />
            </label>
            <label className="block text-xs text-slate-300">
              Passwort
              <input
                value={form.password}
                onChange={(e) => updateField('password', e.target.value)}
                type="password"
                className="mt-1 w-full rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100"
              />
            </label>
            <label className="block text-xs text-slate-300">
              Datenbank
              <input
                value={form.database}
                onChange={(e) => updateField('database', e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100"
                placeholder="tasmotascope"
              />
            </label>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={onCopyCompose}
              disabled={!couchValid}
              className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Docker-Compose.yml kopieren
            </button>
            {copyHint && <span className="text-xs text-slate-300">{copyHint}</span>}
          </div>
          {result?.couchError && (
            <p className="mt-3 text-xs text-rose-300">CouchDB: {result.couchError}</p>
          )}
        </section>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <div className="ml-auto flex items-center gap-3">
            <span className="text-xs text-slate-400">
              {couchValid ? 'Alle Felder vorhanden' : 'Bitte alle Pflichtfelder ausfüllen'}
            </span>
            <button
              type="button"
              onClick={handleApply}
              disabled={submitting || !couchValid}
              className="rounded-lg bg-emerald-500 px-5 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Übernehmen
            </button>
          </div>
        </div>
        {result && (
          <div className="mt-4 rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-xs text-slate-300">
            CouchDB: {result.couchOk ? 'OK' : 'Fehler'}
          </div>
        )}
      </div>
    </div>
  )
}
