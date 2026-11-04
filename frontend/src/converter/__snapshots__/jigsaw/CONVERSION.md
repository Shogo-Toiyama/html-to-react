# How your site was converted to React

This project was made from your 2 pages (`index.html`, `index2.html`). It should look and work the same as your original site. Your original folder was not changed.

## Your pages

Each page is now a component. React Router (in `src/App.jsx`) shows the component whose path matches the URL.

| Page | URL | Component |
|---|---|---|
| `index.html` | `/` | `src/pages/HomePage.jsx` |
| `index2.html` | `/index2` | `src/pages/Index2Page.jsx` |

## Where things went

| Before | Now |
|---|---|
| `<style>` in `index.html` | `src/pages/HomePage.css` |
| `index.html` → `<body>` | `src/pages/HomePage.jsx` (as JSX) |
| `index.html (inline <script>)` | `src/pages/HomePage.legacy-script.js` |
| `<style>` in `index2.html` | `src/pages/Index2Page.css` |
| `index2.html` → `<body>` | `src/pages/Index2Page.jsx` (as JSX) |
| `index2.html (inline <script>)` | `src/pages/Index2Page.legacy-script.js` |
| The `<head>` of every page | `index.html` (one for the whole site) |
| Images and other files (5) | `public/` (same folder layout) |

## What changed, and why

### `class` became `className` (16×)

JSX is JavaScript, where `class` is a reserved word, so React uses `className` for CSS classes.

### Image and file paths now start with `/` (10×)

Images and other files moved to the `public/` folder, which Vite serves from the root of the site. So `./img/me.png` became `/img/me.png` (the file is at `public/img/me.png`).

- `index.html: ./pieces/A1.png`
- `index.html: ./pieces/A2.png`
- `index.html: ./pieces/B1.png`
- `index.html: ./pieces/B2.png`
- `index.html: ./completed_picture.png`

### Your pages became components, and React Router switches between them

Each HTML page is now a component in `src/pages/`. `src/App.jsx` lists which URL shows which component. When you click a link, React swaps the component instead of loading a new HTML file, and the URL in the address bar still changes.

## Please check

- **CSS from one page now also applies to the other pages.** React shows all your pages inside one HTML document, and the CSS of every page is loaded at the start. CSS that used to be on only some pages now affects all of them. If a page looks different than before, make those selectors more specific (for example `.about-title` instead of `h1`). Moving your styles into Tailwind classes later also fixes this.
  - `<style> in index.html, <style> in index2.html`
- **Some files were not copied.** Files that aren’t part of the website (like notes or config files) were left in your original folder.
  - `render.yaml`

## What’s next

Your JavaScript is in the `*.legacy-script.js` file next to each page component and still changes the page directly (`document.querySelector`, `classList`, `innerHTML`, ...). React doesn’t know about those changes, which is fine for now. As you learn React, you’ll move this code into components using state and event handlers, one piece at a time. When a legacy script is empty, delete it and its import in the page component.

Parts that appear on several pages, like a header or footer, make great components: write one `Header` component and use `<Header />` on every page.

**Publishing your site:** every URL (like `/about`) must be answered with `index.html`, so React Router can show the right page. Most hosts call this a “single-page app” or “rewrite all routes to index.html” setting. Without it, opening `/about` directly shows a “404 Not Found” page.
