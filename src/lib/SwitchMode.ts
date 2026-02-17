/**
 * Tasmota SwitchMode-Optionen (0–16).
 * Quelle: https://tasmota.github.io/docs/Buttons-and-Switches/
 * Gilt nur für als Switch<x> konfigurierte GPIOs, nicht für Button<x>.
 */

export type SwitchModeOption = {
  value: number
  /** Kurztext für Dropdown/Liste */
  label: string
  /** Ausführliche Erklärung für Info-Modal */
  description: string
}

export const SWITCH_MODE_OPTIONS: SwitchModeOption[] = [
  {
    value: 0,
    label: '0 – Umschaltmodus (Toggle)',
    description:
      'Standardmodus. Tasmota sendet bei jeder Zustandsänderung der Schaltung (Schließen oder Öffnen) einen TOGGLE-Befehl. Bei einem Taster wird beim Drücken ein TOGGLE und beim Loslassen erneut ein TOGGLE gesendet. Beispiel: Drücken schaltet die Klingel ein, Loslassen schaltet sie wieder aus.',
  },
  {
    value: 1,
    label: '1 – Folgemodus (0 = AUS, 1 = AN)',
    description:
      'Wenn die Schaltung geschlossen wird, sendet Tasmota AN; beim Öffnen wird AUS gesendet. Ideal für einen klassischen Lichtschalter (Kippschalter): Die Software spiegelt den Zustand des Hardware-Schalters. Steht der reale Schalter auf „AN“, ist der Zustand in Tasmota ebenfalls AN.',
  },
  {
    value: 2,
    label: '2 – Invertierter Folgemodus (0 = AN, 1 = AUS)',
    description:
      'Wenn die Schaltung geschlossen wird, sendet Tasmota AUS; beim Öffnen wird AN gesendet. Nützlich bei invertierter Logik der Schaltung.',
  },
  {
    value: 3,
    label: '3 – Tastermodus (Drücken = TOGGLE/AN)',
    description:
      'Tasmota sendet einen TOGGLE-Befehl, wenn der Taster gedrückt wird (Schaltung schließt). Beim Loslassen passiert nichts. Standardzustand AUS, beim Drücken AN (flankengesteuert: steigende Flanke).',
  },
  {
    value: 4,
    label: '4 – Invertierter Tastermodus (Loslassen = TOGGLE)',
    description:
      'Tasmota sendet einen TOGGLE-Befehl beim Loslassen des Tasters (Schaltung öffnet). Beim Drücken passiert nichts. Standardzustand AN, beim Drücken AUS (fallende Flanke).',
  },
  {
    value: 5,
    label: '5 – Taster mit Langdruck (HOLD)',
    description:
      'TOGGLE beim Drücken (bzw. je nach Konfiguration). Beim Gedrückthalten für die in SetOption32 eingestellte Zeit (Standard 4 s) sendet Tasmota HOLD (in Rules: Switch<x>#state=3). Nützlich für Zusatzfunktionen wie Langdruck-Aktionen.',
  },
  {
    value: 6,
    label: '6 – Invertierter Taster mit Langdruck (HOLD)',
    description:
      'TOGGLE wird beim Drücken des Tasters gesendet; beim Loslassen passiert nichts. Beim Gedrückthalten für die in SetOption32 eingestellte Zeit sendet Tasmota HOLD (in Rules: Switch<x>#state=3).',
  },
  {
    value: 7,
    label: '7 – Taster-Umschaltmodus',
    description:
      'Entspricht dem Umschaltmodus (SwitchMode 0). Taster verhält sich wie ein Toggle.',
  },
  {
    value: 8,
    label: '8 – Mehrfach-Umschaltmodus (2× Wechsel = HOLD)',
    description:
      'Wie SwitchMode 0, aber wenn sich der Schaltzustand innerhalb von 0,5 s zweimal ändert, wird kein TOGGLE gesendet, sondern Tasmota sendet HOLD (in Rules: Switch<x>#state=3). Achtung: Schnelles Wechseln kann zusätzliche Aktionen auslösen; AN/AUS wird nur übernommen, wenn kein zweiter Wechsel innerhalb von 0,5 s erfolgt.',
  },
  {
    value: 9,
    label: '9 – Mehrfach-Folgemodus (2× Wechsel = HOLD)',
    description:
      'Wie SwitchMode 1, aber bei zweimaligem Wechsel innerhalb von 0,5 s wird kein AUS/AN gesendet, sondern HOLD (Switch<x>#state=3). AN/AUS wird nur übernommen, wenn kein zweiter Wechsel innerhalb von 0,5 s erfolgt.',
  },
  {
    value: 10,
    label: '10 – Mehrfach invertierter Folgemodus (2× Wechsel = HOLD)',
    description:
      'Wie SwitchMode 2, aber bei zweimaligem Wechsel innerhalb von 0,5 s wird kein AN/AUS gesendet, sondern HOLD (Switch<x>#state=3). AN/AUS wird nur übernommen, wenn kein zweiter Wechsel innerhalb von 0,5 s erfolgt.',
  },
  {
    value: 11,
    label: '11 – Taster mit Dimmer & Doppelklick',
    description:
      'Kurzer Druck und Loslassen: TOGGLE (in Rules: Switch<x>#state=2). Langer Druck (Zeit in SetOption32): wiederholte INC_DEC-Befehle (Dimmer hoch/runter). Loslassen: sofortiger CLEAR. Verzögerter CLEAR nach SetOption32-Zeit (Switch<x>#state=6). Erneuter Druck vor Ablauf: INV (Switch<x>#state=5). Doppelklick: DOUBLE (Switch<x>#state=8). SetOption32 muss kleiner als 64 sein.',
  },
  {
    value: 12,
    label: '12 – Invertierter Taster mit Dimmer & Doppelklick',
    description:
      'Wie SwitchMode 11, aber mit invertiertem Verhalten. SetOption32 muss kleiner als 64 sein.',
  },
  {
    value: 13,
    label: '13 – „Drücken für AN“ (1 = AN, 0 = nichts)',
    description:
      'Tasmota sendet einen AN-Befehl, wenn der Taster gedrückt wird (Schaltung schließt). Beim Loslassen passiert nichts. Ausschalten z. B. über PulseTime.',
  },
  {
    value: 14,
    label: '14 – Invertiert „Drücken für AN“ (0 = AN, 1 = nichts)',
    description:
      'Nützlich z. B. bei PIR-Bewegungsmeldern: AN wird bei geöffneter Schaltung gesendet.',
  },
  {
    value: 15,
    label: '15 – Nur MQTT bei Schaltänderung',
    description:
      'Der Switch steuert keine Relais mehr; bei jeder Änderung wird nur eine MQTT-Nachricht gesendet (z. B. tele/…/SENSOR mit Switch1: OFF/ON). Es werden keine Zustandswerte für Rules bereitgestellt.',
  },
  {
    value: 16,
    label: '16 – Nur MQTT bei invertierter Schaltänderung',
    description:
      'Wie SwitchMode 15, aber mit invertierter Logik: Bei Schaltänderung wird nur MQTT gesendet, keine Relaissteuerung und keine Zustandswerte für Rules.',
  },
]

export function getSwitchModeOption(value: number): SwitchModeOption | undefined {
  return SWITCH_MODE_OPTIONS.find((o) => o.value === value)
}
