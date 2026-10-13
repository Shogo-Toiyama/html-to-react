# How your site was converted to React

This project was made from `index.html`. It should look and work the same as your original site. Your original folder was not changed.

## Where things went

| Before | Now |
|---|---|
| `index.html` → `<body>` | `src/App.jsx` (as JSX) |
| `index.html` → `<head>` | `index.html` |
| `index.html (inline <script>)` | `src/legacy-script.js` |
| `<style>` in `index.html` | `src/index.css` |
| Images and other files (5) | `public/` (same folder layout) |

## What changed, and why

### `class` became `className` (8×)

JSX is JavaScript, where `class` is a reserved word, so React uses `className` for CSS classes.

### Image and file paths now start with `/` (5×)

Images and other files moved to the `public/` folder, which Vite serves from the root of the site. So `./img/me.png` became `/img/me.png` (the file is at `public/img/me.png`).

- `./pieces/A1.png`
- `./pieces/A2.png`
- `./pieces/B1.png`
- `./pieces/B2.png`
- `./completed_picture.png`

## Please check

- **Some files were not copied.** Other HTML pages and files that aren’t part of the website (like notes or config files) were left in your original folder.
  - `index2.html, render.yaml`

## What’s next

Your JavaScript is in `src/legacy-script.js` and still changes the page directly (`document.querySelector`, `classList`, `innerHTML`, ...). React doesn’t know about those changes, which is fine for now. As you learn React, you’ll move this code into components using state and event handlers, one piece at a time. When `legacy-script.js` is empty, delete it and its import in `App.jsx`.

Try splitting `src/App.jsx` into smaller components, for example a `Header` and a `Footer`.
