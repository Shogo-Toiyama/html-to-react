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

export default App
