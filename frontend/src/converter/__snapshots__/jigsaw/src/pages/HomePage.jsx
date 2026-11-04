import { useEffect } from 'react'
import { runLegacyScript } from './HomePage.legacy-script.js'
import './HomePage.css'

// Converted from index.html. The JSX below is that page's <body>.
function HomePage() {
  // Runs your original JavaScript when this page opens. What it returns stops
  // its timers and listeners when you go to another page.
  useEffect(() => {
    return runLegacyScript()
  }, [])

  return (
    <>
      <div className="title">
        <h1>Let's play puzzle!</h1>
        <p id="status">Can you solve this puzzle? 🤔</p>
      </div>
      <div className="square"></div>
      <div className="rectangle"></div>
      <img id="a1" className="draggable" data-row="0" data-col="0" src="/pieces/A1.png" alt="A1" />{' '}
      <img id="a2" className="draggable" data-row="0" data-col="1" src="/pieces/A2.png" alt="A2" />{' '}
      <img id="b1" className="draggable" data-row="1" data-col="0" src="/pieces/B1.png" alt="B1" />{' '}
      <img id="b2" className="draggable" data-row="1" data-col="1" src="/pieces/B2.png" alt="B2" />{' '}
      <img
        id="completed-picture"
        className="fade"
        src="/completed_picture.png"
        alt="completed picture"
      />
    </>
  )
}

export default HomePage
