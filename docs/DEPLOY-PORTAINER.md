# TasmotaScope mit Portainer auf einem externen Server

So bringst du TasmotaScope per Portainer-Stack auf deinen Server (z.B. VPS, NAS, eigener Host).

## Voraussetzung

- Portainer läuft auf dem Server (Docker + Portainer-Installation).
- Das Projekt steht in einem **Git-Repository** (GitHub, GitLab, Gitea, etc.). Portainer baut die Images aus dem Repo.  
  **Noch kein Repo?** → Siehe [GIT-ANLEITUNG.md](GIT-ANLEITUNG.md) (Repository anlegen und ersten Push).

---

## Option A: Stack aus Git (empfohlen)

1. **Portainer öffnen** → **Stacks** → **+ Add stack**.

2. **Name:** z.B. `tasmotascope`.

3. **Deployment method:** **Git repository** auswählen.

4. **Repository URL:** deine Clone-URL (HTTPS), z.B.  
   `https://github.com/DEIN_USER/TasmotaScope.git`  
   **Bei privatem Repo:** Unten bei **Authentication** unbedingt aktivieren und eintragen: **Username** = GitHub-Benutzername, **Password** = **Personal Access Token** (von GitHub → Settings → Developer settings → Personal access tokens). Ohne das kann Portainer das Repo nicht klonen (Fehler z.B. „could not find ref main“).

5. **Repository reference (Branch/Tag):** Den **tatsächlichen** Branch-Namen eintragen.  
   - Bei neu angelegten Repos oft `main`.  
   - Bei älteren GitHub-Repos oft `master`.  
   **Fehler „could not find ref main“?** → Hier z.B. `master` eintragen (oder auf GitHub unter „Code“ den angezeigten Branch-Namen übernehmen).

6. **Compose path:** `docker-compose.yml` (relativer Pfad im Repo zur Compose-Datei).

7. **Environment variables (optional, aber sinnvoll):**  
   Auf „Add environment variable“ klicken und z.B. setzen:

   | Name               | Wert (Beispiel)   | Bedeutung                    |
   |--------------------|-------------------|------------------------------|
   | `COUCHDB_USER`     | `admin`           | CouchDB-Benutzer             |
   | `COUCHDB_PASSWORD` | **sicheres Passwort** | CouchDB-Passwort (unbedingt ändern) |
   | `COUCHDB_DATABASE` | `tasmotascope`    | App-Datenbank                |
   | `COUCHDB_PORT`     | `5984`            | CouchDB-Port nach außen      |
   | `HTTP_PORT`        | `80`              | Port der Weboberfläche       |

   Wenn du z.B. nur Port 8080 für die Weboberfläche nutzen willst: `HTTP_PORT` = `8080`.

8. **Deploy the stack** klicken.  
   Portainer klont das Repo und führt `docker compose up -d --build` aus (Build der Images Backend + Frontend). Beim ersten Mal kann das einige Minuten dauern.

9. **Erreichbarkeit prüfen:**
   - **Weboberfläche:** `http://<DEINE-SERVER-IP>:80` (bzw. der gewählte `HTTP_PORT`, z.B. 8080).
   - **CouchDB:** `http://<DEINE-SERVER-IP>:5984` (bzw. `COUCHDB_PORT`).

10. **Im Frontend konfigurieren:**
    - Unter **Einstellungen** → CouchDB:  
      Host = **IP oder Hostname des Servers**, Port = **5984** (oder dein `COUCHDB_PORT`), Benutzer/Passwort/Datenbank = die Werte aus Schritt 7.
    - MQTT-Broker wie gewohnt eintragen (Verbindung läuft aus dem Browser).

---

## Option B: Ohne Git (z.B. nur Compose-Datei)

Wenn du **kein Git** nutzen willst, musst du die Images woanders bauen und in der Compose nur fertige Images verwenden, **oder** du arbeitest per SSH auf dem Server:

1. Per **SSH** auf den Server gehen.
2. Projektordner anlegen und Dateien dorthin kopieren (z.B. per SCP, SFTP oder ZIP mit allen Dateien inkl. `backend/`, `docker/`, `src/`, `docker-compose.yml`, `Dockerfile.frontend`, etc.).
3. Im Projektordner ausführen:
   ```bash
   docker compose up -d --build
   ```
4. In **Portainer** den Stack nicht aus Git anlegen, sondern die laufenden Container/Compose-Projekte erscheinen unter **Containers** bzw. **Stacks** (wenn Portainer mit dem gleichen Docker-Host verbunden ist), oder du importierst das Projekt später in Portainer.

**Alternative:** Du baust die Images lokal (oder in CI), pushst sie in eine Registry (Docker Hub, GitLab Registry, etc.) und verwendest eine Compose-Variante, die nur `image: ...` nutzt statt `build: ...`. Dafür müsste das Projekt um eine „image-only“-Compose-Datei ergänzt werden (z.B. `docker-compose.portainer.yml` mit festen Image-Namen). Wenn du das möchtest, kann man das als nächsten Schritt ausarbeiten.

---

## Nach dem Deployment

- **CouchDB-Passwort:** In Produktion `COUCHDB_PASSWORD` unbedingt stark setzen und im Frontend bei den CouchDB-Einstellungen dasselbe Passwort verwenden.
- **HTTPS:** Für Zugriff von außen empfiehlt sich ein Reverse-Proxy (z.B. Nginx, Traefik, Caddy) mit TLS vor Portainer/Docker. Dann erreichst du z.B. `https://tasmotascope.deinedomain.de` und leitest auf den Container-Port (z.B. 80 oder 8080) weiter.
- **Firewall:** Ports 80 (bzw. `HTTP_PORT`) und 5984 (bzw. `COUCHDB_PORT`) müssen für den Zugriff von außen freigegeben sein (oder nur über den Reverse-Proxy erreichbar sein).

---

## Kurzfassung (Portainer aus Git)

| Schritt | In Portainer |
|--------|---------------|
| Stack anlegen | Stacks → Add stack |
| Quelle | Deployment method: **Git repository** |
| URL | Deine Repo-URL (z.B. `https://github.com/.../TasmotaScope.git`) |
| Branch | z.B. `main` |
| Compose path | `docker-compose.yml` |
| Env (wichtig) | `COUCHDB_PASSWORD` setzen, ggf. `HTTP_PORT` / `COUCHDB_PORT` |
| Start | Deploy the stack |

Danach: Browser → `http://<Server-IP>:80` (oder dein `HTTP_PORT`), CouchDB in den Einstellungen mit Server-IP und Port 5984 verbinden.

---

## Häufige Fehler

### „Unable to fetch git repository … could not find ref 'main' in the repository“

**Ursache 1 – Repository ist noch leer**  
GitHub zeigt „main“ als Standard-Branch an, aber der Branch **existiert erst nach dem ersten Push**. Ohne einen einzigen Commit gibt es keinen Branch zum Klonen.

**Prüfen:** Repo auf GitHub öffnen. Siehst du Dateien (z.B. `package.json`, Ordner `src/`, `backend/`)?  
- **Nein, nur „Add file“ / leere Seite** → Repo ist leer. Du musst von deinem Rechner aus den Code pushen (siehe [GIT-ANLEITUNG.md](GIT-ANLEITUNG.md), Teil 3: `git init`, `git add .`, `git commit`, `git push -u origin main`). Danach kann Portainer „main“ finden.  
- **Ja, Dateien sind da** → dann Ursache 2 prüfen.

**Ursache 2 – Privates Repo, Portainer hat keine Zugangsdaten**  
Dein Rechner hat Git-Zugangsdaten gespeichert (daher fragt `git push` nicht). **Portainer läuft auf dem Server** und hat diese Daten nicht – beim Klonen eines **privaten** Repos meldet GitHub manchmal trotzdem „ref not found“.

**Lösung:** Beim Anlegen/Bearbeiten des Stacks bei **Git repository** die **Authentication** aktivieren und eintragen:
- **Username:** dein GitHub-Benutzername  
- **Password:** ein GitHub **Personal Access Token** (nicht dein GitHub-Passwort)

Ohne diese Angaben kann Portainer ein privates Repo nicht klonen.

**Ursache 3 – Anderer Branch-Name**  
Wenn im Repo schon Code liegt, auf GitHub oben links den **angezeigten Branch-Namen** prüfen (z.B. `master`). Diesen exakt in Portainer unter **Repository reference (Branch/Tag)** eintragen.

**Ursache 4 – Andere Fehlerquellen (wenn alles oben schon stimmt)**

- **Reference-Format:** In Portainer bei **Repository reference** statt `main` einmal **`refs/heads/main`** eintragen (manche Portainer-Versionen erwarten die volle Referenz).
- **Repository-URL exakt:** URL von GitHub unter „Code“ → HTTPS kopieren. Kein Schrägstrich am Ende, mit **`.git`** am Ende (z.B. `https://github.com/USER/REPO.git`). Keine URL von einer einzelnen Datei oder einem Branch-Link.
- **Repo kurz öffentlich stellen:** Zum Test das Repo auf GitHub auf **Public** stellen. Wenn es dann in Portainer klappt, lag es an der Authentifizierung (Token/Rechte). Danach kannst du es wieder auf Private stellen und den Token in Portainer prüfen.
- **Netzwerk auf dem Server:** Portainer (bzw. der Build-Agent) muss **github.com** erreichen können. Wenn der Server hinter einer Firewall/Proxy liegt oder kein ausgehender HTTPS-Zugriff erlaubt ist, schlägt das Klonen fehl. Prüfen: Per **SSH auf den Server** gehen und z.B. `curl -I https://github.com` ausführen – wenn das nicht geht, kann auch Portainer nicht klonen.
- **Portainer-Version:** Alte Portainer-Versionen haben teils Fehler beim Git-Deploy. Portainer auf die aktuelle Version aktualisieren und erneut versuchen.

---

## Plan B: Ohne Portainer-Git deployen (per SSH)

Wenn der Stack aus Git in Portainer partout nicht funktioniert, kannst du **ohne Portainer-Git** deployen: Du klonst das Repo direkt auf dem Server und startest Docker Compose dort. Die Container laufen trotzdem und erscheinen in Portainer unter **Containers** (gleicher Docker-Host). Später Updates: per SSH `git pull` und `docker compose up -d --build`.

**Schritte:**

1. **SSH-Zugang** zum Server haben (z.B. PuTTY oder `ssh user@server-ip`).

2. Auf dem Server ins gewünschte Verzeichnis wechseln und Repo klonen (bei privatem Repo: Token in der URL verwenden oder vorher `git config credential.helper` nutzen):
   ```bash
   cd /opt
   sudo git clone https://github.com/DEIN-USERNAME/TasmotaScope.git
   cd TasmotaScope
   ```

3. Optional `.env` anlegen (CouchDB-Passwort etc.):
   ```bash
   sudo nano .env
   ```
   Inhalt z.B.:
   ```
   COUCHDB_USER=admin
   COUCHDB_PASSWORD=dein-sicheres-passwort
   COUCHDB_DATABASE=tasmotascope
   HTTP_PORT=80
   COUCHDB_PORT=5984
   ```
   Speichern und Nano verlassen (Strg+O, Enter, Strg+X).

4. Stack starten:
   ```bash
   sudo docker compose up -d --build
   ```

5. Erreichbarkeit prüfen: `http://<Server-IP>:80` und `http://<Server-IP>:5984`.

**Später aktualisieren:**

```bash
cd /opt/TasmotaScope
sudo git pull
sudo docker compose up -d --build
```

Portainer zeigt die laufenden Container weiterhin unter **Containers** an; du verwaltest sie nur nicht als „Stack aus Git“, sondern das Compose-Projekt liegt auf dem Server im Dateisystem.

---

### „compose build operation failed: The command '/bin/sh -c npm run build' returned a non-zero code: 2“

Der Build eines der Images (Backend oder Frontend) schlägt beim `npm run build` fehl. **Exit Code 2** kommt oft von TypeScript/Vite (Kompilierfehler) oder von **zu wenig Speicher** (Node bricht ab).

**Was du tun kannst:**

1. **Vollständigen Build-Log ansehen**  
   In Portainer beim fehlgeschlagenen Deploy den **Build-Log** (bzw. die Fehlerausgabe) durchscrollen. Dort steht, ob **backend** oder **frontend** scheitert und die genaue Meldung (z.B. TypeScript-Fehler oder „JavaScript heap out of memory“).

2. **Speicherlimit für Node erhöhen (bereits im Projekt)**  
   In den Dockerfiles ist für den Build `NODE_OPTIONS=--max-old-space-size=...` gesetzt (Frontend 2048 MB, Backend 1024 MB). Wenn du auf einem sehr kleinen Server (z.B. 1 GB RAM) bist, den Stack nur mit diesem einen Projekt laufen lassen oder RAM/Swap erhöhen.

3. **Bei „heap out of memory“**  
   Auf dem Server mehr Speicher für Docker/Container bereitstellen oder lokal/auf einer stärkeren Maschine bauen und Images in eine Registry pushen (erweiterte Variante).

4. **Bei TypeScript-/Vite-Fehlermeldung im Log**  
   Die genaue Zeile (Datei + Fehler) aus dem Log nehmen; dann lässt sich der Fehler im Code gezielt beheben. Wenn du die Log-Ausgabe hast, kann man danach gezielt weiter eingrenzen.
