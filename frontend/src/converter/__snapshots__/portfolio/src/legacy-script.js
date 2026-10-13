// Your original JavaScript, moved here from: js/script.js
//
// It still changes the page directly (document.querySelector, classList,
// innerHTML, ...). That works, but React doesn't know about those changes.
// As you learn React, move this code into your components piece by piece.
// When this file is empty, delete it along with its import in App.jsx.

export function runLegacyScript() {
  // Converter: these variables were used without `let`. That works in a plain
  // <script>, but React code runs in "strict mode", which requires declaring them.
  let wordIndex, charIndex

  // Converter: onclick="..." attributes in App.jsx call these through `window`.
  Object.assign(window, { toggleMenu, celebrate, handleSubmit, scrollToTop })

  // Projects shown in the list
  const projects = [
    { title: 'Jigsaw Puzzle', year: 2025 },
    { title: 'Weather App', year: 2026 },
    { title: 'This Website', year: 2026 },
  ];

  function toggleMenu() {
    document.getElementById('nav-links').classList.toggle('open');
  }

  function celebrate() {
    confetti();
  }

  function scrollToTop() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function handleSubmit(event) {
    const name = document.getElementById('name').value;
    const result = document.getElementById('form-result');
    result.textContent = `Thanks, ${name}!
We'll reply soon.`;
    result.classList.add('success');
    return false;
  }

  // Typing effect
  const words = ['Alex.', 'a designer.', 'a developer.'];
  wordIndex = 0;
  charIndex = 0;

  function type() {
    const typed = document.getElementById('typed');
    typed.textContent = words[wordIndex].slice(0, charIndex);
    charIndex++;
    if (charIndex > words[wordIndex].length) {
      charIndex = 0;
      wordIndex = (wordIndex + 1) % words.length;
    }
  }

  // Converter: this used to wait for the page to load. In React it runs after
  // the page is already on screen, so it is called right away instead.
  (function () {
    const list = document.getElementById('project-list');
    for (let i = 0; i < projects.length; i++) {
      list.innerHTML += '<li>' + projects[i].title + ' (' + projects[i].year + ')</li>';
    }
    document.getElementById('project-count').textContent = projects.length + ' projects';

    const themeButton = document.getElementById('theme-toggle');
    themeButton.addEventListener('click', () => {
      document.body.classList.toggle('dark');
      themeButton.textContent = document.body.classList.contains('dark') ? '☀️ Light mode' : '🌙 Dark mode';
    });

    setInterval(type, 150);
  })()
}

// Code that changes the page directly can't be swapped in while the page is
// running, so the whole page reloads whenever a JavaScript file changes.
// (CSS changes still update instantly.) Remove this along with the file.
if (import.meta.hot) {
  import.meta.hot.on('vite:beforeUpdate', (payload) => {
    if (payload.updates.some((update) => update.type === 'js-update')) location.reload()
  })
}
