import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { PreviewOnly } from './components/PreviewOnly.tsx'

const previewUrl = new URLSearchParams(location.search).get('preview')

createRoot(document.getElementById('root')!).render(
  <StrictMode>{previewUrl ? <PreviewOnly url={previewUrl} /> : <App />}</StrictMode>,
)
