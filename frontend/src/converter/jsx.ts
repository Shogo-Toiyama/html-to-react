import type { DefaultTreeAdapterTypes } from 'parse5'
import {
  BLOCK_ELEMENTS,
  BOOLEAN_PROPS,
  camelCase,
  capitalize,
  eventPropName,
  HTML_ATTRIBUTE_TO_PROP,
  NO_TEXT_CHILDREN,
  VOID_ELEMENTS,
} from './attributes'
import { parseInlineStyle } from './css'
import { convertInlineHandler } from './handlers'
import type { NoteCollector } from './notes'

type ChildNode = DefaultTreeAdapterTypes.ChildNode
type Element = DefaultTreeAdapterTypes.Element
type TextNode = DefaultTreeAdapterTypes.TextNode
type Template = DefaultTreeAdapterTypes.Template

const SVG_NS = 'http://www.w3.org/2000/svg'
const INDENT = '  '
const MAX_LINE = 100

/** Attributes that hold a URL to a file in the site. */
const URL_ATTRIBUTES = new Set(['src', 'href', 'poster', 'data', 'xlink:href'])

/** `<input type=...>` values that keep a plain `value` (React doesn't treat them as editable). */
const FIXED_VALUE_INPUT_TYPES = new Set(['button', 'checkbox', 'hidden', 'image', 'radio', 'reset', 'submit'])

export interface JsxContext {
  /** File being converted, for notes (e.g. `index.html`). */
  file: string
  /** Top-level names from the site's scripts; handlers reach them via `window.`. */
  globals: Set<string>
  /** Filled with the globals that handlers actually use. */
  usedGlobals: Set<string>
  /** Rewrites a relative file URL for the React project. */
  rewriteUrl(url: string): string
  notes: NoteCollector
}

/** Prints nodes as JSX lines at the given indentation. */
export function printChildren(nodes: ChildNode[], ctx: JsxContext, depth: number, parent: string): string[] {
  const pre = parent === 'pre'
  const lines: string[] = []
  const pad = INDENT.repeat(depth)
  // Removing <script>/<style> can leave two text nodes side by side; merge them.
  const visible: ChildNode[] = []
  for (const node of nodes) {
    if (node.nodeName === '#documentType') continue
    const previous = visible[visible.length - 1]
    if (node.nodeName === '#text' && previous?.nodeName === '#text') {
      visible[visible.length - 1] = { ...previous, value: (previous as TextNode).value + (node as TextNode).value } as TextNode
    } else {
      visible.push(node)
    }
  }

  const neighbor = (index: number, step: -1 | 1): ChildNode | null => {
    for (let i = index + step; i >= 0 && i < visible.length; i += step) {
      if (visible[i].nodeName !== '#comment') return visible[i]
    }
    return null
  }
  const isInline = (node: ChildNode | null) =>
    node !== null && (node.nodeName === '#text' || !BLOCK_ELEMENTS.has((node as Element).tagName))
  const appendSpace = () => {
    if (lines.length > 0 && !lines[lines.length - 1].endsWith("{' '}")) lines[lines.length - 1] += "{' '}"
  }

  visible.forEach((node, index) => {
    if (node.nodeName === '#comment') {
      const data = (node as DefaultTreeAdapterTypes.CommentNode).data.trim().replaceAll('*/', '* /')
      lines.push(`${pad}{/* ${data} */}`)
      return
    }

    if (node.nodeName === '#text') {
      const value = (node as TextNode).value
      if (pre) {
        lines.push(`${pad}{${JSON.stringify(value)}}`)
        return
      }
      const collapsed = value.replace(/[ \t\n\r\f]+/g, ' ')
      const keepEdges = !NO_TEXT_CHILDREN.has(parent)
      const before = isInline(neighbor(index, -1)) && keepEdges
      const after = isInline(neighbor(index, 1)) && keepEdges
      if (collapsed.trim() === '') {
        // Whitespace between two inline elements shows as a space on screen,
        // but JSX drops it, so it must be written as {' '}.
        if (collapsed === ' ' && before && after) appendSpace()
        return
      }
      if (collapsed.startsWith(' ') && before) appendSpace()
      lines.push(pad + escapeText(collapsed.trim()) + (collapsed.endsWith(' ') && after ? "{' '}" : ''))
      return
    }

    lines.push(...printElement(node as Element, ctx, depth))
  })
  return lines
}

function printElement(element: Element, ctx: JsxContext, depth: number): string[] {
  const pad = INDENT.repeat(depth)
  const tag = element.tagName
  const props = elementProps(element, ctx)
  const children =
    tag === 'textarea' ? [] : tag === 'template' ? (element as Template).content.childNodes : element.childNodes

  const openTag = (selfClose: boolean) => {
    const end = selfClose ? ' />' : '>'
    const oneLine = `${pad}<${tag}${props.map((prop) => ' ' + prop).join('')}${end}`
    if (oneLine.length <= MAX_LINE && !props.some((prop) => prop.includes('\n'))) return [oneLine]
    const inner = pad + INDENT
    return [
      `${pad}<${tag}`,
      ...props.flatMap((prop) => {
        // Multi-line handlers: indent the body one level deeper than the prop.
        const parts = prop.split('\n')
        return parts.map((line, i) =>
          i === 0 || i === parts.length - 1 ? inner + line.trim() : inner + INDENT + line.trim(),
        )
      }),
      `${pad}${selfClose ? '/>' : '>'}`,
    ]
  }

  if (VOID_ELEMENTS.has(tag) || tag === 'textarea' || (children.length === 0 && element.namespaceURI === SVG_NS)) {
    return openTag(true)
  }

  const open = openTag(false)
  if (tag !== 'pre') {
    // Keep inline content (text, links, <strong>...) flowing like a paragraph,
    // the way people write it, instead of one element per line.
    const atoms = inlineAtoms(children, ctx)
    if (atoms !== null && atoms.length > 0) {
      const oneLine = atoms.map((atom) => atom.text).join(' ')
      if (open.length === 1 && open[0].length + oneLine.length + tag.length + 3 <= MAX_LINE) {
        return [`${open[0]}${oneLine}</${tag}>`]
      }
      return [...open, ...wrapAtoms(atoms, INDENT.repeat(depth + 1)), `${pad}</${tag}>`]
    }
  }
  const inner = printChildren(children, ctx, depth + 1, tag)
  if (inner.length === 0) {
    open[open.length - 1] += `</${tag}>`
    return open
  }
  if (inner.length === 1 && open.length === 1) {
    const oneLine = `${open[0]}${inner[0].trim()}</${tag}>`
    if (oneLine.length <= MAX_LINE && tag !== 'pre') return [oneLine]
  }
  return [...open, ...inner, `${pad}</${tag}>`]
}

// An element may be printed twice (one-line attempt, then multi-line), so its
// props are converted once and cached; otherwise notes would be counted twice.
const propsCache = new WeakMap<Element, string[]>()

function elementProps(element: Element, ctx: JsxContext): string[] {
  const cached = propsCache.get(element)
  if (cached) return cached
  const props = convertAttributes(element, ctx)
  if (element.tagName === 'textarea') {
    const text = element.childNodes.map((child) => (child as TextNode).value ?? '').join('')
    if (text) props.push(`defaultValue=${quote(text.replace(/^\n/, ''))}`)
  }
  if (element.tagName === 'select') {
    const selected = findSelectedOption(element)
    if (selected !== null) {
      props.push(`defaultValue=${quote(selected)}`)
      ctx.notes.change(
        '`selected` moved to `defaultValue` on `<select>`',
        'React picks the starting option of a `<select>` with `defaultValue` instead of `selected` on an `<option>`.',
        `${ctx.file}: <select>`,
      )
    }
  }
  propsCache.set(element, props)
  return props
}

/** A run of inline content with no space inside, e.g. `Alex<span>.</span>` or `websites`. */
interface Atom {
  text: string
  startsWithText: boolean
  endsWithText: boolean
}

/**
 * Splits inline children into atoms at spaces. Returns null if they contain
 * block elements, comments, or elements that need several lines, and also
 * when there's no text (a row of links reads better one per line).
 */
function inlineAtoms(nodes: ChildNode[], ctx: JsxContext): Atom[] | null {
  const atoms: Atom[] = []
  let current: Atom | null = null
  let hasText = false
  const push = (text: string, isText: boolean) => {
    if (current) {
      current.text += text
      current.endsWithText = isText
    } else {
      current = { text, startsWithText: isText, endsWithText: isText }
    }
  }
  const breakAtom = () => {
    if (current) atoms.push(current)
    current = null
  }

  for (const node of nodes) {
    if (node.nodeName === '#comment' || node.nodeName === '#documentType') return null
    if (node.nodeName === '#text') {
      const collapsed = (node as TextNode).value.replace(/[ \t\n\r\f]+/g, ' ')
      collapsed.split(' ').forEach((word, i) => {
        if (i > 0) breakAtom()
        if (word) {
          push(escapeText(word), true)
          hasText = true
        }
      })
      continue
    }
    const element = node as Element
    if (BLOCK_ELEMENTS.has(element.tagName) || element.tagName === 'select') return null
    const lines = printElement(element, ctx, 0)
    if (lines.length !== 1) return null
    push(lines[0], false)
  }
  breakAtom()
  return hasText ? atoms : null
}

/**
 * Fills lines up to MAX_LINE. A line break between two words of text reads
 * as a space in JSX, but next to an element JSX drops it, so those breaks end
 * with {' '}.
 */
function wrapAtoms(atoms: Atom[], pad: string): string[] {
  const lines: string[] = []
  let line = ''
  atoms.forEach((atom, i) => {
    if (line === '') {
      line = atom.text
      return
    }
    if (pad.length + line.length + 1 + atom.text.length <= MAX_LINE) {
      line += ' ' + atom.text
      return
    }
    const previous = atoms[i - 1]
    lines.push(pad + line + (previous.endsWithText && atom.startsWithText ? '' : "{' '}"))
    line = atom.text
  })
  if (line) lines.push(pad + line)
  return lines
}

function findSelectedOption(select: Element): string | null {
  const options: Element[] = []
  const collect = (nodes: ChildNode[]) => {
    for (const node of nodes) {
      if (node.nodeName === 'option') options.push(node as Element)
      else if (node.nodeName === 'optgroup') collect((node as Element).childNodes)
    }
  }
  collect(select.childNodes)
  const option = options.find((o) => o.attrs.some((attr) => attr.name === 'selected'))
  if (!option) return null
  const value = option.attrs.find((attr) => attr.name === 'value')?.value
  return value ?? option.childNodes.map((child) => (child as TextNode).value ?? '').join('').trim()
}

function convertAttributes(element: Element, ctx: JsxContext): string[] {
  const tag = element.tagName
  const isSvg = element.namespaceURI === SVG_NS
  const props: string[] = []
  let javascriptHref: string | null = null
  let javascriptHrefRaw = ''
  const handlers = new Map<string, string>()
  const originalHandlers = new Map<string, string>()

  for (const attr of element.attrs) {
    const name = attr.prefix ? `${attr.prefix}:${attr.name}` : attr.name
    const value = attr.value

    const event = eventPropName(name.toLowerCase())
    if (event || (name.startsWith('on') && name.length > 2 && !isSvg)) {
      const prop = event ?? 'on' + capitalize(name.slice(2))
      handlers.set(prop, value)
      originalHandlers.set(prop, `${name}="${value.trim().slice(0, 40)}"`)
      continue
    }

    if (name === 'style') {
      props.push(`style={${styleObject(value, ctx)}}`)
      continue
    }

    if (name === 'href' && /^\s*javascript:/i.test(value)) {
      javascriptHref = decodeJavascriptUrl(value)
      javascriptHrefRaw = value
      props.push('href="#"')
      continue
    }

    if (tag === 'option' && name === 'selected') continue

    let propName = renameAttribute(name, isSvg, ctx)
    let propValue = value
    if (URL_ATTRIBUTES.has(name)) propValue = ctx.rewriteUrl(value)
    if (name === 'srcset') propValue = rewriteSrcset(value, ctx)

    if (tag === 'input' && name === 'checked') propName = 'defaultChecked'
    if (name === 'value' && (tag === 'select' || (tag === 'input' && !isFixedValueInput(element)))) {
      propName = 'defaultValue'
    }
    if (propName === 'defaultValue' || propName === 'defaultChecked') {
      ctx.notes.change(
        'Form fields use `defaultValue` / `defaultChecked`',
        'In React, `value` and `checked` lock a form field to that value unless React code updates it. ' +
          '`defaultValue` and `defaultChecked` set the starting value and let the user type, like plain HTML.',
        `${ctx.file}: <${tag} ${name}>`,
      )
    }

    if (BOOLEAN_PROPS.has(propName) && (value === '' || value.toLowerCase() === name.toLowerCase())) {
      props.push(propName)
    } else {
      props.push(`${propName}=${quote(propValue)}`)
    }
  }

  if (javascriptHref !== null) {
    const trivial = /^\s*(void\s*\(?\s*0\s*\)?|;)?\s*;?\s*$/.test(javascriptHref)
    const onClick = handlers.get('onClick')
    const code = ['event.preventDefault()', trivial ? null : javascriptHref, onClick ?? null]
      .filter((part) => part !== null)
      .join('\n')
    handlers.set('onClick', code)
    ctx.notes.change(
      '`href="javascript:..."` links became `onClick`',
      'React blocks `javascript:` URLs for security. The link now points to `#`, and the code runs in `onClick` ' +
        '(with `event.preventDefault()` so the page doesn\'t jump).',
      `${ctx.file}: <${tag} href="${javascriptHrefRaw.slice(0, 40)}">`,
    )
  }

  for (const [propName, code] of handlers) {
    const converted = convertInlineHandler(code, ctx.globals)
    converted.usedGlobals.forEach((name) => ctx.usedGlobals.add(name))
    props.push(`${propName}={${converted.code}}`)
    ctx.notes.change(
      'Inline event handlers became functions',
      'HTML runs a string of code: `onclick="toggleMenu()"`. React needs a function: ' +
        '`onClick={() => window.toggleMenu()}`. Functions from your script are reached through `window` for now, ' +
        'because your script now lives in its own file.',
      `${ctx.file}: <${tag} ${originalHandlers.get(propName) ?? 'href="javascript:..."'}>`,
    )
    if (!converted.ok) {
      ctx.notes.check(
        'An inline event handler could not be read',
        'Its code was copied as-is and may need fixing by hand.',
        `${ctx.file}: <${tag} ${propName.toLowerCase()}>`,
      )
    }
    if (propName === 'onChange' && (tag === 'textarea' || (tag === 'input' && !isFixedValueInput(element)))) {
      ctx.notes.check(
        '`onChange` runs on every keystroke in React',
        'In HTML, `onchange` on a text field runs when the field loses focus. In React, `onChange` runs every time ' +
          'the text changes. Check that this still behaves the way you want.',
        `${ctx.file}: <${tag} onchange>`,
      )
    }
  }

  return props
}

function isFixedValueInput(input: Element): boolean {
  const type = input.attrs.find((attr) => attr.name === 'type')?.value.toLowerCase() ?? 'text'
  return FIXED_VALUE_INPUT_TYPES.has(type)
}

function renameAttribute(name: string, isSvg: boolean, ctx: JsxContext): string {
  if (name === 'class') {
    ctx.notes.change(
      '`class` became `className`',
      'JSX is JavaScript, where `class` is a reserved word, so React uses `className` for CSS classes.',
    )
    return 'className'
  }
  if (name === 'for') {
    ctx.notes.change(
      '`for` became `htmlFor`',
      '`for` is a reserved word in JavaScript, so React uses `htmlFor` on `<label>`.',
    )
    return 'htmlFor'
  }
  if (name.startsWith('data-') || name.startsWith('aria-')) return name
  if (isSvg) {
    if (name.includes(':')) {
      const [prefix, local] = name.split(':')
      return prefix + capitalize(local)
    }
    if (name.includes('-')) {
      ctx.notes.change(
        'SVG attributes use camelCase',
        'In JSX, SVG attributes like `stroke-width` are written as `strokeWidth`.',
      )
      return camelCase(name)
    }
    return name
  }
  const mapped = HTML_ATTRIBUTE_TO_PROP[name.toLowerCase()]
  if (mapped) {
    ctx.notes.change(
      'Some attributes use camelCase',
      'React spells multi-word attributes in camelCase, e.g. `tabindex` → `tabIndex`, `maxlength` → `maxLength`.',
      `${name} → ${mapped}`,
    )
    return mapped
  }
  return name
}

function styleObject(style: string, ctx: JsxContext): string {
  const entries = parseInlineStyle(style).map(([property, value]) => {
    if (/!important\s*$/i.test(value)) {
      ctx.notes.check(
        '`!important` in a style attribute was removed',
        'React\'s `style={{...}}` can\'t express `!important`. Move that rule into your CSS file if you need it.',
        `${ctx.file}: style="${property}: ${value}"`,
      )
      value = value.replace(/\s*!important\s*$/i, '')
    }
    value = value.replace(/url\(\s*(['"]?)([^'")]*?)\1\s*\)/g, (_, q: string, url: string) => `url(${q}${ctx.rewriteUrl(url)}${q})`)
    const key = property.startsWith('--') ? `'${property}'` : camelCase(property.toLowerCase())
    return `${key}: ${jsString(value)}`
  })
  ctx.notes.change(
    '`style="..."` became a style object',
    'In JSX, inline styles are a JavaScript object: `style="font-size: 20px"` becomes ' +
      "`style={{ fontSize: '20px' }}`. Property names use camelCase.",
  )
  return entries.length === 0 ? '{}' : `{ ${entries.join(', ')} }`
}

/** Single-quoted JS string, or double-quoted if the text contains a single quote. */
function jsString(value: string): string {
  if (value.includes("'")) return JSON.stringify(value)
  return `'${value.replaceAll('\\', '\\\\')}'`
}

function rewriteSrcset(srcset: string, ctx: JsxContext): string {
  return srcset
    .split(',')
    .map((candidate) => {
      const [url, ...descriptor] = candidate.trim().split(/\s+/)
      return [ctx.rewriteUrl(url), ...descriptor].join(' ')
    })
    .join(', ')
}

function decodeJavascriptUrl(href: string): string {
  const code = href.replace(/^\s*javascript:/i, '')
  try {
    return decodeURIComponent(code)
  } catch {
    return code
  }
}

/** JSX attribute value: a plain string when safe, otherwise a JS string in braces. */
function quote(value: string): string {
  if (/["\n\\]|&[#a-zA-Z0-9]+;/.test(value)) return `{${JSON.stringify(value)}}`
  return `"${value}"`
}

function escapeText(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('{', '&#123;')
    .replaceAll('}', '&#125;')
    .replaceAll('\u00a0', '&nbsp;')
}
