import { useEffect, useState } from 'react'
import type { BrokerConfig, MqttSettings } from '../lib/types'

type Props = {
  isOpen: boolean
  brokers: BrokerConfig[]
  activeBrokerId: string | null
  onClose: () => void
  onSelect: (id: string) => void
  onSave: (broker: BrokerConfig) => Promise<void>
  onDelete?: (brokerId: string) => Promise<void>
}

const blankMqtt: MqttSettings = {
  host: '',
  port: 1883,
  useTls: false,
  username: '',
  password: '',
  clientId: '',
}

const toNumber = (value: string) => (value ? Number(value) : 0)

export default function BrokerModal({
  isOpen,
  brokers,
  activeBrokerId,
  onClose,
  onSelect,
  onSave,
  onDelete,
}: Props) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [mqtt, setMqtt] = useState<MqttSettings>(blankMqtt)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    if (!isOpen) {
      return
    }
    if (!editingId) {
      setName('')
      setMqtt(blankMqtt)
      return
    }
    const selected = brokers.find((broker) => broker.id === editingId)
    if (selected) {
      setName(selected.name)
      const raw = selected.mqtt
      setMqtt({
        ...blankMqtt,
        ...raw,
        host: typeof raw.host === 'string' ? raw.host : '',
        port: typeof raw.port === 'number' && Number.isFinite(raw.port) ? raw.port : Number(raw.port) || 1883,
      })
    }
  }, [brokers, editingId, isOpen])

  if (!isOpen) {
    return null
  }

  const portNum = Number(mqtt.port)
  const mqttValid =
    Boolean(typeof mqtt.host === 'string' && mqtt.host.trim()) &&
    !Number.isNaN(portNum) &&
    portNum > 0
  const nameValid = Boolean(typeof name === 'string' && name.trim())

  const startNew = () => {
    setEditingId(null)
    setName('')
    setMqtt(blankMqtt)
  }

  const handleSave = async () => {
    if (!nameValid || !mqttValid) {
      return
    }
    setSaving(true)
    const id = editingId ?? crypto.randomUUID()
    const portNum = Number(mqtt.port)
    await onSave({
      id,
      name: name.trim(),
      mqtt: {
        ...mqtt,
        host: typeof mqtt.host === 'string' ? mqtt.host.trim() : '',
        port: !Number.isNaN(portNum) && portNum > 0 ? portNum : 1883,
      },
    })
    setEditingId(id)
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4 py-8">
      <div className="w-full max-w-4xl rounded-2xl bg-slate-900 p-6 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-white">MQTT-Broker verwalten</h2>
            <p className="mt-1 text-sm text-slate-300">
              Broker speichern und schnell zwischen verschiedenen Umgebungen wechseln.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-700 px-3 py-1 text-sm text-slate-200 hover:bg-slate-800"
          >
            Schließen
          </button>
        </div>

        <div className="mt-6 grid gap-6 md:grid-cols-[1fr_2fr]">
          <section className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-100">Broker</h3>
              <button
                type="button"
                onClick={startNew}
                className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-200 hover:bg-slate-800"
              >
                Neu
              </button>
            </div>
            <div className="mt-3 space-y-2 text-sm">
              {brokers.length === 0 && (
                <p className="text-xs text-slate-400">Noch keine Broker gespeichert.</p>
              )}
              {brokers.map((broker) => (
                <button
                  key={broker.id}
                  type="button"
                  onClick={() => {
                    setEditingId(broker.id)
                    setName(broker.name)
                    setMqtt(broker.mqtt)
                    onSelect(broker.id)
                  }}
                  className={`w-full rounded-lg border px-3 py-2 text-left ${
                    broker.id === activeBrokerId
                      ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-100'
                      : 'border-slate-800 text-slate-200 hover:bg-slate-800'
                  }`}
                >
                  <div className="text-sm font-semibold">{broker.name}</div>
                  <div className="text-xs text-slate-400">
                    {broker.mqtt.host}:{broker.mqtt.port}
                  </div>
                </button>
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
            <h3 className="text-sm font-semibold text-slate-100">Broker-Details</h3>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <label className="block text-xs text-slate-300 md:col-span-2">
                Name
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
                  placeholder="Mein Broker"
                />
              </label>
              <label className="block text-xs text-slate-300">
                Host
                <input
                  value={mqtt.host}
                  onChange={(event) => setMqtt((prev) => ({ ...prev, host: event.target.value }))}
                  className="mt-1 w-full rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
                  placeholder="broker.local"
                />
              </label>
              <label className="block text-xs text-slate-300">
                Port (TCP, Backend)
                <input
                  value={mqtt.port}
                  onChange={(event) =>
                    setMqtt((prev) => ({ ...prev, port: toNumber(event.target.value) }))
                  }
                  type="number"
                  className="mt-1 w-full rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
                  placeholder="1883"
                />
              </label>
              <label className="flex items-center gap-2 text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={mqtt.useTls}
                  onChange={(event) =>
                    setMqtt((prev) => ({ ...prev, useTls: event.target.checked }))
                  }
                  className="h-4 w-4 rounded border-slate-700 bg-slate-900"
                />
                TLS (WSS)
              </label>
              <label className="block text-xs text-slate-300">
                Benutzer
                <input
                  value={mqtt.username}
                  onChange={(event) => setMqtt((prev) => ({ ...prev, username: event.target.value }))}
                  className="mt-1 w-full rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
                />
              </label>
              <label className="block text-xs text-slate-300">
                Passwort
                <input
                  value={mqtt.password}
                  onChange={(event) => setMqtt((prev) => ({ ...prev, password: event.target.value }))}
                  type="password"
                  className="mt-1 w-full rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
                />
              </label>
              <label className="block text-xs text-slate-300">
                Client-ID (optional)
                <input
                  value={mqtt.clientId}
                  onChange={(event) => setMqtt((prev) => ({ ...prev, clientId: event.target.value }))}
                  className="mt-1 w-full rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
                />
              </label>
            </div>

            <div className="mt-6 flex items-center justify-between gap-3">
              <div>
                {editingId && onDelete && (
                  <button
                    type="button"
                    onClick={async () => {
                      if (!confirm(`Broker „${name || editingId}“ und alle zugehörigen Geräte in CouchDB löschen?`)) return
                      setDeleting(true)
                      try {
                        await onDelete(editingId)
                        setEditingId(null)
                        setName('')
                        setMqtt(blankMqtt)
                      } finally {
                        setDeleting(false)
                      }
                    }}
                    disabled={deleting}
                    className="rounded-lg border border-rose-700 bg-rose-500/20 p-2 text-rose-200 hover:bg-rose-500/30 disabled:opacity-50"
                    title="Broker löschen (inkl. Geräte in CouchDB)"
                    aria-label="Broker löschen"
                  >
                    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={handleSave}
                disabled={!mqttValid || !nameValid || saving}
                className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Speichern
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
