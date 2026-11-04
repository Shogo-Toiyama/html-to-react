import { useEffect } from 'react'
import { Link } from 'react-router'
import { runLegacyScript } from './HomePage.legacy-script.js'

// Converted from index.html. The JSX below is that page's <body>.
function HomePage() {
  // Runs your original JavaScript when this page opens. What it returns stops
  // its timers and listeners when you go to another page.
  useEffect(() => {
    return runLegacyScript()
  }, [])

  return (
    <>
      <section className="intro-section">
        {/* TITLE */}
        <div>
          <h2 className="subtitle">Hello I'm</h2>
          <h1 className="name">Timmy</h1>
        </div>
        {/* SHORT ABOUT */}
        <div className="short-about">
          <p>
            Los Angeles, CA
            <br />
            timmy@gmail.com
            <br />
            I am a robot beep boop beep boop.
          </p>
          <Link to="/about">More about me &gt;&gt;</Link>
        </div>
      </section>
      <div className="line"></div>
      <section className="projects-section">
        <h1 className="section-header">Projects</h1>
        {/* PROJECT CARDS */}
        <div id="project-section" className="projects-container">
          <article className="project-card">
            <h2 className="project-card-header">AI Modeling</h2>
            <p>yadadadadada</p>
            <button
              className="project-details-button"
              onClick={() => window.openPopup('project-details-1')}
            >
              More Details
            </button>
          </article>
          <article className="project-card">
            <h2 className="project-card-header">Research Lab</h2>
            <p>larp larp larp</p>
            <button
              className="project-details-button"
              onClick={() => window.openPopup('project-details-2')}
            >
              More Details
            </button>
          </article>
          <article className="project-card">
            <h2 className="project-card-header">Client Web Project</h2>
            <p>who cares lowkey</p>
            <button
              className="project-details-button"
              onClick={() => window.openPopup('project-details-3')}
            >
              More Details
            </button>
          </article>
        </div>
      </section>
      <section className="footer"><p>Copyright 2026 Timmy</p></section>
      {/* PROJECT POPUPS */}
      <section id="project-details-1" className="project-popup">
        <p>AI models do the model</p>
        <button onClick={() => window.closePopup('project-details-1')}>Close</button>
      </section>
      <section id="project-details-2" className="project-popup">
        <p>woahhhhhh research cutting edge and stuff</p>
        <button onClick={() => window.closePopup('project-details-2')}>Close</button>
      </section>
      <section id="project-details-3" className="project-popup">
        <p>client ask for website, i make website, client happy, client give money, i happy</p>
        <button onClick={() => window.closePopup('project-details-3')}>Close</button>
      </section>
    </>
  )
}

export default HomePage
