# TasmotaScope

TasmotaScope ist eine Weboberfläche für Tasmota-Geräte (MQTT, Regeln, Einstellungen, Backups in CouchDB).

## Deployment mit Docker (Produktiv)

Auf dem Docker-Server das Repository klonen (oder Dateien kopieren), dann:

```bash
# Optional: Anpassung per .env
# COUCHDB_USER=admin
# COUCHDB_PASSWORD=change-me
# COUCHDB_DATABASE=tasmotascope
# COUCHDB_PORT=5984
# HTTP_PORT=80

docker compose up -d --build
```

- **Frontend + API:** http://localhost:80 (bzw. `HTTP_PORT`)
- **CouchDB:** http://localhost:5984 (bzw. `COUCHDB_PORT`) – für die CouchDB-Einstellungen im Frontend (Host = Server-IP/Hostname, Port = 5984, User/Pass/Datenbank wie in `.env`).

Im Frontend unter Einstellungen CouchDB verbinden: Host = IP oder Hostname des Servers, Port = 5984 (oder `COUCHDB_PORT`), Benutzer/Passwort/Datenbank wie beim Start gesetzt. MQTT wird weiterhin direkt vom Browser aus verbunden (Broker-URL der MQTT-Instanz angeben).

**Installation über Portainer (externer Server):** Schritt-für-Schritt-Anleitung siehe [docs/DEPLOY-PORTAINER.md](docs/DEPLOY-PORTAINER.md).

**Git / Repository:** Wenn du das Projekt noch nie mit Git hochgeladen hast, hilft [docs/GIT-ANLEITUNG.md](docs/GIT-ANLEITUNG.md) (GitHub, erste Schritte, Push).

---

# React + TypeScript + Vite (Entwicklung)

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```
