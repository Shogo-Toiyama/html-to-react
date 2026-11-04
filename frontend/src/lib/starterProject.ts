// A minimal Vite + React (JavaScript) project, based on create-vite's
// `react` template with the lint tooling and binary assets left out.

export function createPackageJson(name: string, extraDependencies: Record<string, string> = {}): string {
  const dependencies = { ...packageJson.dependencies, ...extraDependencies }
  return JSON.stringify({ ...packageJson, name, dependencies }, null, 2) + '\n'
}

const packageJson = {
  name: 'my-react-site',
  private: true,
  version: '0.0.0',
  type: 'module',
  scripts: {
    dev: 'vite',
    build: 'vite build',
    preview: 'vite preview',
  },
  dependencies: {
    react: '^19.2.8',
    'react-dom': '^19.2.8',
  },
  devDependencies: {
    '@types/react': '^19.2.18',
    '@types/react-dom': '^19.2.7',
    '@vitejs/plugin-react': '^6.1.1',
    vite: '^8.3.0',
  },
}

export const VITE_CONFIG = `import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
})
`

export const GITIGNORE = `node_modules
dist
.DS_Store
`

export const STARTER_FILES: Record<string, string> = {
  'package.json': createPackageJson('my-react-site'),

  'vite.config.js': VITE_CONFIG,

  'index.html': `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>My React Site</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
`,

  'src/main.jsx': `import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
`,

  'src/App.jsx': `import { useState } from 'react'

function App() {
  const [count, setCount] = useState(0)

  return (
    <main className="container">
      <h1>Hello, React!</h1>
      <p>
        Edit <code>src/App.jsx</code> in VS Code and save. This page updates by itself.
      </p>
      <button onClick={() => setCount(count + 1)}>Clicked {count} times</button>
    </main>
  )
}

export default App
`,

  'src/index.css': `body {
  margin: 0;
  font-family: system-ui, sans-serif;
  line-height: 1.5;
}

.container {
  max-width: 640px;
  margin: 64px auto;
  padding: 0 16px;
}

button {
  font: inherit;
  padding: 8px 16px;
  cursor: pointer;
}
`,

  '.gitignore': GITIGNORE,
}
