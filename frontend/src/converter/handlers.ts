import { parse, type Node } from 'acorn'
import { ancestor } from 'acorn-walk'
import MagicString from 'magic-string'

// Converts inline handler code (`onclick="toggleMenu(); return false"`) into
// a JSX arrow function (`(event) => { window.toggleMenu(); event.preventDefault() }`).

type AnyNode = Node & Record<string, any>

const PREFIX = '(function () {\n'
const SUFFIX = '\n})'

export interface ConvertedHandler {
  /** Arrow function source, e.g. `() => window.toggleMenu()`. */
  code: string
  /** Global names the handler reached through `window.` */
  usedGlobals: Set<string>
  /** False when the code couldn't be parsed and was kept as-is. */
  ok: boolean
}

/**
 * @param globals top-level names from the site's scripts. They now live inside
 *   `runLegacyScript()`, which publishes them on `window`, so handlers must
 *   reach them as `window.name`.
 */
export function convertInlineHandler(code: string, globals: Set<string>): ConvertedHandler {
  const usedGlobals = new Set<string>()
  const wrapped = PREFIX + code + SUFFIX
  let ast: AnyNode
  try {
    ast = parse(wrapped, { ecmaVersion: 'latest', sourceType: 'script' }) as AnyNode
  } catch {
    return { code: `(event) => {\n${code}\n}`, usedGlobals, ok: false }
  }

  const s = new MagicString(code)
  const at = (position: number) => position - PREFIX.length
  const wrapper = ast.body[0].expression as AnyNode
  let usesEvent = false

  ancestor(ast, {
    ThisExpression(node: AnyNode, _state: unknown, ancestors: AnyNode[]) {
      // `this` in an inline handler is the element; in React that's event.currentTarget.
      if (ancestors.some((a) => a !== wrapper && a.type.startsWith('Function'))) return
      s.overwrite(at(node.start), at(node.end), 'event.currentTarget')
      usesEvent = true
    },
    Identifier(node: AnyNode, _state: unknown, ancestors: AnyNode[]) {
      const parent = ancestors[ancestors.length - 2]
      if (parent?.type === 'MemberExpression' && parent.property === node && !parent.computed) return
      if (parent?.type === 'Property' && parent.key === node && !parent.computed && !parent.shorthand) return
      if (node.name === 'event') usesEvent = true
      if (globals.has(node.name) && !(parent?.type === 'Property' && parent.shorthand)) {
        // prependRight: survives the `return` rewrite below, which edits the text before it.
        s.prependRight(at(node.start), 'window.')
        usedGlobals.add(node.name)
      }
    },
  })

  // `return false` in an inline handler cancels the default action (following
  // a link, submitting a form). React ignores return values.
  for (const statement of wrapper.body.body as AnyNode[]) {
    if (statement.type !== 'ReturnStatement' || !statement.argument) continue
    const argument = statement.argument
    if (argument.type === 'Literal' && argument.value === false) {
      s.overwrite(at(statement.start), at(statement.end), 'event.preventDefault()')
    } else {
      // Edit around the argument so changes inside it (like `window.`) are kept.
      s.overwrite(at(statement.start), at(argument.start), 'if (')
      const tail = ' === false) event.preventDefault()'
      if (statement.end > argument.end) s.overwrite(at(argument.end), at(statement.end), tail)
      else s.appendLeft(at(argument.end), tail)
    }
    usesEvent = true
  }

  const params = usesEvent ? '(event)' : '()'
  const statements = wrapper.body.body as AnyNode[]
  const body = s.toString().trim().replace(/;$/, '')

  if (statements.length === 1 && statements[0].type === 'ExpressionStatement' && !body.includes('\n')) {
    return { code: `${params} => ${body}`, usedGlobals, ok: true }
  }
  if (!body.includes('\n')) {
    return { code: `${params} => { ${body} }`, usedGlobals, ok: true }
  }
  return { code: `${params} => {\n${body}\n}`, usedGlobals, ok: true }
}
