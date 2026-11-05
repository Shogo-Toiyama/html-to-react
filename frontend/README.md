# React Launchpad (frontend)

A browser app that runs a workshop participant's local React project without installing Node.js.

- The participant picks a folder on their computer (File System Access API, **Chrome/Edge only**).
- The project runs in a [WebContainer](https://webcontainers.io/) (Node.js in the browser): `npm install` → `npm run dev`, with the preview shown in an iframe.
- Participants keep editing in VS Code. The app polls the folder every second and copies changes into the container, so Vite's HMR updates the preview.
- An empty folder can be turned into a starter Vite + React (JavaScript) project.
- A plain HTML/CSS/JS site can be converted into a React project in a new folder (the original is never changed).
- A side panel walks through the workshop steps (Workshop 4: JSX → Components → Props → Tailwind CSS). Steps are never locked; **Next** marks a step done. The position is saved in the project's `.launchpad/progress.json` (and localStorage), so a participant can resume on another computer or in the next workshop by reopening the project.
- **Use the sample site** saves the bundled sample (`src/samples/acm-design`) into a folder the participant picks, next to its converted `- React` version.
- The preview's address bar shows `📁 <folder> /path` instead of the real WebContainer URL. A bridge script in the preview reports the current path and lets the toolbar navigate (back, forward, reload keeps the page, type a path). It is injected by a Vite config that wraps the project's own config, written only inside the container (`.launchpad-runtime/`).

## HTML → React converter

`src/converter/` turns a plain HTML/CSS/JS site into a Vite + React project that looks and works the same. Everything is deterministic (no LLM yet). Every HTML page in the folder (including subfolders) is converted.

### One page

| Original | React project |
|---|---|
| `<body>` | `src/App.jsx` as JSX (`class` → `className`, `style` → object, `onclick="..."` → `onClick={...}`, form fields → `defaultValue`/`defaultChecked`, whitespace kept with `{' '}`) |
| `<head>` | `index.html` (local URLs rewritten), plus `<div id="root" style="display: contents">` so body-level CSS layouts keep working |
| `<style>` / linked CSS | `src/` (same layout), imported from `src/main.jsx`; asset `url()`s become `/…` |
| Classic `<script>` code | `src/legacy-script.js`, run once from `useEffect`. Only what breaks is changed: `DOMContentLoaded`/`window.onload` wrappers run immediately, implicit globals get `let`, functions used by inline handlers are put on `window`. JS edits trigger a full page reload so the code never runs twice. `StrictMode` is left out while this file exists. |
| Images, fonts, other files | `public/` (same layout) |

### Several pages (React Router)

Each page becomes a component, and `src/App.jsx` maps URLs to them with React Router (`react-router` is added to `package.json`).

| Original | React project |
|---|---|
| `index.html`, `about.html`, `blog/post.html` | `src/pages/HomePage.jsx` at `/`, `AboutPage.jsx` at `/about`, `BlogPostPage.jsx` at `/blog/post` |
| `<a href="about.html#team">` | `<Link to="/about#team">`. `src/ScrollToTop.jsx` scrolls to the top (or the `#id`) on each navigation. Old `*.html` URLs are redirected in `src/main.jsx`. |
| `<head>` of every page | One `index.html`. Tags that differ: `<title>` and page-describing `<meta>` go into the page's JSX (React 19 hoists them); anything else is added to `index.html` with a "Please check" note. |
| `<body>` attributes | Shared ones stay on `<body>`; page-only ones are set and removed by the page component in `useEffect`. |
| CSS | Files linked by every page are imported in `src/main.jsx`; the rest (and inline `<style>`) in the page component. All CSS is global in a single-page app, so page-only CSS gets a "Please check" note. |
| Scripts | Per page: `src/pages/<Page>.legacy-script.js`, run when the page mounts. `src/legacy-page.js` tracks `window`/`document` listeners and timers so they stop when the page unmounts. |

Every change is explained for participants in the generated `CONVERSION.md`.

Not supported yet: `<script type="module">`.

## AI backend (Cloudflare Pages Functions)

`functions/api/suggest.ts` (logic in `server/`) asks Claude Sonnet 5.5 to split a page into components (Step 2) or to merge repeated parts into one component with props (Step 3). The answer is structured JSON (files + a change log), checked in `server/validate.ts` (JSX parses; no `id`, `className` or `window.*` call lost; imports exist) and sent back to Claude once if it fails. Progress streams to the browser as NDJSON. In the side panel, **Apply** writes the files (old versions backed up to `.launchpad/backups/`), **Undo** restores them, and every change is logged in `.launchpad/history.json` (and localStorage). The preview's **🧩 Components** toggle outlines the component under the mouse with its props (no AI).

Cloudflare Pages → Settings → Variables and Secrets:

| Name | |
|---|---|
| `ANTHROPIC_API_KEY` | Secret |
| `WORKSHOP_CODE` | Code participants type once (e.g. `buildwithai`) |
| `RATE_LIMIT_KV` | Optional KV binding: 20 requests / 10 min per device (the room shares one IP, so limits use a random id stored in the browser) |

Step 4 (Tailwind): converted and starter projects already list `tailwindcss` + `@tailwindcss/vite` in `package.json` (no install wait in the workshop). **Set up Tailwind** (`src/lib/tailwindSetup.ts`, no AI) adds the plugin to `vite.config.js` and loads Tailwind's theme and utilities, without the preflight reset, so the page looks the same until classes are used (missing packages are added if needed). The AI then converts one component or the whole site (`tailwind` step; classes the legacy script uses must stay), and after the whole site it offers to delete unused CSS (`tailwind-cleanup`). Two WebContainer workarounds in `devSession.ts`: Vite is restarted when `vite.config.*` changes (it runs with the wrapper config), and the CSS files that load Tailwind are rewritten after every JSX/JS/HTML change, because Tailwind otherwise misses classes added while the server runs.

Requests over `MAX_REQUEST_CHARS` (150 KB of code, `src/lib/aiApi.ts`) are not sent: the panel shows a warning with the largest files instead of trimming anything.

Local: copy `.dev.vars.example` to `.dev.vars`, then `npm run dev:pages` (builds and serves `dist` with the functions). Plain `npm run dev` has no `/api`.

## Tests

```sh
npm test
```

Fixtures live in `src/converter/__fixtures__/` (`acm-design` and `jigsaw` are real workshop-style sites, `portfolio` exercises common patterns and is also converted without `about.html` to cover single-page sites). The converted output is stored as file snapshots in `src/converter/__snapshots__/` — read them to see exactly what the converter produces, and run `npx vitest run -u` after an intended change.

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
| `src/curriculum/workshops.ts` | Workshops and steps as data (add a workshop here) |
| `src/curriculum/StepContent.tsx` | Instructions shown for each step |
| `src/components/GuidePanel.tsx` | Side panel: workshop, step list, instructions, Back / Next |
| `src/components/PreviewPane.tsx` | Address bar and preview iframe |
| `src/components/TerminalDrawer.tsx` | Foldable terminal (opens by itself on errors) |
| `src/components/Welcome.tsx` | Screens before a project runs (open folder, convert, sample site) |
| `src/lib/previewBridge.ts` | Script injected into the preview + the wrapping Vite config |
| `src/lib/progress.ts` | Reads/writes `.launchpad/progress.json` |
| `src/lib/sampleSite.ts` | The bundled sample website |
| `src/lib/devSession.ts` | Mount → install → dev server, plus the local-to-container sync loop |
| `src/lib/localFolder.ts` | Folder scanning, diffing, reading/writing local files, remembering the last folder |
| `src/lib/editorSupport.ts` | VS Code config and type definitions written to the local folder |
| `src/lib/starterProject.ts` | Files for a new starter project |
| `src/lib/webcontainer.ts` | Single WebContainer instance |
| `src/converter/index.ts` | `convertSite()`: converts every page and builds the project (single page or React Router) |
| `src/converter/page.ts` | `convertPage()`: splits one page into head/body/CSS/scripts and rewrites its URLs |
| `src/converter/pages.ts` | Finds the site's pages and names their routes and components |
| `src/converter/templates.ts` | Text of generated files (`App.jsx`, page components, `main.jsx`, `index.html`, helpers) |
| `src/converter/jsx.ts` | HTML elements → JSX text (links between pages → `<Link>`) |
| `src/converter/handlers.ts` | Inline `onclick="..."` code → arrow functions |
| `src/converter/legacyScript.ts` | Builds a page's legacy script from its `<script>` code |
| `src/converter/report.ts` | Builds `CONVERSION.md` |
