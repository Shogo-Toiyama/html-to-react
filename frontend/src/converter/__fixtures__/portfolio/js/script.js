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

document.addEventListener('DOMContentLoaded', function () {
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
});
