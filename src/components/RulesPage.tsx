import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { DeviceInfo } from '../lib/types'
import RuleEditor from './RuleEditor'
import { DeviceState } from '../DeviceState'
import { removeComments } from '../lib/removeComments'
import TemplateSaveModal from './TemplateSaveModal'
import TemplateLoadModal from './TemplateLoadModal'

type Props = {
  device: DeviceInfo | null
  consoleLines: string[]
  rules: Record<number, { text: string; enabled: boolean; once: boolean; stopOnError: boolean }>
  properties: Record<string, Record<string, unknown>>
  onRuleUpdate: (ruleId: number, patch: Partial<{ text: string; enabled: boolean; once: boolean; stopOnError: boolean }>) => void
  onRuleChange?: (deviceId: string) => void
  onSendCommand: (deviceId: string, command: string, payload: string) => void
  onBack: () => void
}

const TelemetryConsole = ({ lines }: { lines: string[] }) => {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [autoScroll, setAutoScroll] = useState(true)

  useEffect(() => {
    if (!autoScroll) {
      return
    }
    const el = containerRef.current
    if (!el) {
      return
    }
    el.scrollTop = el.scrollHeight
  }, [lines, autoScroll])

  const handleScroll = () => {
    const el = containerRef.current
    if (!el) {
      return
    }
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

export default function RulesPage({
  device,
  consoleLines,
  rules,
  properties,
  onRuleUpdate,
  onRuleChange,
  onSendCommand,
  onBack,
}: Props) {
  const leftRuleRefs = useRef<(HTMLDivElement | null)[]>([])
  const onSendCommandRef = useRef(onSendCommand)
  const [ruleHeights, setRuleHeights] = useState<Record<number, number>>({})
  const [editingEntry, setEditingEntry] = useState<{
    group: 'VAR' | 'MEM'
    index: number
    value: string
  } | null>(null)
  const [showSaveModal, setShowSaveModal] = useState(false)
  const [showLoadModal, setShowLoadModal] = useState(false)
  const [templateRuleId, setTemplateRuleId] = useState<number | null>(null)
  const ruleEditorRefs = useRef<Record<number, { textarea: HTMLTextAreaElement | null; insertTemplate?: (text: string) => void }>>({})
  const [ruleTimerEditor, setRuleTimerEditor] = useState<{
    index: number
    value: string
  } | null>(null)
  const [autoPollingVar, setAutoPollingVar] = useState(false)
  const [autoPollingMem, setAutoPollingMem] = useState(false)
  const [autoPollingRuleTimer, setAutoPollingRuleTimer] = useState(false)
  const [editingRules, setEditingRules] = useState<Record<number, boolean>>({}) // Track which rules are being edited
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false)

  useLayoutEffect(() => {
    if (!('ResizeObserver' in window)) {
      return
    }
    const observers: ResizeObserver[] = []
    leftRuleRefs.current.forEach((left, index) => {
      if (!left) {
        return
      }
      const ruleId = index + 1
      const observer = new ResizeObserver(() => {
        const nextHeight = Math.max(250, Math.round(left.scrollHeight))
        setRuleHeights((prev) => {
          if (prev[ruleId] === nextHeight) {
            return prev
          }
          return { ...prev, [ruleId]: nextHeight }
        })
      })
      observer.observe(left)
      const initialHeight = Math.max(250, Math.round(left.scrollHeight))
      setRuleHeights((prev) => ({ ...prev, [ruleId]: initialHeight }))
      observers.push(observer)
    })
    return () => {
      observers.forEach((observer) => observer.disconnect())
    }
  }, [device?.id])

  useEffect(() => {
    onSendCommandRef.current = onSendCommand
  }, [onSendCommand])

  useEffect(() => {
    if (!autoPollingVar || !device) {
      return
    }
    onSendCommandRef.current(device.id, 'VAR', '')
    const interval = setInterval(() => {
      onSendCommandRef.current(device.id, 'VAR', '')
    }, 5000)
    return () => clearInterval(interval)
  }, [autoPollingVar, device?.id])

  useEffect(() => {
    if (!autoPollingMem || !device) {
      return
    }
    onSendCommandRef.current(device.id, 'MEM', '')
    const interval = setInterval(() => {
      onSendCommandRef.current(device.id, 'MEM', '')
    }, 5000)
    return () => clearInterval(interval)
  }, [autoPollingMem, device?.id])

  useEffect(() => {
    if (!autoPollingRuleTimer || !device) {
      return
    }
    onSendCommandRef.current(device.id, 'RULETIMER', '')
    const interval = setInterval(() => {
      onSendCommandRef.current(device.id, 'RULETIMER', '')
    }, 5000)
    return () => clearInterval(interval)
  }, [autoPollingRuleTimer, device?.id])

  const getRule = (ruleId: number) => {
    return (
      rules[ruleId] ?? {
        text: '',
        enabled: false,
        once: false,
        stopOnError: false,
      }
    )
  }

  const hasUnsavedChanges = () => {
    return Object.keys(editingRules).length > 0
  }

  const handleBackClick = () => {
    if (hasUnsavedChanges()) {
      setShowUnsavedDialog(true)
    } else {
      onBack()
    }
  }

  const handleDiscardChanges = () => {
    // Reset all editing flags
    if (device) {
      Object.keys(editingRules).forEach((ruleIdStr) => {
        const ruleId = parseInt(ruleIdStr, 10)
        DeviceState.setRuleEditing(device.id, ruleId, false)
      })
    }
    setEditingRules({})
    setShowUnsavedDialog(false)
    onBack()
  }

  useEffect(() => {
    setRuleHeights({})
  }, [device?.id])


  return (
    <div className="space-y-4">
      {/* Unsaved Changes Dialog */}
      {showUnsavedDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4">
          <div className="w-full max-w-md rounded-xl border border-slate-800 bg-slate-900 p-6 shadow-xl">
            <h3 className="mb-4 text-lg font-semibold text-white">
              Ungespeicherte Änderungen
            </h3>
            <p className="mb-6 text-sm text-slate-300">
              Es sind ungespeicherte Änderungen an den Rules vorhanden. Möchten Sie diese verwerfen und zur Geräteliste zurückkehren?
            </p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowUnsavedDialog(false)}
                className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800"
              >
                Zurück
              </button>
              <button
                type="button"
                onClick={handleDiscardChanges}
                className="rounded-lg bg-rose-500 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-600"
              >
                Daten verwerfen
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-white">
          Rules - {device?.name ?? 'Unbekannt'}
        </h2>
        <button
          type="button"
          onClick={handleBackClick}
          className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800"
        >
          Zurück
        </button>
      </div>
      {device ? (
        <div className="space-y-4">
          <div className="hidden grid-cols-2 gap-2 rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-sm text-slate-200 sm:grid md:grid-cols-3">
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
                {device.online === true
                  ? 'Online'
                  : device.online === false
                    ? 'Offline'
                    : 'Unbekannt'}
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
          <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
            <div className="-mx-4 -mt-4 mb-3 flex min-h-[2.5rem] items-center rounded-t-xl border-b border-slate-800 bg-slate-900/60 px-4 py-2 text-sm font-semibold text-slate-200">
              Konsole
            </div>
            <TelemetryConsole lines={consoleLines} />
          </div>
          <div className="space-y-4">
            {[1, 2, 3].map((rule, index) => {
              const vars = properties.VAR as Record<string, unknown> | undefined
              const mems = properties.MEM as Record<string, unknown> | undefined
              const timers = properties.RuleTimer as Record<string, unknown> | undefined
              const getValue = (
                source: Record<string, unknown> | undefined,
                key: string,
                prefixedKey: string,
              ) => {
                if (!source) {
                  return undefined
                }
                return source[key] ?? source[prefixedKey]
              }
              const formatEntry = (label: string, value: unknown) => {
                if (value === undefined || value === null) {
                  return `${label}:`
                }
                return `${label}: ${String(value)}`
              }
              const sideGroups = [
                {
                  title: "VAR's",
                  items: Array.from({ length: 16 }, (_, i) => {
                    const key = String(i + 1)
                    const value = getValue(vars, key, `VAR${key}`)
                    return { label: `VAR${key}`, value: value ?? '' }
                  }),
                },
                {
                  title: "MEM's",
                  items: Array.from({ length: 16 }, (_, i) => {
                    const key = String(i + 1)
                    const value = getValue(mems, key, `MEM${key}`)
                    return { label: `MEM${key}`, value: value ?? '' }
                  }),
                },
                {
                  title: "RuleTimer's",
                  items: Array.from({ length: 8 }, (_, i) => {
                    const key = String(i + 1)
                    const value = getValue(timers, key, `RuleTimer${key}`)
                    return { label: `RuleTimer${key}`, value: value ?? '' }
                  }),
                },
              ]
              const group = sideGroups[index]
              return (
                <div key={rule} className="grid gap-4 lg:grid-cols-[3fr_1fr]">
                  <div
                    ref={(node) => {
                      leftRuleRefs.current[index] = node
                    }}
                    className="flex min-h-[250px] flex-col rounded-xl border border-slate-800 bg-slate-950/40 p-4"
                  >
                    <div className="-mx-4 -mt-4 mb-3 flex min-h-[2.5rem] items-center justify-between gap-3 rounded-t-xl border-b border-slate-800 bg-slate-900/60 px-4 py-2 text-sm text-slate-200">
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => {
                            if (device) {
                              // Request rule from device
                              onSendCommand(device.id, `RULE${rule}`, '')
                              // Reset editing flag after refresh
                              DeviceState.setRuleEditing(device.id, rule, false)
                              setEditingRules((prev) => {
                                const next = { ...prev }
                                delete next[rule]
                                return next
                              })
                            }
                          }}
                          className="rounded-md border border-slate-700 p-1 text-slate-300 hover:bg-slate-800 hover:text-slate-100"
                          aria-label="Refresh Rule"
                          title="Rule vom Gerät aktualisieren"
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
                            <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
                            <path d="M21 3v5h-5" />
                            <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
                            <path d="M3 21v-5h5" />
                          </svg>
                        </button>
                        <span className="font-semibold text-white">Rule {rule}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        {(() => {
                          const { enabled, once, stopOnError } = getRule(rule)
                          return (
                            <>
                              <button
                                type="button"
                                onClick={() => {
                                  const newEnabled = !enabled
                                  // Update local state
                                  onRuleUpdate(rule, {
                                    enabled: newEnabled,
                                  })
                                  // Send MQTT command: Rule<x> 1 for enabled, 0 for disabled
                                  // Only send the enabled/disabled status, not the full rule
                                  if (device) {
                                    onSendCommand(device.id, `Rule${rule}`, newEnabled ? '1' : '0')
                                  }
                                }}
                                className={`rounded-md border px-2 py-1 text-xs hover:bg-slate-800 ${
                                  enabled
                                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20'
                                    : 'border-slate-700 text-slate-300'
                                }`}
                              >
                                {enabled ? 'Enabled' : 'Disabled'}
                              </button>
                              <label
                                className={`flex items-center gap-2 text-xs ${
                                  once ? 'text-amber-300' : 'text-slate-300'
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  className="h-3 w-3"
                                  checked={once}
                                  onChange={(event) => {
                                    const newOnce = event.target.checked
                                    // Update local state
                                    onRuleUpdate(rule, {
                                      once: newOnce,
                                    })
                                    // Send MQTT command: RULE<x> 5 for once enabled, 4 for disabled
                                    if (device) {
                                      onSendCommand(device.id, `RULE${rule}`, newOnce ? '5' : '4')
                                    }
                                  }}
                                />
                                Once (Einmalig)
                              </label>
                              <label
                                className={`flex items-center gap-2 text-xs ${
                                  stopOnError ? 'text-rose-300' : 'text-slate-300'
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  className="h-3 w-3"
                                  checked={stopOnError}
                                  onChange={(event) => {
                                    const newStopOnError = event.target.checked
                                    // Update local state
                                    onRuleUpdate(rule, {
                                      stopOnError: newStopOnError,
                                    })
                                    // Send MQTT command: RULE<x> 9 for stopOnError enabled, 10 for disabled
                                    if (device) {
                                      onSendCommand(device.id, `RULE${rule}`, newStopOnError ? '9' : '10')
                                    }
                                  }}
                                />
                                Stop bei Fehler
                              </label>
                            </>
                          )
                        })()}
                      </div>
                    </div>
                    <RuleEditor
                      value={getRule(rule).text}
                      enabled={getRule(rule).enabled}
                      deviceId={device?.id}
                      brokerId={device?.brokerId}
                      onChange={(text) => {
                        onRuleUpdate(rule, { text })
                      }}
                      onUserChange={(text) => {
                        if (device) {
                          DeviceState.setRuleEditing(device.id, rule, true)
                        }
                        setEditingRules((prev) => ({ ...prev, [rule]: true }))
                        onRuleUpdate(rule, { text })
                      }}
                      ref={(editor) => {
                        // Store reference to textarea and insertTemplate method for template insertion
                        if (editor) {
                          ruleEditorRefs.current[rule] = { 
                            textarea: editor.textarea,
                            insertTemplate: editor.insertTemplate
                          }
                        } else {
                          delete ruleEditorRefs.current[rule]
                        }
                      }}
                      onHeightChange={() => {
                        // Update height synchronization
                        const left = leftRuleRefs.current[index]
                        if (left) {
                          const nextHeight = Math.max(250, Math.round(left.scrollHeight))
                          setRuleHeights((prev) => ({
                            ...prev,
                            [rule]: nextHeight,
                          }))
                        }
                      }}
                      placeholder={`Rule ${rule}...`}
                    />
                    <div className="mt-2 flex items-center justify-between">
                      {/* Template buttons */}
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            const ruleData = getRule(rule)
                            const ruleText = ruleData.text
                            if (!ruleText.trim()) {
                              alert('Bitte wählen Sie Text aus oder geben Sie Text ein, um ein Template zu speichern.')
                              return
                            }
                            setTemplateRuleId(rule)
                            setShowSaveModal(true)
                          }}
                          className="flex items-center justify-center rounded-md border border-slate-700 p-1.5 text-slate-300 hover:bg-slate-800"
                          title="Template speichern"
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
                            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                            <polyline points="17 21 17 13 7 13 7 21" />
                            <polyline points="7 3 7 8 15 8" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setTemplateRuleId(rule)
                            setShowLoadModal(true)
                          }}
                          className="flex items-center justify-center rounded-md border border-slate-700 p-1.5 text-slate-300 hover:bg-slate-800"
                          title="Template laden"
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
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                            <polyline points="7 10 12 15 17 10" />
                            <line x1="12" y1="15" x2="12" y2="3" />
                          </svg>
                        </button>
                      </div>
                      {/* Upload button */}
                      <div className="flex items-center">
                      <button
                        type="button"
                        onClick={() => {
                          const ruleData = getRule(rule)
                          const ruleText = ruleData.text
                          if (device) {
                            // Remove comments before sending
                            const textWithoutComments = removeComments(ruleText)
                            
                            // Save original text (with comments) and sent text (without comments) in DeviceState
                            DeviceState.updateRuleWithComments(device.id, rule, ruleText, textWithoutComments)
                            onRuleChange?.(device.id)
                            if (textWithoutComments.trim()) {
                              // Send rule text without comments (Once and StopOnError are sent immediately when checkboxes change)
                              onSendCommand(device.id, `RULE${rule}`, textWithoutComments)
                            } else {
                              // If rule is empty, send empty text as "" and then disable the rule
                              onSendCommand(device.id, `RULE${rule}`, '""')
                              onSendCommand(device.id, `RULE${rule}`, '0')
                            }
                            // Reset editing flag after upload
                            DeviceState.setRuleEditing(device.id, rule, false)
                            setEditingRules((prev) => {
                              const next = { ...prev }
                              delete next[rule]
                              return next
                            })
                            // Trigger re-render with structured view after upload
                            // The value will be updated when the device responds
                          }
                        }}
                        className="inline-flex items-center gap-2 rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800"
                        aria-label="Upload"
                        title="Upload"
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
                          <path d="M12 16V4" />
                          <polyline points="7 9 12 4 17 9" />
                          <path d="M21 20H3" />
                        </svg>
                        Upload
                      </button>
                      </div>
                    </div>
                  </div>
                  <div
                    className="flex flex-col overflow-hidden rounded-xl border border-slate-800 bg-slate-950/40 p-4"
                    style={{
                      height: ruleHeights[rule] ? `${ruleHeights[rule]}px` : '250px',
                    }}
                  >
                    <div className="-mx-4 -mt-4 mb-3 flex min-h-[2.5rem] items-center justify-between rounded-t-xl border-b border-slate-800 bg-slate-900/60 px-4 py-2 text-xs text-slate-300">
                      <span className="font-semibold text-white">{group.title}</span>
                      <label className="flex items-center gap-2">
                        <span>Automatisches Polling</span>
                        <input
                          type="checkbox"
                          className="h-3 w-3"
                          checked={
                            index === 0
                              ? autoPollingVar
                              : index === 1
                                ? autoPollingMem
                                : autoPollingRuleTimer
                          }
                          onChange={(event) => {
                            if (index === 0) {
                              setAutoPollingVar(event.target.checked)
                            } else if (index === 1) {
                              setAutoPollingMem(event.target.checked)
                            } else {
                              setAutoPollingRuleTimer(event.target.checked)
                            }
                          }}
                        />
                      </label>
                    </div>
                    <div className="telemetry-scroll relative min-h-0 flex-1 overflow-auto rounded-md border border-slate-700 bg-slate-800/60 p-1 text-xs text-slate-300">
                      {group.items.map((item, idx) => {
                        const isRuleTimer = index === 2
                        const groupKey = index === 0 ? 'VAR' : 'MEM'
                        const isEditing =
                          !isRuleTimer &&
                          editingEntry?.group === groupKey &&
                          editingEntry?.index === idx
                        const handleDoubleClick = (event: React.MouseEvent) => {
                          event.preventDefault()
                          event.stopPropagation()
                          if (!device) {
                            return
                          }
                          if (isRuleTimer) {
                            setRuleTimerEditor({
                              index: idx,
                              value: String(item.value ?? ''),
                            })
                            return
                          }
                          setEditingEntry({
                            group: groupKey,
                            index: idx,
                            value: String(item.value ?? ''),
                          })
                        }
                        return (
                          <div
                            key={item.label}
                            className={
                              idx % 2 === 0
                                ? 'rounded px-1 py-0.5 cursor-pointer'
                                : 'rounded bg-slate-700/50 px-1 py-0.5 cursor-pointer'
                            }
                            onDoubleClick={handleDoubleClick}
                            onClick={(event) => {
                              if (isRuleTimer && event.detail === 2) {
                                event.preventDefault()
                                event.stopPropagation()
                                handleDoubleClick(event as any)
                              }
                            }}
                          >
                            {isEditing ? (
                              <input
                                autoFocus
                                value={editingEntry?.value ?? ''}
                                onChange={(event) =>
                                  setEditingEntry((prev) =>
                                    prev ? { ...prev, value: event.target.value } : prev,
                                  )
                                }
                                onKeyDown={(event) => {
                                  if (event.key !== 'Enter' || !device || !editingEntry) {
                                    return
                                  }
                                  const command = `${editingEntry.group}${editingEntry.index + 1}`
                                  onSendCommand(device.id, command, editingEntry.value)
                                  setEditingEntry(null)
                                }}
                                onBlur={() => setEditingEntry(null)}
                                className="w-full rounded border border-slate-600 bg-slate-900 px-2 py-1 text-xs text-slate-100"
                              />
                            ) : (
                              formatEntry(item.label, item.value)
                            )}
                          </div>
                        )
                      })}
                      {ruleTimerEditor && index === 2 ? (
                        <div
                          className="absolute inset-0 z-10 flex items-start justify-center rounded-lg bg-slate-950/80 p-2"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <div className="w-full max-w-[12rem] rounded-lg border border-slate-700 bg-slate-900 p-2 shadow-lg">
                            <div className="mb-2 text-xs text-slate-300">
                              RuleTimer{ruleTimerEditor.index + 1}
                            </div>
                            <input
                              autoFocus
                              value={ruleTimerEditor.value}
                              onChange={(event) =>
                                setRuleTimerEditor((prev) =>
                                  prev ? { ...prev, value: event.target.value } : prev,
                                )
                              }
                              onKeyDown={(event) => {
                                if (event.key !== 'Enter' || !device || !ruleTimerEditor) {
                                  return
                                }
                                const command = `RuleTimer${ruleTimerEditor.index + 1}`
                                onSendCommand(device.id, command, ruleTimerEditor.value)
                                setRuleTimerEditor(null)
                              }}
                              onBlur={() => setRuleTimerEditor(null)}
                              className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100"
                            />
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        <p className="text-sm text-slate-400">Gerät nicht gefunden.</p>
      )}
      
      {/* Template Modals */}
      {templateRuleId !== null && (
        <>
          <TemplateSaveModal
            isOpen={showSaveModal}
            text={getRule(templateRuleId).text}
            onClose={() => {
              setShowSaveModal(false)
              setTemplateRuleId(null)
            }}
            onSave={() => {
              setShowSaveModal(false)
              setTemplateRuleId(null)
            }}
          />
          <TemplateLoadModal
            isOpen={showLoadModal}
            enabled={templateRuleId !== null ? getRule(templateRuleId).enabled : true}
            onClose={() => {
              setShowLoadModal(false)
              setTemplateRuleId(null)
            }}
            onInsert={(templateText) => {
              if (templateRuleId !== null) {
                // Use the insertTemplate method from RuleEditor if available
                const editor = ruleEditorRefs.current[templateRuleId]
                if (editor?.insertTemplate) {
                  editor.insertTemplate(templateText)
                } else {
                  // Fallback: Get current text and update state
                  const textarea = editor?.textarea
                  const ruleData = getRule(templateRuleId)
                  const currentText = textarea?.value || ruleData.text || ''
                  const trimmedCurrent = currentText.trimEnd()
                  const newText = trimmedCurrent
                    ? `${trimmedCurrent}\n${templateText}`
                    : templateText
                  onRuleUpdate(templateRuleId, { text: newText })
                }
              }
              setShowLoadModal(false)
              setTemplateRuleId(null)
            }}
          />
        </>
      )}
    </div>
  )
}
