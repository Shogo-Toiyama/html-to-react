import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { convertInlineHandler } from './handlers'
import { convertSite, findHtmlPages } from './index'
import { buildLegacyScript } from './legacyScript'
import { NoteCollector } from './notes'
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

describe.each(['jigsaw', 'portfolio'])('fixture: %s', (name) => {
  const result = convertSite({ files: loadFixture(name), siteName: name })

  it('matches the expected project files', async () => {
    for (const [path, contents] of result.files) {
      if (typeof contents !== 'string') continue
      await expect(contents).toMatchFileSnapshot(`__snapshots__/${name}/${path}`)
    }
    const binaries = [...result.files].filter(([, c]) => typeof c !== 'string').map(([p]) => p)
    expect(binaries.sort()).toMatchSnapshot()
  })
})

describe('portfolio details', () => {
  const result = convertSite({ files: loadFixture('portfolio'), siteName: 'Portfolio Site' })
  const app = text(result.files.get('src/App.jsx'))
  const legacy = text(result.files.get('src/legacy-script.js'))
  const html = text(result.files.get('index.html'))

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

  it('produces JSX that parses', async () => {
    const { transformWithOxc } = await import('vite')
    for (const path of ['src/App.jsx', 'src/main.jsx', 'src/legacy-script.js']) {
      const out = await transformWithOxc(text(result.files.get(path)), path, { lang: 'jsx' })
      expect(out.code.length).toBeGreaterThan(0)
    }
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
