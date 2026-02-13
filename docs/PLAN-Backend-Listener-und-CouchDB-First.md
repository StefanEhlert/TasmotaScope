# Backend MQTT-Listener und CouchDB-First Frontend (aktualisierter Plan)

## Architektur-Überblick

```mermaid
flowchart LR
  subgraph backend [Backend]
    API[Express API]
    Listener[MQTT Listener]
    Map[In-Memory Device-Map]
    API --> Map
    Listener --> Map
    Listener --> CouchDB[(CouchDB)]
  end
  subgraph brokers [MQTT Broker(s)]
    B1[Broker 1]
    B2[Broker 2]
  end
  Listener --> B1
  Listener --> B2
  subgraph frontend [Frontend]
    App[App]
    MQTT_Pub[MQTT nur Publish]
    LS[LocalStorage: activeBrokerId]
  end
  App -->|GET devices, WebSocket Updates| API
  App -->|Broker CRUD| API
  API --> CouchDB
  App -->|Befehle: Restart, POWER, Rules| MQTT_Pub
  MQTT_Pub --> B1
```

- **Backend**: Hält CouchDB-Verbindung (Env oder POST), lädt Broker aus CouchDB, startet pro Broker einen MQTT-Client. Alle Gerätedaten leben in einer **In-Memory-Map**. Der Listener schreibt diese Map und persistiert nach CouchDB. Beim Start: **Rehydration** der Map aus CouchDB.
- **Frontend**: Gerätedaten **ausschließlich vom Backend** (In-Memory-Map): initial per GET, Updates per WebSocket/SSE. Broker-Verwaltung läuft über das Backend (speichern in CouchDB, Backend nutzt neuen Broker sofort). **LocalStorage** speichert nur die **aktive Broker-ID** für die Wiederherstellung beim nächsten Aufruf.

---

## 1. Gerätedaten: Backend In-Memory statt CouchDB-Direktzugriff

- **Single Source of Truth**: Die laufende Geräteliste lebt im Backend in einer In-Memory-Map (dieselbe, die der Listener befüllt). CouchDB dient nur noch als **Persistenz** und für **Rehydration** beim Backend-Start.
- **Frontend befüllt sich vom Backend**:
  - **Initial**: `GET /api/devices` (oder vergleichbar) liefert den aktuellen Snapshot (alle Geräte aus der Map, gleiches Format wie bisher für DeviceInfo/DeviceState).
  - **Echtzeit**: Backend pusht Änderungen per **WebSocket oder SSE**, sobald die Map aktualisiert wurde (nach Message-Verarbeitung bzw. nach Persist). Frontend aktualisiert seinen lokalen DeviceState damit – neue Nachrichten sind sofort sichtbar.
- **Backend-Start**: Beim Hochfahren lädt das Backend die Gerätedokumente aus CouchDB in die Map (**Rehydration**), damit das Frontend nach Neustart sofort wieder Daten hat, auch bevor neue MQTT-Nachrichten kommen.

---

## 2. MQTT-Broker über das Backend speichern

- **Broker-CRUD über Backend**: Anlegen, Bearbeiten, ggf. Löschen von Brokern erfolgt im Frontend über **Backend-API** (z. B. `GET /api/brokers`, `POST /api/brokers`, `PUT /api/brokers/:id`). Das Backend schreibt in CouchDB und kann den neuen/geänderten Broker **sofort verwenden** (neuen MQTT-Client starten bzw. bestehenden anpassen). Eine periodische Abfrage der Broker-Liste entfällt.
- **Frontend**: Broker-Verwaltung (BrokerModal) ruft die Backend-Endpoints auf; die Broker-Liste für die UI kommt vom Backend (GET /api/brokers). Beim Anlegen eines neuen Brokers: POST an Backend → Backend speichert in CouchDB und startet den Listener für diesen Broker → kein Polling nötig.

---

## 3. Aktive Broker-ID im LocalStorage

- Im **LocalStorage** des Frontends wird nur festgehalten, **mit welchem Broker gearbeitet wird** (die aktive Broker-ID). Beim nächsten Aufruf wird diese ID wiederhergestellt (bereits vorhanden: `loadActiveBrokerId` / `saveActiveBrokerId`), sodass die gleiche Broker-Auswahl erscheint. Die Broker-Liste selbst kommt vom Backend, nicht aus dem LocalStorage.

---

## 4. Backend: CouchDB-Status und Konfiguration

- **GET /api/status**: Liefert u. a. `couchdb: boolean` (CouchDB konfiguriert und erreichbar) sowie **Broker-Verbindungsstatus**: z. B. `brokers: { [brokerId]: 'connected' | 'disconnected' }`, damit das Frontend in der UI anzeigen kann, welche Broker verbunden sind.
- **POST /api/config/couchdb**: Body wie `CouchDbSettings`. Das Frontend kann damit auf eine **bestehende CouchDB-Instanz** wechseln (z. B. andere URL/DB). Backend speichert die vom Frontend übermittelte Konfiguration **nur in-memory** und nutzt sie sofort (Listener, Rehydration). Nach einem Backend-/Container-Neustart gilt wieder die **Env-Konfiguration**; das Frontend kann danach erneut POST senden, um dieselbe oder eine andere Instanz anzusprechen.
- **Persistenz der CouchDB-Config**: Zunächst **nur Env** – die Daten werden beim Erstellen des Containers per Umgebungsvariablen bereitgestellt. Das Backend speichert **keine** CouchDB-Config dauerhaft auf Disk (kein eigenes Config-File). Vom Frontend per POST gesendete Konfiguration überschreibt die Env-Config nur für die Laufzeit; ein späterer kompletter Stack kann eigene Persistenz (z. B. Config-Volume) mitbringen.

---

## 5. Backend: MQTT-Listener und Shared DeviceState-Logik

- **Listener-Modul** (z. B. `backend/src/listener.ts`): Verwendet **shared** Message-Verarbeitung und Snapshot-Erstellung (gemeinsames Modul mit dem Frontend, Node-kompatibel). Eine In-Memory-Map pro Prozess; bei eingehender MQTT-Nachricht: shared `ingestMessage`-Logik, Map aktualisieren, Dirty-Tracking, periodisches Schreiben nach CouchDB (`upsertDeviceSnapshot`). Bei LWT Online: Initial-Polling (STATUS 0/2/5, etc.) wie bisher. Pro Gerät: **letzte 30 Konsole-Zeilen** in-memory halten (für Abschnitt Konsole).
- **Broker-Quelle**: Beim Start und nach jedem Broker-CRUD (POST/PUT) lädt das Backend die Broker aus CouchDB (oder nutzt die vom CRUD übergebene Konfiguration direkt) und hält die MQTT-Clients dazu synchron – **kein periodisches Broker-Polling**.
- **Eine Backend-Instanz für den Listener**: Der Listener und die In-Memory-Map existieren **pro Backend-Prozess**. Würde man mehrere Backend-Instanzen (z. B. für Lastverteilung) betreiben, hätte jede ihre eigene Map und eigene MQTT-Verbindungen – dieselben Geräte würden mehrfach in CouchDB geschrieben, der Zustand wäre uneinheitlich. Daher gilt die Architektur-Annahme: **Es läuft genau eine Backend-Instanz**, die den Listener und die Map betreibt. Skalierung (falls später nötig) betrifft nur zustandslose Teile oder erfordert ein eigenes Design (z. B. nur eine Instanz mit Listener, andere Instanzen nur für API).

---

## 6. Backend: API für Geräte und Echtzeit-Updates

- **GET /api/devices**: Liefert den aktuellen Geräte-Snapshot aus der In-Memory-Map (Format kompatibel zu `DeviceState.getSnapshot()` / `hydrateFromSnapshots`). Pro Gerät können die **letzten 30 Konsole-Zeilen** mitgeliefert werden (siehe Abschnitt Konsole).
- **WebSocket oder SSE** (z. B. `/api/devices/stream`): Backend meldet bei jeder relevanten Änderung der Map (nach Message-Verarbeitung oder nach Persist) ein Update; Frontend erhält so **sofortige Updates** und aktualisiert seinen DeviceState. Technik: WebSocket oder SSE (Implementierung wählbar), Ziel ist in beiden Fällen Echtzeit ohne Polling.
- **Wiederverbindung und Resync**: Bei Abbruch der Verbindung verbindet sich das Frontend automatisch neu. Beim Öffnen einer **neuen** WebSocket-/SSE-Verbindung sendet das Backend **einmalig den vollständigen aktuellen Geräte-Snapshot** (wie `GET /api/devices`), damit das Frontend wieder sauber synchron ist.

---

## 7. Backend: Rehydration beim Start

- Nach dem Start (sobald CouchDB konfiguriert ist): Backend lädt alle Geräte-Dokumente aus CouchDB (analog `fetchDeviceSnapshots`) und füllt die In-Memory-Map. Danach übernimmt der MQTT-Listener die weiteren Updates; die Map bleibt die einzige Laufzeit-Quelle für Gerätedaten.

---

## 8. Frontend: Startablauf und Modals

- **Beim Start**: `GET /api/status`. Wenn `couchdb: false` oder Backend nicht erreichbar: **ConfigModal nur CouchDB** anzeigen. Bei Erfolg: POST CouchDB-Config an Backend, Settings im Frontend speichern (CouchDB-Teil).
- Danach: Broker-Liste vom Backend laden (`GET /api/brokers`). Wenn **keine Broker**: **BrokerModal** öffnen, um mindestens einen Broker anzulegen (über Backend-API). **Aktive Broker-ID** aus LocalStorage laden (`loadActiveBrokerId`); falls gespeicherte ID in der Broker-Liste existiert, diese Auswahl wiederherstellen.

---

## 9. Frontend: ConfigModal und BrokerModal

- **ConfigModal**: Nur noch CouchDB (keine MQTT-Felder). Titel/Beschreibung anpassen. Bei Apply: CouchDB testen, POST an Backend, Frontend-Settings speichern.
- **BrokerModal** ([src/components/BrokerModal.tsx](src/components/BrokerModal.tsx)): Speicherung über Backend (POST/PUT /api/brokers). Broker-Liste für die Anzeige vom Backend (GET /api/brokers). Nach Anlegen eines Brokers: Backend speichert in CouchDB und nutzt ihn sofort – kein Polling.
  - **Broker löschen**: Es gibt bisher keinen Lösch-Button. Ergänzung: **Lösch-Button (Papierkorb-Icon)** links neben dem Speichern-Button, **am linken Rand der Button-Zeile** ausgerichtet. Beim Löschen eines Brokers über die Backend-API werden **alle zugehörigen Geräte mit gelöscht** (in der Backend-Map und in CouchDB). Backend beendet den MQTT-Client für diesen Broker.

---

## 10. Frontend: Gerätedaten und MQTT

- **Gerätedaten**: Ausschließlich vom Backend – initial `GET /api/devices`, laufende Updates über **WebSocket oder SSE**. DeviceState im Frontend wird aus diesen Daten befüllt/aktualisiert (kein `fetchDeviceSnapshots` aus CouchDB mehr für die Geräteliste).
- **MQTT im Frontend**: Nur noch für **Publizieren** von Befehlen (Restart, POWER, Rules, etc.) zum **aktiv gewählten Broker** (Broker-Daten vom Backend, Auswahl aus LocalStorage). Kein Subscribe auf `#` für Geräte-Updates.

---

## 10a. Konsole (Geräte-Einstellungsseite)

- Die Konsole wird heute aus MQTT-Nachrichten im Frontend befüllt. Da das Frontend nicht mehr auf Topics subscribet, liefert das **Backend** die Konsolen-Daten.
- **Lösung**: Das Backend hält die **letzten 30 Zeilen pro Gerät** (Topic + Payload-Text) in-memory und liefert sie mit den Gerätedaten (z. B. in `GET /api/devices` pro Gerät als `consoleLines: string[]` oder eigener Feldname). So hat die Geräte-Einstellungsseite Zugriff auf Daten aus der kurzen Vergangenheit und aktuelle Einträge nach jedem Update.

---

## 10b. Meta-Updates (Auto-Backup, Rules, settingsUi) über Backend

- Änderungen an **Auto-Backup-Intervall**, **Rules** (Texte, enabled, etc.) und **settingsUi** (z. B. eingeklappte Bereiche) laufen nicht mehr im Frontend gegen DeviceState/CouchDB, sondern über **Backend-APIs** (z. B. PATCH/POST für Gerät oder Rules). Das Backend aktualisiert seine In-Memory-Map und CouchDB und sendet bei Rules ggf. die MQTT-Befehle an das Gerät. So bleibt der Backend-Zustand die einzige Quelle der Wahrheit.

---

## 11. Shared Module (DeviceState-Logik)

- Gemeinsames **shared** Modul (Node- und Browser-kompatibel) für Message-Parsing, Snapshot-Bau und Typen. Backend und Frontend nutzen dieselbe Logik; die **laufende Instanz** der Map bleibt im Backend. Frontend hat nur eine „Spiegelung“ der Daten, die vom Backend kommt.

---

## 12. Beschlossene Konfiguration

- **Backend-URL im Frontend**: **Feste URL** `/api` – keine Umgebungsvariable. Das Frontend nutzt relativ zur gleichen Origin bzw. den konfigurierten Proxy. **Entwicklung**: Vite-Proxy so einrichten, dass Anfragen an `/api` an das Backend (z. B. localhost:3001) weitergeleitet werden. **Produktion**: Gleiche Origin (z. B. Reverse-Proxy liefert Frontend und leitet `/api` an das Backend weiter).
- **Persistenz der CouchDB-Config**: **Env beim Container-Start** – CouchDB-Daten werden beim Erstellen des Containers per Env bereitgestellt. Zusätzlich kann das **Frontend CouchDB per POST ändern** (z. B. auf bestehende Instanz zugreifen); das Backend hält diese Angaben **nur in-memory** und speichert sie nicht auf Disk. Nach Neustart gilt wieder Env; ein späterer kompletter Stack kann eigene Persistenz ergänzen.
- **Live-Updates**: **WebSocket oder SSE** – das Frontend erhält sofortige Geräte-Updates vom Backend (kein Polling).
- **Broker-Verbindungsstatus**: Die API (z. B. `GET /api/status`) liefert den Verbindungsstatus der MQTT-Clients pro Broker (`connected` / `disconnected`), damit die UI den Status anzeigen kann.
