// Your original JavaScript, moved here from: script.js
//
// It still changes the page directly (document.querySelector, classList,
// innerHTML, ...). That works, but React doesn't know about those changes.
// As you learn React, move this code into your components piece by piece.
// When this file is empty, delete it along with its import in HomePage.jsx.

import { trackPage } from '../legacy-page.js'

export function runLegacyScript() {
  // Converter: when you open another page, React removes this one, but
  // listeners on window/document and timers would keep running. These
  // versions remember them so they stop when you leave the page.
  const legacyPage = trackPage()
  const { setTimeout, setInterval, requestAnimationFrame } = legacyPage

  // Converter: onclick="..." attributes in HomePage.jsx call these through `window`.
  Object.assign(window, { openPopup, closePopup })

  function openPopup(id) {
      const popup = document.getElementById(id);
      popup.style.display = "block";
  }

  function closePopup(id) {
      const popup = document.getElementById(id);
      popup.style.display = "none";
  }

  return legacyPage.stop
}

// Code that changes the page directly can't be swapped in while the page is
// running, so the whole page reloads whenever a JavaScript file changes.
// (CSS changes still update instantly.) Remove this along with the file.
if (import.meta.hot) {
  import.meta.hot.on('vite:beforeUpdate', (payload) => {
    if (payload.updates.some((update) => update.type === 'js-update')) location.reload()
  })
}
