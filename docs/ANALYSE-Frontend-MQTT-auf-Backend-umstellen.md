# Analyse: Frontend-MQTT auf Backend umstellen

**Ziel:** Alle MQTT-Befehle und -Abrufe über das Backend laufen lassen. Das Frontend verbindet sich nicht mehr per WebSocket mit dem Broker – nur das Backend nutzt den normalen MQTT-Port (z. B. 1883). User müssen den WebSocket-Port am Broker nicht aktivieren.

---

## 1. Aktuelle Frontend-Stellen mit MQTT-Zugriff

### 1.1 Zentral: Command Sender (App.tsx)

- **Zeile ~197–206:** `DeviceState.setCommandSender((_, topic, payload) => { mqttRef.current.publish(topic, payload) })`
- Wird von der Shared-Logik und von Rules genutzt, sobald ein Befehl an ein Gerät gesendet werden soll (z. B. Rule speichern).
- **Umstellung:** Sender durch Aufruf einer Backend-API ersetzen (z. B. `POST /api/command` mit `deviceId`, `topic`, `payload`).

### 1.2 Rules-Seite: Regeln laden (App.tsx)

- **Zeile ~259–280:** Beim Öffnen der Rules-Seite werden Befehle gesendet:
  - `cmnd/<topic>/RULE1`, `RULE2`, `RULE3` (leer)
  - `cmnd/<topic>/VAR`, `MEM`, `RULETIMER`
- Bedingung: `mqttRef.current?.connected`
- **Umstellung:** Statt `mqttRef.current?.publish(...)` Backend-API aufrufen (gleiche Topics/Payloads).

### 1.3 Geräte-Einstellungen: STATUS 5 (App.tsx)

- **Zeile ~282–298:** Beim Öffnen der Einstellungen, wenn Power-Kanäle keine Labels haben:
  - `cmnd/<topic>/STATUS` mit Payload `5`
- **Umstellung:** Ebenfalls über Backend-API senden.

### 1.4 Neustart (App.tsx)

- **Zeile ~493–495:** Bulk-Neustart: `cmnd/<topic>/Restart` mit `1`
- **Zeile ~1014–1018:** Einzel-Neustart (Bestätigungsdialog): gleicher Befehl
- **Umstellung:** Beide Wege über Backend-API.

### 1.5 Power-Schalter (App.tsx)

- **Zeile ~507–515:** `sendPowerToggle`: `cmnd/<topic>/POWER` oder `POWER<n>` mit `TOGGLE`
- **Zeile ~756–761:** `DeviceSettingsPage` prop `onSendCommand`: beliebiger `cmnd/<topic>/<command>` + Payload
- **Zeile ~779–786:** `RulesPage` prop `onSendCommand`: gleiche Signatur
- **Umstellung:** Alle über eine gemeinsame Backend-API (z. B. `POST /api/command`).

### 1.6 MQTT-Verbindung und UI (App.tsx)

- **Zeile ~596–605:** `connectMqttLive(broker.mqtt)` – baut WebSocket-Verbindung zum Broker auf (für Publish).
- **Zeile ~300–306:** Effect, der bei aktivem Broker `connectMqttLive(broker.mqtt)` aufruft.
- **Zeile ~744:** Status-Pille „MQTT“ mit `mqttState` (ok/Fehler der Frontend-Verbindung).
- **Umstellung:** Keine Frontend-MQTT-Verbindung mehr; Status kann aus `GET /api/status` kommen (`brokers[activeBrokerId] === 'connected'`). `connectMqttLive`, `mqttRef`, `createMqttClient` und die MQTT-Pille können entfernt bzw. durch Broker-Status vom Backend ersetzt werden.

---

## 2. Weitere Erwähnungen (kein direkter Broker-Zugriff)

- **BrokerModal / types / storage:** Konfiguration von Brokern (Host, Port, ggf. wsPort) – bleibt für die Backend-Konfiguration (Backend verbindet sich per TCP). Im Frontend nur noch für Anzeige/Bearbeitung der Broker-Liste; **kein** Frontend-WebSocket mehr nötig, wsPort kann optional bleiben oder später aus der UI entfernt werden.
- **RuleEditor / tasmotaRulesParser:** „publish“ bezieht sich auf Tasmota-Rule-Syntax, nicht auf den Frontend-MQTT-Client – keine Änderung nötig.
- **DeviceState.setCommandSender:** Wird nur in App gesetzt; die Aufrufer (z. B. Rules) bleiben, nur die Implementierung wird von `mqttRef.publish` auf Backend-API umgestellt.

---

## 3. Nötige Backend-Erweiterung

- **Neuer Endpoint:** z. B. `POST /api/command`  
  - Body: `{ deviceId: string, topic: string, payload: string }`  
  - Optional: `brokerId`, falls Backend es nicht aus dem Gerät ermitteln kann.
- **Backend-Logik:** Aus dem bestehenden Listener die passende MQTT-Client-Instanz pro Broker nutzen (bereits vorhanden: `clientsByBrokerId`, `store.getDevice(deviceId)?.brokerId`). Befehl mit `client.publish(topic, payload)` senden.
- Kein neues Protokoll nötig; nur ein HTTP-Endpoint, der das bestehende Publish des Listeners anstößt.

---

## 4. Zusammenfassung der Frontend-Änderungen

| Bereich              | Aktuell                          | Ziel                                      |
|----------------------|-----------------------------------|-------------------------------------------|
| Command Sender       | `mqttRef.current.publish(...)`   | `POST /api/command` (deviceId, topic, payload) |
| Rules laden          | mehrere `mqttRef.current.publish` | gleiche Befehle über Backend-API          |
| STATUS 5 (Labels)    | `mqttRef.current.publish`        | über Backend-API                          |
| Neustart (einzeln + Bulk) | `mqttRef.current.publish`   | über Backend-API                          |
| Power / onSendCommand | `mqttRef.current.publish`      | über Backend-API (oder Command Sender)    |
| connectMqttLive      | WebSocket zum Broker              | entfernen                                 |
| mqttRef, createMqttClient | Frontend-MQTT-Client           | entfernen                                 |
| MQTT-Status-Pille    | mqttState (Frontend-Verbindung)   | Broker-Status aus `GET /api/status`      |
| Abhängigkeit wsPort  | Frontend verbindet sich mit Broker| entfällt (nur Backend nutzt Broker-Port)  |

---

## 5. Reihenfolge für die Umsetzung

1. **Backend:** `POST /api/command` implementieren (deviceId, topic, payload; Broker aus Store/Listener ermitteln, publish auf passendem Client).
2. **Frontend:** Gemeinsame Hilfsfunktion z. B. `sendCommand(deviceId, topic, payload)` (ruft Backend-API auf).
3. **Frontend:** `DeviceState.setCommandSender` durch Implementierung ersetzen, die `sendCommand` nutzt.
4. **Frontend:** Alle direkten `mqttRef.current?.publish(...)` durch `sendCommand` (oder Backend-Aufruf) ersetzen.
5. **Frontend:** `connectMqttLive`, `mqttRef`, `createMqttClient` und ggf. `mqttState` / MQTT-Pille entfernen oder durch Broker-Status ersetzen.
6. **Optional:** In der Broker-UI das WebSocket-Port-Feld ausblenden oder als „nur für Backend nicht nötig“ kennzeichnen.

Damit sind alle MQTT-Zugriffe im Frontend erfasst und auf das Backend umstellbar; das Frontend ist danach nicht mehr auf den WebSocket-Port des Brokers angewiesen.
