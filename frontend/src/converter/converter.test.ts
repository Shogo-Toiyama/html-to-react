import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { convertInlineHandler } from './handlers'
import { convertSite, findHtmlPages } from './index'
import { buildLegacyScript } from './legacyScript'
import { NoteCollector } from './notes'
import { describePages, findSitePages } from './pages'
import { resolveUrl } from './paths'

const FIXTURES = join(import.meta.dirname, '__fixtures__')

function loadFixture(name: string): Map<string, Uint8Array> {
  const root = join(FIXTURES, name)
  const files = new Map<string, Uint8Array>()
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry)
      if (statSync(path).isDirectory()) walk(path)
      else files.set(relative(root, path).split('\\').join('/'), new Uint8Array(readFileSync(path)))
    }
  }
  walk(root)
  return files
}

function text(value: string | Uint8Array | undefined): string {
  if (value === undefined) throw new Error('missing file')
  return typeof value === 'string' ? value : new TextDecoder().decode(value)
}

/** The fixture without some files, e.g. to turn a multi-page site into a single page. */
function withoutFiles(name: string, ...paths: string[]): Map<string, Uint8Array> {
  const files = loadFixture(name)
  for (const path of paths) files.delete(path)
  return files
}

const SNAPSHOT_CASES: [name: string, files: () => Map<string, Uint8Array>][] = [
  ['acm-design', () => loadFixture('acm-design')],
  ['jigsaw', () => loadFixture('jigsaw')],
  ['portfolio', () => loadFixture('portfolio')],
  ['portfolio-single-page', () => withoutFiles('portfolio', 'about.html')],
]

describe.each(SNAPSHOT_CASES)('fixture: %s', (name, files) => {
  const result = convertSite({ files: files(), siteName: name })

  it('matches the expected project files', async () => {
    for (const [path, contents] of result.files) {
      if (typeof contents !== 'string') continue
      await expect(contents).toMatchFileSnapshot(`__snapshots__/${name}/${path}`)
    }
    const binaries = [...result.files].filter(([, c]) => typeof c !== 'string').map(([p]) => p)
    expect(binaries.sort()).toMatchSnapshot()
  })

  it('produces code that parses', async () => {
    const { transformWithOxc } = await import('vite')
    for (const [path, contents] of result.files) {
      if (!/\.jsx?$/.test(path) || typeof contents !== 'string') continue
      const out = await transformWithOxc(contents, path, { lang: path.endsWith('.jsx') ? 'jsx' : 'js' })
      expect(out.code.length).toBeGreaterThan(0)
    }
  })
})

describe('multi-page site (acm-design)', () => {
  const result = convertSite({ files: loadFixture('acm-design'), siteName: 'ACMDesign' })
  const file = (path: string) => text(result.files.get(path))

  it('turns every page into a component with a route', () => {
    expect(result.pages).toEqual([
      { file: 'index.html', route: '/', component: 'HomePage' },
      { file: 'about.html', route: '/about', component: 'AboutPage' },
    ])
    const app = file('src/App.jsx')
    expect(app).toContain('<Route path="/" element={<HomePage />} />')
    expect(app).toContain('<Route path="/about" element={<AboutPage />} />')
    expect(file('src/main.jsx')).toContain('<BrowserRouter>')
    expect(JSON.parse(file('package.json')).dependencies['react-router']).toBeDefined()
  })

  it('turns links between pages into <Link to>', () => {
    const home = file('src/pages/HomePage.jsx')
    expect(home).toContain(`import { Link } from 'react-router'`)
    expect(home).toContain('<Link to="/about">More about me &gt;&gt;</Link>')
    expect(file('src/pages/AboutPage.jsx')).toContain('<Link to="/">Back</Link>')
    expect(result.notes.some((note) => note.title.includes('page was not found'))).toBe(false)
  })

  it('keeps each page\'s script with that page', () => {
    expect(result.files.has('src/pages/HomePage.legacy-script.js')).toBe(true)
    expect(result.files.has('src/pages/AboutPage.legacy-script.js')).toBe(false)
    expect(file('src/pages/HomePage.legacy-script.js')).toContain(`import { trackPage } from '../legacy-page.js'`)
    expect(file('src/pages/HomePage.jsx')).toContain('return runLegacyScript()')
    expect(file('src/legacy-page.js')).toContain('export function trackPage()')
  })

  it('shares CSS that every page links, and notes unused CSS', () => {
    expect(file('src/main.jsx')).toContain(`import './style.css'`)
    expect(file('src/pages/AboutPage.jsx')).not.toContain('style.css')
    expect(result.files.has('src/about.css')).toBe(true)
    expect(result.notes.find((note) => note.title.includes('isn’t used by any page'))?.examples).toEqual(['src/about.css'])
  })

  it('writes one index.html for the whole site', () => {
    const html = file('index.html')
    expect(html).toContain('<title>My Website</title>')
    expect(html).toContain('src="/src/main.jsx"')
    expect(result.files.has('about.html')).toBe(false)
  })
})

describe('multi-page site (portfolio)', () => {
  const result = convertSite({ files: loadFixture('portfolio'), siteName: 'Portfolio Site' })
  const home = text(result.files.get('src/pages/HomePage.jsx'))
  const about = text(result.files.get('src/pages/AboutPage.jsx'))

  it('gives each page its own <title> when they differ', () => {
    expect(home).toContain('<title>Alex Kim | Portfolio</title>')
    expect(text(result.files.get('index.html'))).not.toContain('<title>')
  })

  it('moves <body> attributes that only one page has into that page', () => {
    expect(text(result.files.get('index.html'))).toContain('<body>')
    expect(home).toContain(`document.body.setAttribute("class", "light")`)
    expect(about).not.toContain('document.body')
  })

  it('keeps same-page #links as <a>', () => {
    expect(home).toContain('<a href="#about">About</a>')
    expect(home).toContain('<Link to="/about">More about me</Link>')
  })

  it('warns about head tags that were only on some pages', () => {
    const note = result.notes.find((n) => n.title.includes('`<head>` tags now load on every page'))
    expect(note?.examples.join(' ')).toContain('confetti')
  })
})

describe('multi-page site (jigsaw)', () => {
  const result = convertSite({ files: loadFixture('jigsaw'), siteName: 'jigsaw' })

  it('warns that page-only CSS now applies everywhere', () => {
    const note = result.notes.find((n) => n.title.includes('CSS from one page'))
    expect(note?.examples.join(' ')).toContain('<style> in index2.html')
    expect(result.files.has('src/pages/HomePage.css')).toBe(true)
    expect(result.files.has('src/pages/Index2Page.css')).toBe(true)
  })
})

describe('single-page site (portfolio without about.html)', () => {
  const result = convertSite({ files: withoutFiles('portfolio', 'about.html'), siteName: 'Portfolio Site' })
  const app = text(result.files.get('src/App.jsx'))
  const legacy = text(result.files.get('src/legacy-script.js'))
  const html = text(result.files.get('index.html'))

  it('does not use React Router', () => {
    expect(result.files.has('src/pages/HomePage.jsx')).toBe(false)
    expect(app).not.toContain('react-router')
    expect(JSON.parse(text(result.files.get('package.json'))).dependencies['react-router']).toBeUndefined()
    expect(legacy).not.toContain('trackPage')
  })

  it('notes the link to the missing page', () => {
    expect(result.notes.find((n) => n.title === 'A linked page was not found')?.examples).toEqual(['index.html: about.html'])
  })

  it('converts attributes', () => {
    expect(app).toContain('className="site-header"')
    expect(app).toContain('htmlFor="name"')
    expect(app).toContain('maxLength="40"')
    expect(app).toContain('defaultValue="Your name"')
    expect(app).toContain('defaultChecked')
    expect(app).toContain('<select id="topic" defaultValue="work">')
    expect(app).toContain('<textarea id="message" rows="4" defaultValue="Hi Alex," />')
    expect(app).toContain('strokeWidth="2"')
    expect(app).toContain("style={{ backgroundImage: \"url('/images/bg.png')\", '--accent': '#fe8d3c'")
  })

  it('converts inline handlers to functions that reach script globals via window', () => {
    expect(app).toContain('onClick={() => window.toggleMenu()}')
    expect(app).toContain('onSubmit={(event) => { if (window.handleSubmit(event) === false) event.preventDefault() }}')
    expect(app).toMatch(/href="#"\s*onClick=\{\(event\) => \{\s*event\.preventDefault\(\)\s*window\.scrollToTop\(\)\s*\}\}/)
    expect(legacy).toContain('Object.assign(window, { toggleMenu, celebrate, handleSubmit, scrollToTop })')
  })

  it('keeps meaningful whitespace and escapes JSX text', () => {
    expect(app).toContain("<a href=\"#about\">About</a>{' '}")
    expect(app).toContain('&#123;curly braces&#125;')
    expect(app).toContain('&amp;')
    expect(app).toContain('© 2026')
  })

  it('rewrites asset paths to public/', () => {
    expect(app).toContain('src="/images/profile.png"')
    expect(text(result.files.get('src/css/style.css'))).toContain('url("/images/bg.png")')
    expect(html).toContain('href="/favicon.png"')
    expect(result.files.has('public/images/profile.png')).toBe(true)
    expect(result.files.has('public/README.md')).toBe(false)
    expect(result.files.has('public/about.html')).toBe(false)
  })

  it('fixes script code that breaks inside React', () => {
    expect(legacy).toContain('let wordIndex, charIndex')
    expect(legacy).not.toContain("addEventListener('DOMContentLoaded'")
    expect(legacy).toContain('(function () {')
    // Template literal content must not be re-indented.
    expect(legacy).toContain('\nWe\'ll reply soon.`')
  })

  it('keeps CDN scripts and external CSS in index.html', () => {
    expect(html).toContain('confetti.browser.min.js')
    expect(html).toContain('fonts.googleapis.com/css2')
    expect(html).not.toContain('css/style.css')
    expect(html).toContain('<body class="light">')
  })

  it('names the package after the folder', () => {
    expect(JSON.parse(text(result.files.get('package.json'))).name).toBe('portfolio-site-react')
  })
})

describe('pages', () => {
  it('finds every HTML page, top-level index first', () => {
    expect(findSitePages(['b.html', 'sub/x.html', 'index.html', 'a.htm', 'img/a.png'])).toEqual([
      'index.html',
      'a.htm',
      'b.html',
      'sub/x.html',
    ])
  })

  it('names routes and components after the file', () => {
    expect(describePages(['index.html', 'my-projects.html', 'blog/index.html', 'blog/post.html', '2024.html'])).toEqual([
      { file: 'index.html', route: '/', component: 'HomePage' },
      { file: 'my-projects.html', route: '/my-projects', component: 'MyProjectsPage' },
      { file: 'blog/index.html', route: '/blog', component: 'BlogPage' },
      { file: 'blog/post.html', route: '/blog/post', component: 'BlogPostPage' },
      { file: '2024.html', route: '/2024', component: 'Page2024Page' },
    ])
  })

  it('numbers components whose names would clash', () => {
    expect(describePages(['about.html', 'About.htm']).map((page) => page.component)).toEqual(['AboutPage', 'About2Page'])
  })
})

describe('convertInlineHandler', () => {
  it('replaces this with event.currentTarget', () => {
    expect(convertInlineHandler("this.classList.toggle('on')", new Set()).code).toBe(
      "(event) => event.currentTarget.classList.toggle('on')",
    )
  })

  it('leaves this alone inside nested functions', () => {
    expect(convertInlineHandler('setTimeout(function () { this.x = 1 })', new Set()).code).toBe(
      '() => setTimeout(function () { this.x = 1 })',
    )
  })

  it('turns return false into preventDefault', () => {
    expect(convertInlineHandler('go(); return false;', new Set(['go'])).code).toBe(
      '(event) => { window.go(); event.preventDefault() }',
    )
  })

  it('does not prefix property names', () => {
    expect(convertInlineHandler('menu.open()', new Set(['open'])).code).toBe('() => menu.open()')
  })
})

describe('buildLegacyScript', () => {
  const build = (code: string) =>
    buildLegacyScript({
      sources: [{ label: 'test.js', code }],
      exposedFunctions: [],
      exposedVariables: [],
      bodyOnload: null,
      notes: new NoteCollector(),
    })

  it('adds a semicolon when the previous statement has none', () => {
    const out = build("const x = 5\n// ready\ndocument.addEventListener('DOMContentLoaded', function () { go(x) })")
    expect(out).toContain(';(function () { go(x) })()')
  })

  it('needs no semicolon after a block', () => {
    const out = build("function go() {}\nwindow.onload = () => go()")
    expect(out).toMatch(/\n  \(\(\) => go\(\)\)\(\)/)
    expect(out).not.toContain(';(')
  })

  it('removes shared indentation but not inside template literals', () => {
    const out = build('    const a = 1\n    const s = `x\n        y`\n')
    expect(out).toContain('\n  const a = 1\n  const s = `x\n        y`')
  })

  it('declares implicit globals but not browser globals', () => {
    const out = build('count = 0\nlocation = "/"\nfor (i = 0; i < 3; i++) {}')
    expect(out).toContain('let count, i')
  })
})

describe('paths', () => {
  it('resolves relative URLs', () => {
    expect(resolveUrl('css/style.css', '../img/a.png?v=2')).toEqual({ path: 'img/a.png', suffix: '?v=2' })
    expect(resolveUrl('index.html', './pieces/A1.png')).toEqual({ path: 'pieces/A1.png', suffix: '' })
    expect(resolveUrl('index.html', 'https://example.com/a.png')).toBeNull()
    expect(resolveUrl('index.html', '#top')).toBeNull()
  })

  it('finds index.html first', () => {
    expect(findHtmlPages(['b.html', 'index.html', 'sub/x.html', 'a.htm'])).toEqual(['index.html', 'a.htm', 'b.html'])
  })
})
