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
   Bei privatem Repo: Nutzer/Token in der URL oder in Portainer unter „Authentication“ eintragen, falls angeboten.

5. **Repository reference (Branch/Tag):** z.B. `main` oder `master`.

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
