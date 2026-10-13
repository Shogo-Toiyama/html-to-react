import { parse, type Node } from 'acorn'
import { full } from 'acorn-walk'
import MagicString from 'magic-string'
import type { NoteCollector } from './notes'

// The site's original <script> code moves into `runLegacyScript()`, which
// App.jsx calls once from useEffect. Only what breaks in that new home is
// changed; everything else stays exactly as the participant wrote it.

export interface ScriptSource {
  /** Where the code came from, e.g. `js/main.js` or `index.html (inline <script>)`. */
  label: string
  code: string
}

// ESTree nodes are walked generically.
type AnyNode = Node & Record<string, any>

function parseScript(code: string): AnyNode {
  return parse(code, { ecmaVersion: 'latest', sourceType: 'script', allowHashBang: true }) as AnyNode
}

function tryParse(code: string): AnyNode | null {
  try {
    return parseScript(code)
  } catch {
    return null
  }
}

export interface TopLevelNames {
  functions: Set<string>
  variables: Set<string>
}

/** Names declared at the top level of the scripts (globals in the original page). */
export function collectTopLevelNames(sources: ScriptSource[]): TopLevelNames {
  const functions = new Set<string>()
  const variables = new Set<string>()
  for (const source of sources) {
    const ast = tryParse(source.code)
    if (!ast) continue
    for (const statement of ast.body as AnyNode[]) {
      if (statement.type === 'FunctionDeclaration' && statement.id) functions.add(statement.id.name)
      if (statement.type === 'ClassDeclaration' && statement.id) variables.add(statement.id.name)
      if (statement.type === 'VariableDeclaration') {
        for (const declarator of statement.declarations) patternNames(declarator.id, variables)
      }
    }
  }
  return { functions, variables }
}

function patternNames(pattern: AnyNode | null, out: Set<string>) {
  if (!pattern) return
  switch (pattern.type) {
    case 'Identifier':
      out.add(pattern.name)
      break
    case 'ObjectPattern':
      for (const property of pattern.properties) patternNames(property.type === 'RestElement' ? property : property.value, out)
      break
    case 'ArrayPattern':
      for (const element of pattern.elements) patternNames(element, out)
      break
    case 'RestElement':
      patternNames(pattern.argument, out)
      break
    case 'AssignmentPattern':
      patternNames(pattern.left, out)
      break
  }
}

// Assigning to these without `let` is fine: they already exist on `window`.
const BROWSER_GLOBALS = new Set([
  'name', 'status', 'location', 'document', 'window', 'top', 'parent', 'self', 'opener', 'length',
  'origin', 'event', 'onload', 'onresize', 'onscroll', 'onclick', 'onkeydown', 'onkeyup', 'onmousemove',
  'onbeforeunload', 'onhashchange', 'onpopstate', 'onerror', 'onmessage',
])

function isBrowserGlobal(name: string): boolean {
  return BROWSER_GLOBALS.has(name) || (typeof window !== 'undefined' && name in window)
}

/** Variables assigned without `let`/`const`/`var`: implicit globals, an error in React's strict-mode modules. */
function findImplicitGlobals(ast: AnyNode, declared: Set<string>, out: Set<string>) {
  const check = (node: AnyNode | null) => {
    if (node?.type === 'Identifier' && !declared.has(node.name) && !isBrowserGlobal(node.name)) out.add(node.name)
  }
  full(ast, (node: AnyNode) => {
    if (node.type === 'AssignmentExpression') check(node.left)
    else if (node.type === 'UpdateExpression') check(node.argument)
    else if (node.type === 'ForInStatement' || node.type === 'ForOfStatement') check(node.left)
  })
}

function collectDeclaredNames(ast: AnyNode, out: Set<string>) {
  full(ast, (node: AnyNode) => {
    switch (node.type) {
      case 'VariableDeclarator':
        patternNames(node.id, out)
        break
      case 'FunctionDeclaration':
      case 'FunctionExpression':
      case 'ArrowFunctionExpression':
        if (node.id) out.add(node.id.name)
        for (const param of node.params) patternNames(param, out)
        break
      case 'ClassDeclaration':
      case 'ClassExpression':
        if (node.id) out.add(node.id.name)
        break
      case 'CatchClause':
        patternNames(node.param, out)
        break
    }
  })
}

const READY_EVENTS = new Set(['DOMContentLoaded', 'load'])

function isWindowOrDocument(node: AnyNode): boolean {
  return node.type === 'Identifier' && (node.name === 'window' || node.name === 'document')
}

/**
 * `document.addEventListener('DOMContentLoaded', fn)` / `window.onload = fn`:
 * returns the callback node. When the converted code runs, the page has
 * already loaded, so these events would never fire again.
 */
function readyCallback(statement: AnyNode): AnyNode | null {
  const expression = statement.expression
  if (!expression) return null
  if (
    expression.type === 'CallExpression' &&
    expression.callee.type === 'MemberExpression' &&
    !expression.callee.computed &&
    expression.callee.property.name === 'addEventListener' &&
    isWindowOrDocument(expression.callee.object) &&
    expression.arguments[0]?.type === 'Literal' &&
    READY_EVENTS.has(expression.arguments[0].value) &&
    expression.arguments[1]
  ) {
    return expression.arguments[1]
  }
  if (
    expression.type === 'AssignmentExpression' &&
    expression.operator === '=' &&
    expression.left.type === 'MemberExpression' &&
    !expression.left.computed &&
    expression.left.object.type === 'Identifier' &&
    expression.left.object.name === 'window' &&
    expression.left.property.name === 'onload'
  ) {
    return expression.right
  }
  return null
}

/**
 * Removes the indentation shared by all lines (inline <script> code is usually
 * indented to match the HTML) without touching lines inside template literals.
 */
function dedent(code: string): string {
  code = code.replace(/^\s*\n/, '').replace(/\s+$/, '')
  const ast = tryParse(code)
  const templates: [number, number][] = []
  if (ast) full(ast, (node: AnyNode) => node.type === 'TemplateLiteral' && templates.push([node.start, node.end]))
  const inTemplate = (position: number) => templates.some(([start, end]) => position > start && position < end)

  const lineStarts = [0]
  for (let i = 0; i < code.length; i++) if (code[i] === '\n') lineStarts.push(i + 1)
  const indents = lineStarts
    .filter((start) => !inTemplate(start))
    .map((start) => code.slice(start, code.indexOf('\n', start) === -1 ? undefined : code.indexOf('\n', start)))
    .filter((line) => line.trim() !== '')
    .map((line) => /^[ \t]*/.exec(line)![0].length)
  const shared = indents.length > 0 ? Math.min(...indents) : 0
  if (shared === 0) return code

  let out = ''
  let last = 0
  for (const start of lineStarts) {
    if (inTemplate(start)) continue
    out += code.slice(last, start)
    const indent = /^[ \t]*/.exec(code.slice(start))![0].length
    last = start + Math.min(indent, shared)
  }
  return out + code.slice(last)
}

function transformSource(source: ScriptSource, notes: NoteCollector): { code: string; ast: AnyNode | null } {
  source = { ...source, code: dedent(source.code) }
  const comments: [number, number][] = []
  let ast: AnyNode | null = null
  try {
    ast = parse(source.code, {
      ecmaVersion: 'latest',
      sourceType: 'script',
      allowHashBang: true,
      onComment: (_block, _text, start, end) => comments.push([start, end]),
    }) as AnyNode
  } catch {
    ast = null
  }
  const s = new MagicString(source.code)
  if (!ast) {
    notes.check(
      'Some JavaScript has a syntax error',
      'It was copied without changes. The browser will show the error until it is fixed.',
      source.label,
    )
    return { code: s.indent('  ').toString(), ast: null }
  }

  const templateRanges: [number, number][] = []
  full(ast, (node: AnyNode) => {
    if (node.type === 'TemplateLiteral') templateRanges.push([node.start, node.end])
    if (node.type !== 'ExpressionStatement') return
    const callback = readyCallback(node)
    if (!callback) return
    const callbackCode = source.code.slice(callback.start, callback.end)
    let call = callback.type === 'Identifier' ? `${callbackCode}()` : `(${callbackCode})()`
    // A line starting with "(" would continue the previous statement if that
    // one has no semicolon, so add one in front.
    if (call.startsWith('(') && !endsStatement(source.code, node.start, comments)) call = ';' + call
    const lineStart = source.code.lastIndexOf('\n', node.start - 1) + 1
    const indent = /^[ \t]*/.exec(source.code.slice(lineStart, node.start))![0]
    s.overwrite(
      node.start,
      node.end,
      `// Converter: this used to wait for the page to load. In React it runs after\n` +
        `${indent}// the page is already on screen, so it is called right away instead.\n` +
        `${indent}${call}`,
    )
    notes.change(
      '"Wait for the page to load" code now runs right away',
      'Code inside `DOMContentLoaded` or `window.onload` used to wait until the page was ready. ' +
        'In React, your code starts after the page is already on screen, so the event would never fire. ' +
        'The function is now called directly.',
      source.label,
    )
  })

  return { code: s.indent('  ', { exclude: templateRanges }).toString(), ast }
}

/** True if the code before `position` (ignoring whitespace and comments) can't continue into a "(". */
function endsStatement(code: string, position: number, comments: [number, number][]): boolean {
  let i = position - 1
  while (i >= 0) {
    if (/\s/.test(code[i])) {
      i -= 1
      continue
    }
    const comment = comments.find(([, end]) => end === i + 1)
    if (comment) {
      i = comment[0] - 1
      continue
    }
    return code[i] === ';' || code[i] === '}' || code[i] === '{'
  }
  return true
}

export interface LegacyScriptOptions {
  sources: ScriptSource[]
  /** Top-level functions used by inline `onclick="..."` handlers. */
  exposedFunctions: string[]
  /** Top-level variables used by inline handlers. */
  exposedVariables: string[]
  /** Code from `<body onload="...">`, already converted. */
  bodyOnload: string | null
  notes: NoteCollector
}

export function buildLegacyScript(options: LegacyScriptOptions): string {
  const { sources, exposedFunctions, exposedVariables, bodyOnload, notes } = options
  const transformed = sources.map((source) => ({ source, ...transformSource(source, notes) }))

  const declared = new Set<string>()
  const implicit = new Set<string>()
  for (const { ast } of transformed) if (ast) collectDeclaredNames(ast, declared)
  for (const { ast } of transformed) if (ast) findImplicitGlobals(ast, declared, implicit)

  const body: string[] = []
  if (implicit.size > 0) {
    body.push(
      '  // Converter: these variables were used without `let`. That works in a plain',
      '  // <script>, but React code runs in "strict mode", which requires declaring them.',
      `  let ${[...implicit].join(', ')}`,
      '',
    )
    notes.change(
      'Added `let` for variables that were never declared',
      'Plain `<script>` code allows `x = 5` without declaring `x` first. React code runs in strict mode, ' +
        'where that is an error. The converter added a `let` line at the top of `legacy-script.js`.',
      [...implicit].join(', '),
    )
  }

  if (exposedFunctions.length > 0) {
    body.push(
      '  // Converter: onclick="..." attributes in App.jsx call these through `window`.',
      `  Object.assign(window, { ${exposedFunctions.join(', ')} })`,
      '',
    )
  }

  transformed.forEach(({ source, code }, index) => {
    if (sources.length > 1) body.push(`  // ---- From ${source.label} ----`)
    body.push(code.replace(/\s+$/, ''))
    if (index < transformed.length - 1) body.push('')
  })

  if (exposedVariables.length > 0) {
    body.push('', `  Object.assign(window, { ${exposedVariables.join(', ')} })`)
  }
  if (bodyOnload) {
    body.push('', '  // Converter: from <body onload="...">', `  ${bodyOnload}`)
  }

  const labels = sources.map((source) => source.label).join(', ')
  return `// Your original JavaScript, moved here from: ${labels}
//
// It still changes the page directly (document.querySelector, classList,
// innerHTML, ...). That works, but React doesn't know about those changes.
// As you learn React, move this code into your components piece by piece.
// When this file is empty, delete it along with its import in App.jsx.

export function runLegacyScript() {
${body.join('\n')}
}

// Code that changes the page directly can't be swapped in while the page is
// running, so the whole page reloads whenever a JavaScript file changes.
// (CSS changes still update instantly.) Remove this along with the file.
if (import.meta.hot) {
  import.meta.hot.on('vite:beforeUpdate', (payload) => {
    if (payload.updates.some((update) => update.type === 'js-update')) location.reload()
  })
}
`
}
