import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// <StrictMode> is left out on purpose. In development it runs effects twice,
// so the code in legacy-script.js would also run twice (for example, adding
// every click listener two times). Add it back once that code is gone.
createRoot(document.getElementById('root')).render(<App />)
