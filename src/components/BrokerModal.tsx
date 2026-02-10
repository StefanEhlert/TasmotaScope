import { useEffect, useMemo, useState } from 'react'
import type { BrokerConfig, MqttSettings } from '../lib/types'

type Props = {
  isOpen: boolean
  brokers: BrokerConfig[]
  activeBrokerId: string | null
  onClose: () => void
  onSelect: (id: string) => void
  onSave: (broker: BrokerConfig) => Promise<void>
}

const blankMqtt: MqttSettings = {
  host: '',
  port: 9001,
  useTls: false,
  username: '',
  password: '',
  clientId: '',
  path: '/',
}

const toNumber = (value: string) => (value ? Number(value) : 0)

export default function BrokerModal({
  isOpen,
  brokers,
  activeBrokerId,
  onClose,
  onSelect,
  onSave,
}: Props) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [mqtt, setMqtt] = useState<MqttSettings>(blankMqtt)
  const [saving, setSaving] = useState(false)

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
      setMqtt(selected.mqtt)
    }
  }, [brokers, editingId, isOpen])

  if (!isOpen) {
    return null
  }

  const mqttValid = Boolean(mqtt.host.trim()) && Number.isFinite(mqtt.port) && mqtt.port > 0
  const nameValid = Boolean(name.trim())

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
    await onSave({
      id,
      name: name.trim(),
      mqtt: {
        ...mqtt,
        host: mqtt.host.trim(),
        path: mqtt.path?.trim() ? mqtt.path.trim() : '/',
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
                Port
                <input
                  value={mqtt.port}
                  onChange={(event) =>
                    setMqtt((prev) => ({ ...prev, port: toNumber(event.target.value) }))
                  }
                  type="number"
                  className="mt-1 w-full rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
                  placeholder="9001"
                />
              </label>
              <label className="block text-xs text-slate-300">
                WebSocket-Pfad
                <input
                  value={mqtt.path}
                  onChange={(event) => setMqtt((prev) => ({ ...prev, path: event.target.value }))}
                  className="mt-1 w-full rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
                  placeholder="/"
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

            <div className="mt-6 flex items-center justify-end gap-3">
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
