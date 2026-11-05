// Instructions shown in the side panel for each workshop step.

import type { ReactNode } from 'react'
import { AiSuggest } from '../components/AiSuggest'
import { TailwindPanel } from '../components/TailwindPanel'

export interface ConversionSummary {
  pages: number
  classNames: number
  handlers: number
  links: number
  checks: number
}

export interface StepContext {
  /** The running React project, if any. */
  project: {
    dir: FileSystemDirectoryHandle
    name: string
    /** The file with the main page's JSX, e.g. `src/pages/HomePage.jsx` or `src/App.jsx`. */
    mainFile: string | null
  } | null
  /** Set right after converting a site in this session. */
  conversion: ConversionSummary | null
}

const CONTENT: Record<string, (ctx: StepContext) => ReactNode> = {
  'w4/setup': SetupStep,
  'w4/jsx': JsxStep,
  'w4/components': ComponentsStep,
  'w4/props': PropsStep,
  'w4/tailwind': TailwindStep,
}

export function StepContent({ workshop, step, ctx }: { workshop: string; step: string; ctx: StepContext }) {
  const render = CONTENT[`${workshop}/${step}`]
  return render ? <>{render(ctx)}</> : null
}

function Code({ children }: { children: string }) {
  return (
    <pre className="guide-code">
      <code>{children}</code>
    </pre>
  )
}

function mainFile(ctx: StepContext): string {
  return ctx.project?.mainFile ?? 'src/pages/HomePage.jsx (or src/App.jsx)'
}

const VS_CODE_URL = 'https://code.visualstudio.com/download'
const W4_SLIDES_URL = 'https://www.figma.com/deck/InrFC9ZmS7rGC0UZhWZNMn'

function SetupStep() {
  return (
    <>
      <h3>1. Open the slides</h3>
      <p>
        <a href={W4_SLIDES_URL} target="_blank" rel="noreferrer">
          Workshop 4 slides ↗
        </a>
      </p>
      <h3>2. Install VS Code</h3>
      <p>
        You’ll edit your project in VS Code. Already have it? Skip this. Otherwise download it here and install it:
      </p>
      <p>
        <a className="button" href={VS_CODE_URL} target="_blank" rel="noreferrer">
          Download VS Code ↗
        </a>
      </p>
      <h3>3. Use Chrome or Edge</h3>
      <p>Launchpad needs Chrome or Edge to open folders on your computer.</p>
      <p className="guide-aside">
        No need to install Node.js: React runs right here in your browser.
      </p>
    </>
  )
}

/** The converted project's layout, with what each file holds. */
function FileMap({ ctx }: { ctx: StepContext }) {
  const name = ctx.project?.name ?? 'My Site - React'
  // A site with one page has no src/pages/; its page is src/App.jsx.
  const singlePage = ctx.project?.mainFile === 'src/App.jsx' || ctx.conversion?.pages === 1
  const tree = singlePage
    ? `${name}/
├─ index.html      the only HTML file (just <head>)
├─ CONVERSION.md   what changed, and why
├─ public/         images and other files
└─ src/
   ├─ main.jsx     starts React (leave it)
   ├─ App.jsx      ★ your page, as JSX
   ├─ *.css        your CSS, unchanged
   └─ legacy-script.js   your original JavaScript`
    : `${name}/
├─ index.html      the only HTML file (just <head>)
├─ CONVERSION.md   what changed, and why
├─ public/         images and other files
└─ src/
   ├─ main.jsx     starts React (leave it)
   ├─ App.jsx      which URL shows which page
   ├─ *.css        your CSS, unchanged
   └─ pages/       ★ one file per page
      ├─ HomePage.jsx    ← your index.html
      ├─ AboutPage.jsx   ← your about.html
      └─ HomePage.legacy-script.js
                         your original JavaScript`
  return (
    <>
      <Code>{tree}</Code>
      <p className="guide-aside">
        ★ is where your page’s HTML went. Names under <code>pages/</code> come from your HTML files (for example{' '}
        <code>contact.html</code> → <code>ContactPage.jsx</code>).
      </p>
    </>
  )
}

function JsxStep(ctx: StepContext) {
  const { conversion } = ctx
  return (
    <>
      {conversion && (
        <div className="guide-callout ok">
          <strong>Converted!</strong> In your site, the converter changed:
          <ul>
            {conversion.pages > 1 && <li>{conversion.pages} pages → {conversion.pages} components</li>}
            {conversion.classNames > 0 && <li>{conversion.classNames} × <code>class</code> → <code>className</code></li>}
            {conversion.handlers > 0 && <li>{conversion.handlers} × <code>onclick="..."</code> → <code>onClick={'{...}'}</code></li>}
            {conversion.links > 0 && <li>{conversion.links} × <code>&lt;a href&gt;</code> → <code>&lt;Link to&gt;</code></li>}
          </ul>
          {conversion.checks > 0 && <p>{conversion.checks} thing(s) to check: see “Please check” in CONVERSION.md.</p>}
        </div>
      )}
      <h3>Open your project in VS Code</h3>
      <p>
        In VS Code: <strong>File → Open Folder…</strong> and choose{' '}
        <strong>“{ctx.project?.name ?? 'your site - React'}”</strong> (the React version, not your original site).
      </p>
      <h3>Where your files are</h3>
      <FileMap ctx={ctx} />
      <h3>Look at your JSX</h3>
      <ol>
        <li>
          Open <code>{mainFile(ctx)}</code>. It’s a JavaScript file, but your HTML is right inside it.
        </li>
        <li>
          Open <code>CONVERSION.md</code> to see everything that changed, and why.
        </li>
      </ol>
      <h3>Spot the JSX rules</h3>
      <ul>
        <li>
          <code>class</code> became <code>className</code>.
        </li>
        <li>
          Every tag is closed: <code>&lt;br&gt;</code> became <code>&lt;br /&gt;</code>.
        </li>
        <li>
          <code>{'{ }'}</code> runs JavaScript inside the HTML.
        </li>
      </ul>
      <h3>Try it</h3>
      <p>Add this somewhere in the JSX and save. The preview updates by itself.</p>
      <Code>{'<p>2 + 3 = {2 + 3}</p>'}</Code>
      <p className="guide-aside">
        You’ll see <code>runLegacyScript()</code> near the top. That runs your original JavaScript. Leave it as it is
        for now (don’t delete it); we’ll turn it into React later.
      </p>
    </>
  )
}

function ComponentsStep(ctx: StepContext) {
  return (
    <>
      <p>
        A component is a function that returns JSX. Its name starts with a capital letter, and you use it like an HTML
        tag: <code>&lt;Footer /&gt;</code>. Your page is already one: look at the function in{' '}
        <code>{mainFile(ctx)}</code>.
      </p>
      <p>
        Turn on <strong>🧩 Components</strong> above the preview and move your mouse over the page to see which
        component draws each part.
      </p>
      <h3>Make your first component</h3>
      <ol>
        <li>
          Pick a part of your page, like the footer, or something that repeats (cards, list items).
        </li>
        <li>
          Create <code>src/components/Footer.jsx</code> and move that JSX into it:
          <Code>{`function Footer() {
  return (
    <footer>...</footer>
  )
}

export default Footer`}</Code>
        </li>
        <li>
          Import it in your page and use it where the JSX was:
          <Code>{`import Footer from '../components/Footer.jsx'

<Footer />`}</Code>
        </li>
      </ol>
      <p className="guide-aside">
        Keep the <code>id</code>s and <code>onClick</code>s when you move JSX: your original JavaScript still looks for
        them.
      </p>
      {ctx.project && <AiSuggest key={`${ctx.project.dir.name}/components`} dir={ctx.project.dir} step="components" />}
    </>
  )
}

function PropsStep(ctx: StepContext) {
  return (
    <>
      <p>
        Props are like attributes for your own components. One component can show different content each time you use
        it.
      </p>
      <h3>Pass data in</h3>
      <Code>{`<ProjectCard title="AI Modeling" description="..." />
<ProjectCard title="Research Lab" description="..." />`}</Code>
      <h3>Use it inside the component</h3>
      <Code>{`function ProjectCard({ title, description }) {
  return (
    <article className="project-card">
      <h2>{title}</h2>
      <p>{description}</p>
    </article>
  )
}`}</Code>
      <h3>Try it</h3>
      <ol>
        <li>Find a part that repeats with different text.</li>
        <li>Make one component for it, with props for the parts that change.</li>
        <li>
          Replace the copies with the component. Use <code>{'{ }'}</code> to pass numbers, lists or functions:{' '}
          <code>{'count={3}'}</code>.
        </li>
      </ol>
      {ctx.project && <AiSuggest key={`${ctx.project.dir.name}/props`} dir={ctx.project.dir} step="props" />}
    </>
  )
}

function TailwindStep(ctx: StepContext) {
  return (
    <>
      <p>
        Tailwind gives you small classes for styling, so you can style a component right in its JSX instead of a
        separate CSS file.
      </p>
      <Code>{`/* CSS */
.project-card { padding: 40px; border-radius: 10px; }

/* Tailwind: right in the JSX */
<article className="p-[40px] rounded-[10px]">`}</Code>
      <ul>
        <li>
          <code>p-4</code> = 16px padding, <code>text-center</code>, <code>flex</code>, <code>gap-4</code>…
        </li>
        <li>
          Exact values go in brackets: <code>w-[250px]</code>, <code>text-[#8878aa]</code>.
        </li>
        <li>
          States are prefixes: <code>hover:bg-violet-500</code>.
        </li>
      </ul>
      {ctx.project && <TailwindPanel key={ctx.project.dir.name} dir={ctx.project.dir} />}
      <h3>Try it yourself</h3>
      <p>
        Pick an element, add Tailwind classes to its <code>className</code>, save, and watch the preview. Then delete
        the CSS rule it no longer needs.
      </p>
    </>
  )
}
