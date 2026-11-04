# How your site was converted to React

This project was made from your 2 pages (`index.html`, `about.html`). It should look and work the same as your original site. Your original folder was not changed.

## Your pages

Each page is now a component. React Router (in `src/App.jsx`) shows the component whose path matches the URL.

| Page | URL | Component |
|---|---|---|
| `index.html` | `/` | `src/pages/HomePage.jsx` |
| `about.html` | `/about` | `src/pages/AboutPage.jsx` |

## Where things went

| Before | Now |
|---|---|
| `index.html` → `<body>` | `src/pages/HomePage.jsx` (as JSX) |
| `script.js` | `src/pages/HomePage.legacy-script.js` |
| `about.html` → `<body>` | `src/pages/AboutPage.jsx` (as JSX) |
| The `<head>` of every page | `index.html` (one for the whole site) |
| `style.css` | `src/style.css` |

## What changed, and why

### `class` became `className` (21×)

JSX is JavaScript, where `class` is a reserved word, so React uses `className` for CSS classes.

### Links between your pages became `<Link to="...">` (2×)

A normal `<a href="about.html">` loads a whole new HTML file. React Router's `<Link to="/about">` switches to the other page component right away, without reloading, and the URL still changes.

- `index.html: about.html → /about`
- `about.html: index.html → /`

### Inline event handlers became functions (6×)

HTML runs a string of code: `onclick="toggleMenu()"`. React needs a function: `onClick={() => window.toggleMenu()}`. Functions from your script are reached through `window` for now, because your script now lives in its own file.

- `index.html: <button onclick="openPopup('project-details-1')">`
- `index.html: <button onclick="openPopup('project-details-2')">`
- `index.html: <button onclick="openPopup('project-details-3')">`
- `index.html: <button onclick="closePopup('project-details-1')">`
- `index.html: <button onclick="closePopup('project-details-2')">`

### Your pages became components, and React Router switches between them

Each HTML page is now a component in `src/pages/`. `src/App.jsx` lists which URL shows which component. When you click a link, React swaps the component instead of loading a new HTML file, and the URL in the address bar still changes.

## Please check

- **A CSS file isn’t used by any page.** It was copied to `src/`, but none of your HTML pages linked it. To use it, add `import '../about.css'` at the top of the page component that needs it (in `src/pages/`).
  - `src/about.css`

## What’s next

Your JavaScript is in the `*.legacy-script.js` file next to each page component and still changes the page directly (`document.querySelector`, `classList`, `innerHTML`, ...). React doesn’t know about those changes, which is fine for now. As you learn React, you’ll move this code into components using state and event handlers, one piece at a time. When a legacy script is empty, delete it and its import in the page component.

Parts that appear on several pages, like a header or footer, make great components: write one `Header` component and use `<Header />` on every page.

**Publishing your site:** every URL (like `/about`) must be answered with `index.html`, so React Router can show the right page. Most hosts call this a “single-page app” or “rewrite all routes to index.html” setting. Without it, opening `/about` directly shows a “404 Not Found” page.
