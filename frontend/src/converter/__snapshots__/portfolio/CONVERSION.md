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
| `css/style.css` | `src/css/style.css` |
| `index.html` → `<body>` | `src/pages/HomePage.jsx` (as JSX) |
| `js/script.js` | `src/pages/HomePage.legacy-script.js` |
| `about.html` → `<body>` | `src/pages/AboutPage.jsx` (as JSX) |
| The `<head>` of every page | `index.html` (one for the whole site) |
| Images and other files (3) | `public/` (same folder layout) |

## What changed, and why

### CSS `url(...)` paths now start with `/`

Images and fonts moved to the `public/` folder, which Vite serves from the root of the site. A path like `/img/bg.png` means `public/img/bg.png`.

- `css/style.css: url(../images/bg.png)`

### `class` became `className` (5×)

JSX is JavaScript, where `class` is a reserved word, so React uses `className` for CSS classes.

### Links between your pages became `<Link to="...">` (2×)

A normal `<a href="about.html">` loads a whole new HTML file. React Router's `<Link to="/about">` switches to the other page component right away, without reloading, and the URL still changes.

- `index.html: about.html → /about`
- `about.html: index.html → /`

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

- `index.html: images/bg.png`
- `index.html: images/profile.png`
- `index.html: favicon.png`

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

### Each page's `<title>` moved into its component

All pages now share one `index.html`. A `<title>` (or `<meta>`) written in a component's JSX is moved into `<head>` by React while that page is on screen, so each page keeps its own title.

### `<body>` attributes moved into the page component

All pages now share one `<body>`. Attributes that only some pages had (like `class="dark"`) are added by that page's component when it opens and removed when you leave.

- `index.html: class="light"`

### "Wait for the page to load" code now runs right away

Code inside `DOMContentLoaded` or `window.onload` used to wait until the page was ready. In React, your code starts after the page is already on screen, so the event would never fire. The function is now called directly.

- `js/script.js`

### Added `let` for variables that were never declared

Plain `<script>` code allows `x = 5` without declaring `x` first. React code runs in strict mode, where that is an error. The converter added a `let` line at the top of `runLegacyScript()`.

- `wordIndex, charIndex`

### Your pages became components, and React Router switches between them

Each HTML page is now a component in `src/pages/`. `src/App.jsx` lists which URL shows which component. When you click a link, React swaps the component instead of loading a new HTML file, and the URL in the address bar still changes.

## Please check

- **Some `<head>` tags now load on every page.** All pages now share one `index.html`. These tags were only on some of your pages, so check that they don't change how the other pages look or work.
  - `index.html: <meta>, index.html: <meta name="viewport">, index.html: <link rel="icon">, index.html: <link rel="preconnect">, index.html: <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600&display=swap">, index.html: <script src="https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.3/dist/confetti.browser.min.js">`
- **CSS from one page now also applies to the other pages.** React shows all your pages inside one HTML document, and the CSS of every page is loaded at the start. CSS that used to be on only some pages now affects all of them. If a page looks different than before, make those selectors more specific (for example `.about-title` instead of `h1`). Moving your styles into Tailwind classes later also fixes this.
  - `css/style.css (index.html)`
- **Some files were not copied.** Files that aren’t part of the website (like notes or config files) were left in your original folder.
  - `README.md`

## What’s next

Your JavaScript is in the `*.legacy-script.js` file next to each page component and still changes the page directly (`document.querySelector`, `classList`, `innerHTML`, ...). React doesn’t know about those changes, which is fine for now. As you learn React, you’ll move this code into components using state and event handlers, one piece at a time. When a legacy script is empty, delete it and its import in the page component.

Parts that appear on several pages, like a header or footer, make great components: write one `Header` component and use `<Header />` on every page.

**Publishing your site:** every URL (like `/about`) must be answered with `index.html`, so React Router can show the right page. Most hosts call this a “single-page app” or “rewrite all routes to index.html” setting. Without it, opening `/about` directly shows a “404 Not Found” page.
