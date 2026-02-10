# TasmotaScope mit Git ins Repository bringen

Kurze Anleitung, damit du TasmotaScope in ein Git-Repository (z.B. GitHub) bekommst – ohne viel Git-Vorwissen.

---

## Wichtig vorab

- **Ein Repository = ein Projekt.** TasmotaScope soll ein **eigenes** Repository haben (nicht in dem Repo deiner anderen Anwendung mischen). So kann Portainer genau dieses Projekt klonen und bauen.
- Du brauchst einen Account bei **GitHub** (oder GitLab, Gitea, etc.). Die Schritte unten sind für **GitHub** beschrieben; bei anderen Diensten ist es sehr ähnlich.

---

## Teil 1: Neues leeres Repository auf GitHub anlegen

1. Auf **https://github.com** einloggen.
2. Oben rechts auf **+** klicken → **New repository**.
3. **Repository name:** z.B. `TasmotaScope` (oder ein anderer Name).
4. **Public** lassen (oder **Private**, wenn nur du zugreifen sollst).
5. **Wichtig:**  
   - **NICHT** „Add a README file“ aktivieren.  
   - **NICHT** „Add .gitignore“ auswählen.  
   - Repository **komplett leer** lassen.
6. Auf **Create repository** klicken.
7. Auf der nächsten Seite siehst du eine URL, z.B.  
   `https://github.com/DEIN-USERNAME/TasmotaScope.git`  
   Diese URL brauchst du gleich.

---

## Teil 2: Git im TasmotaScope-Ordner einrichten (einmalig)

Öffne eine **Eingabeaufforderung** oder **PowerShell** und wechsle in deinen Projektordner:

```bash
cd D:\Cursor.ai\TasmotaScope
```

(Wenn dein Pfad anders ist, den Ordner anpassen, in dem die Dateien von TasmotaScope liegen.)

Falls du Git noch nie auf diesem Rechner eingerichtet hast, einmal diese Zeilen ausführen (mit deinem Namen und deiner E-Mail):

```bash
git config --global user.name "Dein Name"
git config --global user.email "deine-email@beispiel.de"
```

---

## Teil 3: Projekt ins Repository bringen

Alle folgenden Befehle **im TasmotaScope-Ordner** ausführen (gleicher `cd`-Pfad wie oben).

**Schritt 1 – Git starten (falls noch nicht geschehen):**

```bash
git init
```

**Schritt 2 – Alle Dateien zur „Staging-Area“ hinzufügen:**

```bash
git add .
```

(Der Punkt bedeutet „alles im aktuellen Ordner“. Durch die `.gitignore` werden z.B. `node_modules` und `.env` automatisch ausgeschlossen.)

**Schritt 3 – Ersten Commit anlegen:**

```bash
git commit -m "Erste Version TasmotaScope"
```

**Schritt 4 – Branch „main“ nennen (bei neueren Git-Versionen oft schon so):**

```bash
git branch -M main
```

**Schritt 5 – Verbindung zu GitHub herstellen:**

Ersetze `DEIN-USERNAME` und `TasmotaScope` durch deinen GitHub-Namen und deinen Repo-Namen:

```bash
git remote add origin https://github.com/DEIN-USERNAME/TasmotaScope.git
```

**Schritt 6 – Alles hochladen:**

```bash
git push -u origin main
```

Falls du nach **Benutzername** und **Passwort** gefragt wirst:  
- Benutzername = dein GitHub-Benutzername  
- Passwort = **nicht** dein normales Passwort, sondern ein **Personal Access Token** (siehe Kasten unten).

---

## Personal Access Token (für „Passwort“ beim Push)

GitHub erlaubt seit einiger Zeit kein normales Passwort mehr beim `git push` über HTTPS. Du brauchst einen Token:

1. GitHub → rechts oben auf dein Profilbild → **Settings**.
2. Links ganz unten: **Developer settings**.
3. **Personal access tokens** → **Tokens (classic)** → **Generate new token (classic)**.
4. Name z.B. `TasmotaScope`, Ablauf z.B. „90 days“ oder „No expiration“.
5. Unter **Scopes** mindestens **repo** anhaken.
6. **Generate token** klicken und den Token **sofort kopieren** (er wird nur einmal angezeigt).
7. Beim nächsten `git push` bei „Password“ **diesen Token** einfügen.

---

## Danach: Änderungen später hochladen

Wenn du etwas am Projekt geändert hast und das wieder zu GitHub bringen willst:

```bash
cd D:\Cursor.ai\TasmotaScope
git add .
git commit -m "Kurze Beschreibung der Änderung"
git push
```

- `git add .` = alle Änderungen vormerken  
- `git commit -m "..."` = einen „Stand“ mit Nachricht speichern  
- `git push` = diesen Stand zu GitHub hochladen  

Portainer kann dann beim nächsten **Redeploy** oder **Pull and redeploy** die neueste Version aus dem Repo holen.

---

## Kurz-Checkliste

| Schritt | Befehl / Aktion |
|--------|------------------|
| 1 | Auf GitHub: neues, **leeres** Repo anlegen |
| 2 | Im Projektordner: `git init` |
| 3 | `git add .` |
| 4 | `git commit -m "Erste Version TasmotaScope"` |
| 5 | `git branch -M main` |
| 6 | `git remote add origin https://github.com/DEIN-USERNAME/TasmotaScope.git` |
| 7 | `git push -u origin main` (bei Passwort: Token verwenden) |

Wenn du an einer Stelle eine Fehlermeldung bekommst, die Meldung kopieren und danach googeln oder hier einfügen – dann kann man gezielt helfen.
