/**
 * Tasmota WebUI themes (name + WebColor command payload).
 * Source: https://tasmota.github.io/docs/WebUI/#themes
 */
export type TasmotaWebUiTheme = {
  name: string
  /** JSON payload to send with WebColor command, e.g. {"WebColor":["#eaeaea",...]} */
  payload: string
  /** First few hex colors for preview strip (from WebColor array), used when no image */
  colors: string[]
  /** Optional preview image path (under public), e.g. /webui-themes/dark.png */
  image?: string
}

function parseColorsFromPayload(payload: string): string[] {
  try {
    const obj = JSON.parse(payload) as { WebColor?: string[] }
    const arr = obj?.WebColor
    return Array.isArray(arr) ? arr.filter((c): c is string => typeof c === 'string').slice(0, 10) : []
  } catch {
    return []
  }
}

const THEMES_RAW: { name: string; payload: string; image?: string }[] = [
  {
    name: 'Dark (default theme)',
    image: '/webui-themes/dark.png',
    payload:
      '{"WebColor":["#eaeaea","#252525","#4f4f4f","#000000","#dddddd","#65c115","#1f1f1f","#ff5661","#008000","#faffff","#1fa3ec","#0e70a4","#d43535","#931f1f","#47c266","#5aaf6f","#faffff","#999999","#eaeaea","#08405e"]}',
  },
  {
    name: 'Light (default until 6.7.1.)',
    image: '/webui-themes/light.png',
    payload:
      '{"WebColor":["#000000","#ffffff","#f2f2f2","#000000","#ffffff","#000000","#ffffff","#ff0000","#008000","#ffffff","#1fa3ec","#0e70a4","#d43535","#931f1f","#47c266","#5aaf6f","#ffffff","#999999","#000000","#a1d9f7"]}',
  },
  {
    name: 'Halloween',
    image: '/webui-themes/halloween.png',
    payload:
      '{"WebColor":["#cccccc","#2f3133","#3d3f41","#dddddd","#293134","#ffb000","#293134","#ff5661","#008000","#ffffff","#ec7600","#bf5f00","#d43535","#931f1f","#47c266","#5aaf6f","#ffffff","#999999","#bc4d90","#663300"]}',
  },
  {
    name: 'Navy',
    image: '/webui-themes/navy.png',
    payload:
      '{"WebColor":["#e0e0c0","#000033","#4f4f4f","#000000","#dddddd","#a7f432","#1e1e1e","#ff0000","#008000","#ffffff","#1fa3ec","#0e70a4","#d43535","#931f1f","#47c266","#5aaf6f","#ffffff","#999999","#eedd77","#08405e"]}',
  },
  {
    name: 'Purple Rain',
    image: '/webui-themes/purple-rain.png',
    payload:
      '{"WebColor":["#eaeaea","#252525","#282531","#eaeaea","#282531","#d7ccff","#1d1b26","#ff5661","#008000","#faffff","#694fa8","#4d3e7f","#b73d5d","#822c43","#1f917c","#156353","#faffff","#716b7f","#eaeaea","#2a2244"]}',
  },
  {
    name: 'Solarized Dark',
    image: '/webui-themes/solarized-dark.png',
    payload:
      '{"WebColor":["#839496","#002b36","#073642","#839496","#002b36","#839496","#073642","#b58900","#859900","#eee8d5","#268bd2","#185886","#dc322f","#90211f","#859900","#647300","#839496","#073642","#839496","#0f3957"]}',
  },
]

export const TASMOTA_WEBUI_THEMES: TasmotaWebUiTheme[] = THEMES_RAW.map((t) => ({
  name: t.name,
  payload: t.payload,
  colors: parseColorsFromPayload(t.payload),
  image: t.image,
}))

function normalizeHexColor(c: unknown): string {
  let s = String(c).trim().toLowerCase()
  s = s.replace(/^["']|["']$/g, '')
  if (/^#[0-9a-f]{6}$/.test(s)) return s
  if (/^[0-9a-f]{6}$/.test(s)) return '#' + s
  const rgb = /^rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/.exec(s)
  if (rgb) {
    const r = Math.min(255, Math.max(0, parseInt(rgb[1]!, 10)))
    const g = Math.min(255, Math.max(0, parseInt(rgb[2]!, 10)))
    const b = Math.min(255, Math.max(0, parseInt(rgb[3]!, 10)))
    return '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('')
  }
  return s
}

/** Normalize WebColor array for comparison (trim, lowercase, optional #). */
function normalizeWebColorArray(arr: string[] | undefined): string[] {
  if (!Array.isArray(arr)) return []
  return arr.map((c) => normalizeHexColor(c))
}

/** Compare two WebColor array payloads (order matters). Stored (device) may be shorter; theme must match at least stored length. */
export function webColorPayloadsMatch(a: string[] | undefined, b: string[] | undefined): boolean {
  const na = normalizeWebColorArray(a)
  const nb = normalizeWebColorArray(b)
  if (na.length === 0 || nb.length < na.length) return false
  return na.every((v, i) => v === nb[i])
}

/** Get full WebColor array from a theme payload. */
export function getThemeWebColorArray(theme: TasmotaWebUiTheme): string[] {
  try {
    const obj = JSON.parse(theme.payload) as { WebColor?: string[] }
    return Array.isArray(obj?.WebColor) ? obj.WebColor : []
  } catch {
    return []
  }
}

/** Find theme index that matches the stored WebColor array, or -1. */
export function findThemeIndexByStoredArray(
  storedArray: string[] | undefined,
  themes: TasmotaWebUiTheme[]
): number {
  const normalized = normalizeWebColorArray(storedArray)
  if (normalized.length === 0) return -1
  return themes.findIndex((t) => webColorPayloadsMatch(normalized, getThemeWebColorArray(t)))
}

function extractWebColorArray(obj: unknown): string[] | undefined {
  if (!obj || typeof obj !== 'object') return undefined
  const o = obj as Record<string, unknown>
  for (const key of ['WebColor', 'webcolor', 'Webcolor']) {
    const val = o[key]
    if (Array.isArray(val)) return val.filter((c): c is string => typeof c === 'string')
    if (typeof val === 'string') {
      const trimmed = val.trim()
      if (trimmed.startsWith('[')) {
        try {
          const parsed = JSON.parse(trimmed) as unknown
          if (Array.isArray(parsed)) return parsed.filter((c): c is string => typeof c === 'string')
        } catch {
          /* fallback to split */
        }
      }
      const parts = trimmed.split(/[,;\s]+/).map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean)
      if (parts.length > 0) return parts
    }
  }
  return undefined
}

/** Extract WebColor array from raw stat/WebColor or stat/RESULT payload. */
export function getStoredWebColorArray(raw: Record<string, unknown> | null | undefined): string[] | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const direct = extractWebColorArray(raw['stat/WebColor'])
  if (direct?.length) return direct
  const res = extractWebColorArray(raw['stat/RESULT'])
  if (res?.length) return res
  return undefined
}
