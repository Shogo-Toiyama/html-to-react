# React Launchpad (frontend)

A browser app that runs a workshop participant's local React project without installing Node.js.

- The participant picks a folder on their computer (File System Access API, **Chrome/Edge only**).
- The project runs in a [WebContainer](https://webcontainers.io/) (Node.js in the browser): `npm install` → `npm run dev`, with the preview shown in an iframe.
- Participants keep editing in VS Code. The app polls the folder every second and copies changes into the container, so Vite's HMR updates the preview.
- An empty folder can be turned into a starter Vite + React (JavaScript) project.
- A plain HTML/CSS/JS site can be converted into a React project in a new folder (the original is never changed).

## HTML → React converter (v1)

`src/converter/` turns one HTML page into a Vite + React project with as few changes as possible. Everything is deterministic (no LLM yet).

| Original | React project |
|---|---|
| `<body>` | `src/App.jsx` as JSX (`class` → `className`, `style` → object, `onclick="..."` → `onClick={...}`, form fields → `defaultValue`/`defaultChecked`, whitespace kept with `{' '}`) |
| `<head>` | `index.html` (local URLs rewritten), plus `<div id="root" style="display: contents">` so body-level CSS layouts keep working |
| `<style>` / linked CSS | `src/` (same layout), imported from `src/main.jsx`; asset `url()`s become `/…` |
| Classic `<script>` code | `src/legacy-script.js`, run once from `useEffect`. Only what breaks is changed: `DOMContentLoaded`/`window.onload` wrappers run immediately, implicit globals get `let`, functions used by inline handlers are put on `window`. JS edits trigger a full page reload so the code never runs twice. `StrictMode` is left out while this file exists. |
| Images, fonts, other files | `public/` (same layout) |

Every change is explained for participants in the generated `CONVERSION.md`.

Not supported yet: multiple pages (links to other `.html` files), `<script type="module">`.

## Tests

```sh
npm test
```

Fixtures live in `src/converter/__fixtures__/` (`jigsaw` is a real workshop-style site, `portfolio` exercises common patterns). The converted output is stored as file snapshots in `src/converter/__snapshots__/` — read them to see exactly what the converter produces, and run `npx vitest run -u` after an intended change.

## Editor support without Node

After `npm install`, the app copies `@types/react`, `@types/react-dom` and their dependencies (`csstype`) from the container into the local `node_modules`, so VS Code can autocomplete React APIs. It also writes `jsconfig.json` and `.vscode/settings.json` (only if missing). Type checking stays off so the original DOM code in converted sites does not show errors.

## Development

```sh
npm install
npm run dev
```

Open the printed URL in Chrome or Edge.

## Deployment

The page must be cross-origin isolated for WebContainer to boot. Serve every page with:

```
Cross-Origin-Embedder-Policy: credentialless
Cross-Origin-Opener-Policy: same-origin
```

The Vite dev and preview servers already send these (see `vite.config.ts`). Configure the same headers on the hosting provider.

WebContainer API is free for open-source, personal and non-commercial use. Commercial use needs a license from StackBlitz.

## Code map

| File | Purpose |
|---|---|
| `src/lib/devSession.ts` | Mount → install → dev server, plus the local-to-container sync loop |
| `src/lib/localFolder.ts` | Folder scanning, diffing, reading/writing local files, remembering the last folder |
| `src/lib/editorSupport.ts` | VS Code config and type definitions written to the local folder |
| `src/lib/starterProject.ts` | Files for a new starter project |
| `src/lib/webcontainer.ts` | Single WebContainer instance |
| `src/converter/index.ts` | `convertSite()`: splits the page into head/body/CSS/scripts/assets and builds the project |
| `src/converter/jsx.ts` | HTML elements → JSX text |
| `src/converter/handlers.ts` | Inline `onclick="..."` code → arrow functions |
| `src/converter/legacyScript.ts` | Builds `legacy-script.js` from the page's scripts |
| `src/converter/report.ts` | Builds `CONVERSION.md` |
