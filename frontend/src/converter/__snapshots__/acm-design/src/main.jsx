import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import './style.css'
import App from './App.jsx'

// Old links like "about.html" (for example in your JavaScript) open the new
// URL ("/about") instead.
if (/\.html?$/.test(location.pathname)) {
  const path = location.pathname.replace(/\.html?$/, '').replace(/\/index$/, '') || '/'
  history.replaceState(null, '', path + location.search + location.hash)
}

// <StrictMode> is left out on purpose. In development it runs effects twice,
// so the code in your legacy script would also run twice (for example, adding
// every click listener two times). Add it back once that code is gone.
createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>,
)
