import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// WebContainer needs a cross-origin isolated page (SharedArrayBuffer).
// `credentialless` (instead of `require-corp`) lets participants' sites load
// third-party images and fonts in the preview without CORP headers.
const crossOriginIsolation = {
  'Cross-Origin-Embedder-Policy': 'credentialless',
  'Cross-Origin-Opener-Policy': 'same-origin',
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: { headers: crossOriginIsolation },
  preview: { headers: crossOriginIsolation },
})
