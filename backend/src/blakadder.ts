/**
 * Crawler für templates.blakadder.com: Liste laden, normalisieren, in CouchDB speichern.
 *
 * Ablauf:
 * 1. HTTP GET auf https://templates.blakadder.com/templates.json (eine große JSON-Datei, ~1,4 MB).
 * 2. Rohtext-Bereinigung (fixTemplateJson): Die Quelle ist Jekyll/Ruby und liefert oft ungültiges JSON
 *    (z. B. "key"=>"value" statt "key": "value", leere "template": , unquotierte template9/template32,
 *    fehlende Kommas zwischen }} und dem nächsten Key, Trailing Commas). Mehrere Regex-Ersetzungen
 *    machen daraus gültiges JSON.
 * 3. JSON.parse und Durchlauf über das Array "templates".
 * 4. Jeden Eintrag normalisieren: "template" aus template/template32/…, "link" aus link/link1/linkURL/…,
 *    "image" als vollständige URL (bei Pfaden wie /assets/… wird die Basis-URL ergänzt). Alle
 *    Varianten-Keys (link1, link2, …) werden entfernt, nur die einheitlichen Felder bleiben.
 * 5. Gesamtes normalisiertes Array plus updatedAt in CouchDB schreiben (Dokument config:blakadder_templates).
 *
 * Die UI liest über GET /api/blakadder/list die daraus erzeugte Liste (id + label) für die Gerätetyp-Auswahl.
 */

import type { CouchDbSettings } from './couchDb.js'
import { getConfigDoc, putConfigDoc } from './couchDb.js'

const BLAKADDER_BASE = 'https://templates.blakadder.com'
const TEMPLATES_JSON_URL = `${BLAKADDER_BASE}/templates.json`
const CONFIG_DOC_ID = 'config:blakadder_templates'

/**
 * Soll-Format eines Eintrags (templates.json); manche Objekte weichen durch Jekyll/Ruby ab.
 * Beispiel gültiges Objekt:
 *   { "name": "EFUN SH330W", "model": "FCC S7JSH330", "link": "/efun_SH330W.html",
 *     "type": "Plug", "category": "plug", "standard": ["US"],
 *     "template": {"NAME":"EFUNPlug","GPIO":[...],"FLAG":15,"BASE":18},
 *     "image": "/assets/device_images/efun_SH330W.webp",
 *     "product": "https://..." }
 * Abweichungen, die fixTemplateJson repariert: "key"=>value, "template": , template9, "template": Module 18 (unquotiert), "BASE":n}}, }} ohne Komma, Trailing Commas.
 */
/** Roher Eintrag aus templates.json (Feldnamen können template32, templateSonoff etc. sein). */
type RawTemplateEntry = Record<string, unknown> & {
  name?: string
  model?: string
  link?: string
  type?: string
  category?: string
  standard?: string[]
  image?: string
  product?: string
}

/** Normalisierter Eintrag: "template" als JSON-String, "image"/"link" vollständige URLs, ohne "global"/"standard". */
export type BlakadderTemplateEntry = Omit<RawTemplateEntry, 'template' | 'global' | 'standard'> & {
  template?: string
  image: string
  link?: string
}

function normalizeUrl(value: string | undefined, baseUrl: string): string {
  if (!value || typeof value !== 'string') return ''
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed
  if (trimmed.startsWith('/')) return baseUrl + trimmed
  return baseUrl + '/' + trimmed.replace(/^\//, '')
}

function normalizeImage(img: string | undefined): string {
  return normalizeUrl(img, BLAKADDER_BASE)
}

/** Findet ein Feld mit Basisnamen (z. B. template/template32 oder link/link1/linkURL) und gibt den bevorzugten Wert zurück. */
function pickField(obj: Record<string, unknown>, baseName: string): unknown {
  const lower = baseName.toLowerCase()
  // Bevorzugt exakten Key (z. B. "link"), sonst ersten passenden (link1, link2, linkURL)
  const exact = obj[baseName]
  if (exact !== undefined) return exact
  for (const key of Object.keys(obj)) {
    if (typeof key === 'string' && key.toLowerCase().startsWith(lower)) return obj[key]
  }
  return undefined
}

function normalizeEntry(raw: RawTemplateEntry): BlakadderTemplateEntry {
  const obj = raw as Record<string, unknown>
  const templateRaw = pickField(obj, 'template')
  const linkRaw = pickField(obj, 'link')
  const image = normalizeImage(raw.image as string | undefined)
  const link = normalizeUrl(
    typeof linkRaw === 'string' ? linkRaw : (linkRaw !== undefined && linkRaw !== null ? String(linkRaw) : undefined),
    BLAKADDER_BASE
  )
  const template =
    templateRaw === null || templateRaw === undefined
      ? undefined
      : typeof templateRaw === 'object'
        ? JSON.stringify(templateRaw)
        : String(templateRaw)
  const { image: _img, ...rest } = raw
  const out = { ...rest, template, link, image } as BlakadderTemplateEntry & Record<string, unknown>
  for (const key of Object.keys(out)) {
    if (key === 'global' || key === 'standard') delete out[key]
    else if (key !== 'template' && key.toLowerCase().startsWith('template')) delete out[key]
    else if (key !== 'link' && key.toLowerCase().startsWith('link')) delete out[key]
  }
  out.template = template
  out.link = link || undefined
  out.image = image
  return out as BlakadderTemplateEntry
}

/** templates.json enthält teils ungültiges JSON (Jekyll/Ruby-Output). Text vor dem Parsen bereinigen. */
function fixTemplateJson(text: string): string {
  let out = text
  // Ruby-Hash-Syntax: "key"=>"value" statt "key": "value"
  out = out.replace(/"\s*=>\s*/g, '": ')
  // "template": ,  (leerer Wert)
  out = out.replace(/"template"\s*:\s*,/g, '"template": null,')
  // "template": template9 / template32 / templateSonoff etc. (unquotierter Bezeichner)
  out = out.replace(/"template"\s*:\s*template[A-Za-z0-9]*/g, '"template": null')
  // "template": Module 18, oder anderes unquotiertes Wort/Wort+Zahl vor Komma
  out = out.replace(/"template"\s*:\s*([A-Za-z][A-Za-z0-9\s]*)\s*,/g, '"template": null,')
  // Doppeltes }} am Ende eines template-Objekts: "BASE":1}} -> "BASE":1} (ein } zu viel)
  out = out.replace(/"BASE":\s*(\d+)\}\}/g, '"BASE":$1}')
  // Fehlendes Komma zwischen }} und nächstem Key (z. B. "image"); Lookahead, damit das " nicht doppelt wird
  out = out.replace(/\}\}\s*(?=")/g, '}}, ')
  // Trailing comma in Arrays: ,] -> ]
  out = out.replace(/,\s*\]/g, ']')
  // Trailing comma in Objekten: ,} -> }
  out = out.replace(/,\s*\}/g, '}')
  return out
}

export type BlakadderConfigDoc = {
  templates: BlakadderTemplateEntry[]
  updatedAt: string
}

export async function fetchAndNormalizeTemplates(): Promise<BlakadderTemplateEntry[]> {
  console.log('[Blakadder] Lade templates.json von', TEMPLATES_JSON_URL)
  const res = await fetch(TEMPLATES_JSON_URL, { signal: AbortSignal.timeout(60_000) })
  if (!res.ok) {
    console.error('[Blakadder] Fetch fehlgeschlagen:', res.status, res.statusText)
    throw new Error(`Blakadder templates.json: ${res.status} ${res.statusText}`)
  }
  const text = await res.text()
  console.log('[Blakadder] Antwort erhalten:', (text.length / 1024).toFixed(1), 'KB')
  const fixed = fixTemplateJson(text)
  let data: { templates?: RawTemplateEntry[] }
  try {
    data = JSON.parse(fixed) as { templates?: RawTemplateEntry[] }
  } catch (parseErr) {
    const msg = parseErr instanceof Error ? parseErr.message : String(parseErr)
    const posMatch = msg.match(/position (\d+)/)
    const pos = posMatch ? parseInt(posMatch[1], 10) : 0
    if (pos > 0) {
      const excerpt = fixed.slice(Math.max(0, pos - 80), pos + 80)
      console.error('[Blakadder] JSON-Fehler bei Position', pos, '– Ausschnitt:', JSON.stringify(excerpt))
    }
    throw parseErr
  }
  const list = Array.isArray(data.templates) ? data.templates : []
  console.log('[Blakadder] Rohe Einträge:', list.length)
  const normalized = list.map(normalizeEntry)
  console.log('[Blakadder] Normalisiert:', normalized.length, 'Einträge')
  return normalized
}

export async function runBlakadderSync(
  settings: CouchDbSettings,
  setSync: (running: boolean) => void
): Promise<void> {
  const start = Date.now()
  console.log('[Blakadder] Sync gestartet')
  setSync(true)
  try {
    const templates = await fetchAndNormalizeTemplates()
    console.log('[Blakadder] Speichere in CouchDB:', CONFIG_DOC_ID)
    await putConfigDoc(settings, CONFIG_DOC_ID, {
      templates,
      updatedAt: new Date().toISOString(),
    })
    const duration = ((Date.now() - start) / 1000).toFixed(1)
    console.log('[Blakadder] Sync abgeschlossen:', templates.length, 'Geräte in', duration, 's')
  } catch (err) {
    console.error('[Blakadder] Sync fehlgeschlagen:', err instanceof Error ? err.message : err)
    throw err
  } finally {
    setSync(false)
  }
}

export async function getBlakadderTemplates(
  settings: CouchDbSettings
): Promise<BlakadderConfigDoc | null> {
  const doc = await getConfigDoc<BlakadderConfigDoc>(settings, CONFIG_DOC_ID)
  return doc && Array.isArray(doc.templates) ? doc : null
}

const BLAKADDER_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000 // 30 Tage

/** Prüft, ob Blakadder-Daten fehlen oder älter als 30 Tage sind; bei Bedarf Sync ausführen. */
export async function runBlakadderSyncIfStale(
  settings: CouchDbSettings,
  setSync: (running: boolean) => void
): Promise<void> {
  const doc = await getBlakadderTemplates(settings)
  const now = Date.now()
  const updatedAt = doc?.updatedAt
  const ageMs = updatedAt ? now - new Date(updatedAt).getTime() : Infinity
  if (!doc?.templates?.length || ageMs > BLAKADDER_MAX_AGE_MS) {
    console.log('[Blakadder] Daten fehlen oder älter als 30 Tage, starte Sync')
    await runBlakadderSync(settings, setSync)
  }
}

/** Liste für UI: id (Zuordnung), label (title oder title + model), optionale Bild-URL, Produkt-URL, model, type, category. */
export type BlakadderListItem = { id: string; label: string; image?: string; product?: string; model?: string; type?: string; category?: string }

export function buildBlakadderList(doc: BlakadderConfigDoc | null): BlakadderListItem[] {
  if (!doc?.templates?.length) return []
  const list: BlakadderListItem[] = []
  for (let i = 0; i < doc.templates.length; i++) {
    const t = doc.templates[i]
    const name = typeof t.name === 'string' ? t.name.trim() : ''
    const model = typeof t.model === 'string' ? t.model.trim() : ''
    const linkStr = typeof t.link === 'string' ? t.link : ''
    const pathPart = linkStr.includes('://') ? (() => { try { return new URL(linkStr).pathname } catch { return linkStr } })() : linkStr
    const id = pathPart.replace(/^\//, '').replace(/\.html$/, '') || `item-${i}`
    const label = name === model || !model ? name : `${name} (${model})`
    const image = typeof t.image === 'string' && t.image.trim() ? t.image.trim() : undefined
    const product = typeof t.product === 'string' && t.product.trim() ? t.product.trim() : undefined
    const typeVal = typeof t.type === 'string' ? t.type.trim() : undefined
    const category = typeof t.category === 'string' ? t.category.trim() : undefined
    if (label) list.push({ id, label, image, product, model: model || undefined, type: typeVal || undefined, category: category || undefined })
  }
  return list
}
