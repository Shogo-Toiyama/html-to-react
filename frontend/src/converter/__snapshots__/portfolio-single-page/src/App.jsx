import { useEffect } from 'react'
import { runLegacyScript } from './legacy-script.js'

// Converted from index.html. The JSX below is your page's <body>.
function App() {
  // Runs your original JavaScript once, after React has put the page on screen.
  useEffect(() => {
    runLegacyScript()
  }, [])

  return (
    <>
      {/* Navigation */}
      <header className="site-header">
        <a href="#" className="logo">Alex<span>.</span></a>
        <nav id="nav-links">
          <a href="#about">About</a>{' '}
          <a href="#projects">Projects</a>{' '}
          <a href="#contact">Contact</a>{' '}
          <a href="about.html">More about me</a>
        </nav>
        <button className="menu-button" aria-label="Open menu" onClick={() => window.toggleMenu()}>
          ☰
        </button>{' '}
        <button id="theme-toggle" tabIndex="0">🌙 Dark mode</button>
      </header>
      <section
        id="hero"
        style={{ backgroundImage: "url('/images/bg.png')", '--accent': '#fe8d3c', paddingTop: '40px' }}
      >
        <img src="/images/profile.png" alt="Photo of Alex" className="profile" width="120" />
        <h1>Hi, I'm <span id="typed"></span></h1>
        <p>
          I build <strong>websites</strong> &amp; <em>small games</em>. My favorite symbol is
          &#123;curly braces&#125;.
        </p>
        <button onClick={() => window.celebrate()}>Click me!</button>
      </section>
      <section id="about">
        <h2>About me</h2>
        <p>
          I'm a second-year student who loves design.
          <br />
          Based in Los Angeles.
        </p>
        <svg width="24" height="24" viewBox="0 0 24 24" className="icon">
          <circle cx="12" cy="12" r="10" stroke="#fe8d3c" strokeWidth="2" fill="none" />
        </svg>
      </section>
      <hr />
      <section id="projects">
        <h2>Projects</h2>
        <ul id="project-list"></ul>
        <p id="project-count"></p>
      </section>
      <section id="contact">
        <h2>Contact</h2>
        <form
          id="contact-form"
          onSubmit={(event) => { if (window.handleSubmit(event) === false) event.preventDefault() }}
        >
          <label htmlFor="name">Name</label>{' '}
          <input
            type="text"
            id="name"
            name="name"
            defaultValue="Your name"
            maxLength="40"
            required
          />{' '}
          <label><input type="checkbox" id="subscribe" defaultChecked /> Subscribe</label>
          <select id="topic" defaultValue="work">
            <option value="hello">Say hello</option>
            <option value="work">Work together</option>
          </select>
          <textarea id="message" rows="4" defaultValue="Hi Alex," />{' '}
          <button type="submit">Send</button>
        </form>
        <p id="form-result"></p>
      </section>
      <footer>
        <p>
          © 2026 Alex Kim ·{' '}
          <a
            href="#"
            onClick={(event) => {
              event.preventDefault()
              window.scrollToTop()
            }}
          >
            Back to top
          </a>
        </p>
      </footer>
    </>
  )
}

export default App
