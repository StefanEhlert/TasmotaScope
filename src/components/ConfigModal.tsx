import { useEffect, useMemo, useState } from 'react'
import type { AppSettings } from '../lib/types'
import { buildCouchDbCompose } from '../lib/dockerCompose'

export type ConnectionResult = {
  mqttOk: boolean
  couchOk: boolean
  mqttError?: string
  couchError?: string
}

type Props = {
  isOpen: boolean
  initialSettings: AppSettings
  canClose: boolean
  onClose: () => void
  onApply: (settings: AppSettings) => Promise<ConnectionResult>
}

const toNumber = (value: string) => (value ? Number(value) : 0)

export default function ConfigModal({ isOpen, initialSettings, canClose, onClose, onApply }: Props) {
  const [form, setForm] = useState<AppSettings>(initialSettings)
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<ConnectionResult | null>(null)
  const [copyHint, setCopyHint] = useState<string | null>(null)

  useEffect(() => {
    if (isOpen) {
      setForm(initialSettings)
      setResult(null)
      setCopyHint(null)
    }
  }, [initialSettings, isOpen])

  const mqttValid = useMemo(() => {
    const { host, port } = form.mqtt
    return Boolean(host.trim()) && Number.isFinite(port) && port > 0
  }, [form.mqtt])

  const couchValid = useMemo(() => {
    const { host, port, username, password, database } = form.couchdb
    return (
      Boolean(host.trim()) &&
      Boolean(username.trim()) &&
      Boolean(password.trim()) &&
      Boolean(database.trim()) &&
      Number.isFinite(port) &&
      port > 0
    )
  }, [form.couchdb])

  if (!isOpen) {
    return null
  }

  const updateField = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const onCopyCompose = async () => {
    try {
      await navigator.clipboard.writeText(buildCouchDbCompose(form.couchdb))
      setCopyHint('Docker-Compose in die Zwischenablage kopiert.')
    } catch (error) {
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
      if (res.mqttOk && res.couchOk) {
        setSubmitting(false)
        return
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4 py-8">
      <div className="w-full max-w-3xl rounded-2xl bg-slate-900 p-6 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-white">Verbindung einrichten</h2>
            <p className="mt-1 text-sm text-slate-300">
              Bitte MQTT- und CouchDB-Daten eingeben. Die App startet erst, wenn beide Verbindungen
              funktionieren.
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

        <div className="mt-6 grid gap-6 md:grid-cols-2">
          <section className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
            <h3 className="text-sm font-semibold text-slate-100">MQTT (WebSocket)</h3>
            <div className="mt-3 space-y-3">
              <label className="block text-xs text-slate-300">
                Host
                <input
                  value={form.mqtt.host}
                  onChange={(event) =>
                    updateField('mqtt', { ...form.mqtt, host: event.target.value })
                  }
                  className="mt-1 w-full rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
                  placeholder="broker.local"
                />
              </label>
              <label className="block text-xs text-slate-300">
                Port
                <input
                  value={form.mqtt.port}
                  onChange={(event) =>
                    updateField('mqtt', { ...form.mqtt, port: toNumber(event.target.value) })
                  }
                  type="number"
                  className="mt-1 w-full rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
                  placeholder="9001"
                />
              </label>
              <label className="block text-xs text-slate-300">
                WebSocket-Pfad
                <input
                  value={form.mqtt.path}
                  onChange={(event) =>
                    updateField('mqtt', { ...form.mqtt, path: event.target.value })
                  }
                  className="mt-1 w-full rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
                  placeholder="/"
                />
              </label>
              <label className="flex items-center gap-2 text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={form.mqtt.useTls}
                  onChange={(event) =>
                    updateField('mqtt', { ...form.mqtt, useTls: event.target.checked })
                  }
                  className="h-4 w-4 rounded border-slate-700 bg-slate-900"
                />
                TLS (WSS)
              </label>
              <label className="block text-xs text-slate-300">
                Benutzer
                <input
                  value={form.mqtt.username}
                  onChange={(event) =>
                    updateField('mqtt', { ...form.mqtt, username: event.target.value })
                  }
                  className="mt-1 w-full rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
                />
              </label>
              <label className="block text-xs text-slate-300">
                Passwort
                <input
                  value={form.mqtt.password}
                  onChange={(event) =>
                    updateField('mqtt', { ...form.mqtt, password: event.target.value })
                  }
                  type="password"
                  className="mt-1 w-full rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
                />
              </label>
              <label className="block text-xs text-slate-300">
                Client-ID (optional)
                <input
                  value={form.mqtt.clientId}
                  onChange={(event) =>
                    updateField('mqtt', { ...form.mqtt, clientId: event.target.value })
                  }
                  className="mt-1 w-full rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
                />
              </label>
            </div>
            {result?.mqttError && (
              <p className="mt-3 text-xs text-rose-300">MQTT: {result.mqttError}</p>
            )}
          </section>

          <section className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
            <h3 className="text-sm font-semibold text-slate-100">CouchDB</h3>
            <div className="mt-3 space-y-3">
              <label className="block text-xs text-slate-300">
                Host
                <input
                  value={form.couchdb.host}
                  onChange={(event) =>
                    updateField('couchdb', { ...form.couchdb, host: event.target.value })
                  }
                  className="mt-1 w-full rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
                  placeholder="localhost"
                />
              </label>
              <label className="block text-xs text-slate-300">
                Port
                <input
                  value={form.couchdb.port}
                  onChange={(event) =>
                    updateField('couchdb', { ...form.couchdb, port: toNumber(event.target.value) })
                  }
                  type="number"
                  className="mt-1 w-full rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
                  placeholder="5984"
                />
              </label>
              <label className="flex items-center gap-2 text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={form.couchdb.useTls}
                  onChange={(event) =>
                    updateField('couchdb', { ...form.couchdb, useTls: event.target.checked })
                  }
                  className="h-4 w-4 rounded border-slate-700 bg-slate-900"
                />
                TLS (HTTPS)
              </label>
              <label className="block text-xs text-slate-300">
                Benutzer
                <input
                  value={form.couchdb.username}
                  onChange={(event) =>
                    updateField('couchdb', { ...form.couchdb, username: event.target.value })
                  }
                  className="mt-1 w-full rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
                />
              </label>
              <label className="block text-xs text-slate-300">
                Passwort
                <input
                  value={form.couchdb.password}
                  onChange={(event) =>
                    updateField('couchdb', { ...form.couchdb, password: event.target.value })
                  }
                  type="password"
                  className="mt-1 w-full rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100"
                />
              </label>
              <label className="block text-xs text-slate-300">
                Datenbank
                <input
                  value={form.couchdb.database}
                  onChange={(event) =>
                    updateField('couchdb', { ...form.couchdb, database: event.target.value })
                  }
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
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <div className="ml-auto flex items-center gap-3">
            <span className="text-xs text-slate-400">
              {mqttValid && couchValid
                ? 'Alle Felder vorhanden'
                : 'Bitte alle Pflichtfelder ausfüllen'}
            </span>
            <button
              type="button"
              onClick={handleApply}
              disabled={submitting || !mqttValid || !couchValid}
              className="rounded-lg bg-emerald-500 px-5 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Übernehmen
            </button>
          </div>
        </div>
        {result && (
          <div className="mt-4 rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-xs text-slate-300">
            MQTT: {result.mqttOk ? 'OK' : 'Fehler'} • CouchDB:{' '}
            {result.couchOk ? 'OK' : 'Fehler'}
          </div>
        )}
      </div>
    </div>
  )
}
