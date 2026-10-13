# How your site was converted to React

This project was made from `index.html`. It should look and work the same as your original site. Your original folder was not changed.

## Where things went

| Before | Now |
|---|---|
| `index.html` → `<body>` | `src/App.jsx` (as JSX) |
| `index.html` → `<head>` | `index.html` |
| `js/script.js` | `src/legacy-script.js` |
| `css/style.css` | `src/css/style.css` |
| Images and other files (3) | `public/` (same folder layout) |

## What changed, and why

### `class` became `className` (5×)

JSX is JavaScript, where `class` is a reserved word, so React uses `className` for CSS classes.

### Inline event handlers became functions (4×)

HTML runs a string of code: `onclick="toggleMenu()"`. React needs a function: `onClick={() => window.toggleMenu()}`. Functions from your script are reached through `window` for now, because your script now lives in its own file.

- `index.html: <button onclick="toggleMenu()">`
- `index.html: <button onclick="celebrate()">`
- `index.html: <form onsubmit="return handleSubmit(event)">`
- `index.html: <a onclick="scrollToTop()">`

### Some attributes use camelCase (2×)

React spells multi-word attributes in camelCase, e.g. `tabindex` → `tabIndex`, `maxlength` → `maxLength`.

- `tabindex → tabIndex`
- `maxlength → maxLength`

### Image and file paths now start with `/` (3×)

Images and other files moved to the `public/` folder, which Vite serves from the root of the site. So `./img/me.png` became `/img/me.png` (the file is at `public/img/me.png`).

- `images/bg.png`
- `images/profile.png`
- `favicon.png`

### `style="..."` became a style object

In JSX, inline styles are a JavaScript object: `style="font-size: 20px"` becomes `style={{ fontSize: '20px' }}`. Property names use camelCase.

### SVG attributes use camelCase

In JSX, SVG attributes like `stroke-width` are written as `strokeWidth`.

### `for` became `htmlFor`

`for` is a reserved word in JavaScript, so React uses `htmlFor` on `<label>`.

### Form fields use `defaultValue` / `defaultChecked` (2×)

In React, `value` and `checked` lock a form field to that value unless React code updates it. `defaultValue` and `defaultChecked` set the starting value and let the user type, like plain HTML.

- `index.html: <input value>`
- `index.html: <input checked>`

### `selected` moved to `defaultValue` on `<select>`

React picks the starting option of a `<select>` with `defaultValue` instead of `selected` on an `<option>`.

- `index.html: <select>`

### `href="javascript:..."` links became `onClick`

React blocks `javascript:` URLs for security. The link now points to `#`, and the code runs in `onClick` (with `event.preventDefault()` so the page doesn't jump).

- `index.html: <a href="javascript:void(0)">`

### "Wait for the page to load" code now runs right away

Code inside `DOMContentLoaded` or `window.onload` used to wait until the page was ready. In React, your code starts after the page is already on screen, so the event would never fire. The function is now called directly.

- `js/script.js`

### Added `let` for variables that were never declared

Plain `<script>` code allows `x = 5` without declaring `x` first. React code runs in strict mode, where that is an error. The converter added a `let` line at the top of `legacy-script.js`.

- `wordIndex, charIndex`

### CSS `url(...)` paths now start with `/`

Images and fonts moved to the `public/` folder, which Vite serves from the root of the site. A path like `/img/bg.png` means `public/img/bg.png`.

- `css/style.css: url(../images/bg.png)`

## Please check

- **Links to other pages won’t work yet.** This version converts one page (index.html). Links to other HTML pages will show the converted page instead. Support for multiple pages is coming.
  - `about.html`
- **Some files were not copied.** Other HTML pages and files that aren’t part of the website (like notes or config files) were left in your original folder.
  - `README.md, about.html`

## What’s next

Your JavaScript is in `src/legacy-script.js` and still changes the page directly (`document.querySelector`, `classList`, `innerHTML`, ...). React doesn’t know about those changes, which is fine for now. As you learn React, you’ll move this code into components using state and event handlers, one piece at a time. When `legacy-script.js` is empty, delete it and its import in `App.jsx`.

Try splitting `src/App.jsx` into smaller components, for example a `Header` and a `Footer`.
