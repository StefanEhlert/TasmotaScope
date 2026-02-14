# Analyse: Wo kann SSE lokale Benutzer-Änderungen überschreiben?

**Grundmuster:** Der Benutzer ändert etwas im Frontend → lokaler State wird aktualisiert. Gleichzeitig liefert das Backend per SSE den letzten bekannten Stand. Wenn die Änderung erst mit Verzögerung ans Backend geht (oder gar nicht), kann das nächste SSE-Update den alten Stand liefern und die Anzeige zurücksetzen.

---

## 1. Ablauf (Kurz)

- **Frontend:** `DeviceState.updateInfo` / `updateSettingsUi` / `updateRule` setzen lokalen State und markieren das Gerät als „dirty“.
- **Persist:** Die `persistFn` wird nur alle **10 Sekunden** ausgeführt (`shared/deviceStore.ts`: `setInterval(..., 10_000)`). Sie ruft aktuell nur `patchDeviceInfo(..., { autoBackupIntervalDays, settingsUi })` auf – also **keine** Rules, keine Backup-Metadaten.
- **SSE:** Bei jeder Backend-Store-Änderung (z. B. MQTT) sendet das Backend den kompletten Gerätestand. Das Frontend wendet ihn in `apply()` mit `hydrateFromSnapshots(snapshots)` an.
- **Hydration:** In `hydrateFromSnapshots` werden verschiedene Felder aus dem Snapshot übernommen; bei **Merge** (z. B. `settingsUi`) kann lokaler State erhalten bleiben, bei **Ersetzen** gewinnt der Snapshot.

---

## 2. Felder und Risiko

| Feld / Bereich | Wo geändert | An Backend gesendet? | Bei Hydration | Risiko |
|----------------|-------------|----------------------|---------------|--------|
| **autoBackupIntervalDays** | Geräte-Einstellungen, Bulk | Ja, sofort per PATCH + später über persistFn | Ersetzen (nur Snapshot) | **Behoben:** sofortiger PATCH + 3‑Sekunden-Guard in `apply()`. |
| **settingsUi** (consoleExpanded, collapsedBlockIds) | DeviceSettingsPage | Ja, aber nur über persistFn (alle 10 s) | **Merge:** `mergeSettingsUi(remote, local)` → **local** überschreibt remote. | **Gering:** Lokale Änderungen gewinnen im Merge. Kann kippen, wenn Backend ein neueres settingsUi liefert (z. B. anderer Tab). |
| **rules** (Tasmota Rules pro Gerät) | RulesPage, RuleEditor | Ja, sofort per PATCH + in CouchDB persistiert | Ersetzen (mit 3‑s-Guard) | **Behoben:** PATCH akzeptiert `rules`, Backend speichert in Store + CouchDB; Frontend ruft nach updateRule/updateRuleWithComments sofort PATCH auf; 3‑s-Guard in `apply()` verhindert Überschreibung durch veraltetes SSE. |
| **backupCount / backupItems / daysSinceBackup** | Nach Backup/Delete (lokal + ggf. CouchDB) | Nicht über persistFn; Backend kennt Stand aus Backup-API/CouchDB | Vollständig aus Snapshot | **Niedrig:** Nach Backup holt sich das Frontend teils einen Snapshot von CouchDB; sonst kurze Rennlage bis Backend-SSE mit neuem Stand. |

---

## 3. Konkrete Stellen im Code

### 3.1 Bereits abgesichert

- **autoBackupIntervalDays:**  
  - `handleUpdateAutoBackup` ruft sofort `patchDeviceInfo(..., { autoBackupIntervalDays })` auf.  
  - In `apply()` wird für dieselbe deviceId für 3 Sekunden der Wert aus `lastAutoBackupUpdateRef` in den eingehenden Snapshot geschrieben, damit veraltetes SSE nicht überschreibt.  
  - Siehe `src/App.tsx`: `handleUpdateAutoBackup`, `lastAutoBackupUpdateRef`, `apply()`.

### 3.2 Geringes Risiko (Merge schützt)

- **settingsUi:**  
  - Geändert in `DeviceSettingsPage` (Konsole ein/aus, Accordion-Blöcke).  
  - Wird nur über die 10‑Sekunden-Persist ans Backend geschickt.  
  - In `hydrateFromSnapshots` wird `mergeSettingsUi(record.info.settingsUi, snapshot.settingsUi)` verwendet; lokaler Wert hat Vorrang.  
  - Risiko: Wenn das Backend ein neueres `settingsUi` liefert (z. B. zweiter Tab), kann das lokale UI-Zustand überschreiben. Für Einzel-Tab-Nutzung aktuell unkritisch.

### 3.3 Rules (umgesetzte Abhilfe)

- **Rules:**  
  - Geändert mit `DeviceState.updateRule` / `updateRuleWithComments` (z. B. in `App.tsx` und `RulesPage.tsx`).  
  - **Umgesetzt:** PATCH `/api/devices/:deviceId` akzeptiert `body.rules`; Backend ruft `store.replaceRules(deviceId, rules)` auf und persistiert per `upsertDeviceSnapshot` in CouchDB.  
  - Frontend: Nach jedem `updateRule` bzw. `updateRuleWithComments` wird `handleRuleChange(deviceId)` aufgerufen → sofortiger PATCH mit `DeviceState.getRules(deviceId)`.  
  - In `apply()`: Für 3 Sekunden nach einer Rule-Änderung wird für die betroffene deviceId der aktuelle lokale Rules-Stand in den eingehenden Snapshot geschrieben (`lastRulesUpdateRef`), damit veraltetes SSE nicht überschreibt.

### 3.4 Weitere lokale updateInfo-Aufrufe

- **Backup-Metadaten** (z. B. nach manuellem Backup oder Delete):  
  - `DeviceState.updateInfo(deviceId, { daysSinceBackup, backupCount [, backupItems ] })`.  
  - Nicht über persistFn gesendet; Backend-Stand kommt aus Backup-API/CouchDB und per SSE.  
  - Kurze Rennlage möglich (SSE mit altem Stand trifft vor Backend-Update ein). Aktuell geringes Risiko, da Backup-Flow danach oft einen Snapshot von CouchDB lädt oder das Backend nach Backup den Store aktualisiert.

---

## 4. Empfehlungen (Priorität)

1. **Rules:** Umgesetzt (PATCH + sofortiger Aufruf + 3‑s-Guard).

2. **settingsUi (optional):**  
   - Wenn gewünscht: bei Änderung von settingsUi sofort `patchDeviceInfo(..., { settingsUi })` aufrufen (evtl. mit kleinem Debounce), damit zweiter Tab / Reconnect konsistent ist und kein veraltetes SSE gewinnt.

3. **Persist-Intervall:**  
   - Das 10‑Sekunden-Intervall im shared Store betrifft alle Felder, die nur über die persistFn ans Backend gehen. Für weitere benutzer-editierbare Felder (z. B. rules, wenn ins PATCH aufgenommen) entweder sofortigen PATCH bei Aktion oder kürzeres Intervall / sofortiger Flush für bestimmte Felder in Erwägung ziehen.

---

## 5. Kurz-Checkliste für neue „user-editierbare“ Felder

- Wird das Feld im Frontend geändert und kommt es per SSE wieder vom Backend?
- Wenn ja: Wird die Änderung **sofort** ans Backend geschickt (z. B. PATCH)?
- Wenn nein: Kann ein eintreffendes SSE den alten Stand liefern und die Anzeige zurücksetzen?
- In `hydrateFromSnapshots`: Wird das Feld **ersetzt** (Snapshot gewinnt) oder **gemerged** (lokal kann gewinnen)?
- Wenn ersetzt und nicht sofort gesendet: Gleiches Muster wie bei autoBackupIntervalDays (sofortiger PATCH + optional Guard) oder wie bei rules (PATCH erweitern / Hydration anpassen) prüfen.
