# React Launchpad (frontend)

A browser app that runs a workshop participant's local React project without installing Node.js.

- The participant picks a folder on their computer (File System Access API, **Chrome/Edge only**).
- The project runs in a [WebContainer](https://webcontainers.io/) (Node.js in the browser): `npm install` → `npm run dev`, with the preview shown in an iframe.
- Participants keep editing in VS Code. The app polls the folder every second and copies changes into the container, so Vite's HMR updates the preview.
- An empty folder can be turned into a starter Vite + React (JavaScript) project.

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
