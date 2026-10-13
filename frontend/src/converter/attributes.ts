// HTML → React naming tables.

/** HTML attributes whose React prop name differs (besides class/for). */
export const HTML_ATTRIBUTE_TO_PROP: Record<string, string> = {
  'accept-charset': 'acceptCharset',
  accesskey: 'accessKey',
  allowfullscreen: 'allowFullScreen',
  autocapitalize: 'autoCapitalize',
  autocomplete: 'autoComplete',
  autofocus: 'autoFocus',
  autoplay: 'autoPlay',
  cellpadding: 'cellPadding',
  cellspacing: 'cellSpacing',
  charset: 'charSet',
  colspan: 'colSpan',
  contenteditable: 'contentEditable',
  controlslist: 'controlsList',
  crossorigin: 'crossOrigin',
  datetime: 'dateTime',
  enctype: 'encType',
  enterkeyhint: 'enterKeyHint',
  fetchpriority: 'fetchPriority',
  formaction: 'formAction',
  formenctype: 'formEncType',
  formmethod: 'formMethod',
  formnovalidate: 'formNoValidate',
  formtarget: 'formTarget',
  frameborder: 'frameBorder',
  hreflang: 'hrefLang',
  'http-equiv': 'httpEquiv',
  inputmode: 'inputMode',
  itemprop: 'itemProp',
  itemscope: 'itemScope',
  itemtype: 'itemType',
  marginheight: 'marginHeight',
  marginwidth: 'marginWidth',
  maxlength: 'maxLength',
  minlength: 'minLength',
  nomodule: 'noModule',
  novalidate: 'noValidate',
  playsinline: 'playsInline',
  popovertarget: 'popoverTarget',
  popovertargetaction: 'popoverTargetAction',
  readonly: 'readOnly',
  referrerpolicy: 'referrerPolicy',
  rowspan: 'rowSpan',
  spellcheck: 'spellCheck',
  srcdoc: 'srcDoc',
  srclang: 'srcLang',
  srcset: 'srcSet',
  tabindex: 'tabIndex',
  usemap: 'useMap',
}

/** Attributes React expects as `true`/absent rather than a string. */
export const BOOLEAN_PROPS = new Set([
  'allowFullScreen',
  'async',
  'autoFocus',
  'autoPlay',
  'controls',
  'default',
  'defer',
  'disabled',
  'formNoValidate',
  'hidden',
  'inert',
  'itemScope',
  'loop',
  'multiple',
  'muted',
  'noModule',
  'noValidate',
  'open',
  'playsInline',
  'readOnly',
  'required',
  'reversed',
  'defaultChecked',
])

/** DOM event names (after `on`) whose React name isn't just capitalized. */
const SPECIAL_EVENTS: Record<string, string> = {
  dblclick: 'onDoubleClick',
}

/** Common DOM events, in lowercase, mapped to React's camelCase prop name. */
const EVENT_WORDS = [
  'click', 'contextmenu', 'mousedown', 'mouseup', 'mousemove', 'mouseover', 'mouseout', 'mouseenter',
  'mouseleave', 'keydown', 'keyup', 'keypress', 'change', 'input', 'submit', 'reset', 'focus', 'blur',
  'scroll', 'wheel', 'load', 'error', 'drag', 'dragstart', 'dragend', 'dragenter', 'dragleave',
  'dragover', 'drop', 'touchstart', 'touchmove', 'touchend', 'touchcancel', 'pointerdown', 'pointerup',
  'pointermove', 'pointerover', 'pointerout', 'pointerenter', 'pointerleave', 'pointercancel',
  'animationstart', 'animationend', 'animationiteration', 'transitionend', 'play', 'pause', 'ended',
  'canplay', 'timeupdate', 'volumechange', 'toggle', 'invalid', 'select', 'copy', 'cut', 'paste',
  'beforeinput',
]

const CAMEL_PARTS: Record<string, string> = {
  contextmenu: 'ContextMenu',
  beforeinput: 'BeforeInput',
  canplay: 'CanPlay',
  timeupdate: 'TimeUpdate',
  volumechange: 'VolumeChange',
  transitionend: 'TransitionEnd',
}

const EVENT_PREFIXES = ['mouse', 'key', 'drag', 'touch', 'pointer', 'animation']

function camelEvent(word: string): string {
  if (CAMEL_PARTS[word]) return CAMEL_PARTS[word]
  for (const prefix of EVENT_PREFIXES) {
    if (word.startsWith(prefix) && word.length > prefix.length) {
      const rest = word.slice(prefix.length)
      return capitalize(prefix) + capitalize(rest)
    }
  }
  return capitalize(word)
}

const EVENT_PROPS: Record<string, string> = Object.fromEntries(
  EVENT_WORDS.map((word) => [word, SPECIAL_EVENTS[word] ?? 'on' + camelEvent(word)]),
)

/** `onclick` → `onClick`. Returns null for attributes that aren't inline event handlers. */
export function eventPropName(attributeName: string): string | null {
  if (!attributeName.startsWith('on')) return null
  const word = attributeName.slice(2)
  return EVENT_PROPS[word] ?? null
}

export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** `stroke-width` → `strokeWidth`, `-webkit-transition` → `WebkitTransition`, `-ms-x` → `msX`. */
export function camelCase(name: string): string {
  const withoutMs = name.startsWith('-ms-') ? name.slice(1) : name
  return withoutMs.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())
}

/** Elements that never have children; JSX needs them self-closed (`<img />`). */
export const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr',
])

/**
 * Elements that start their own line. Whitespace between them never shows on
 * screen, so it can be dropped; between inline elements it must be kept.
 */
export const BLOCK_ELEMENTS = new Set([
  'address', 'article', 'aside', 'blockquote', 'body', 'caption', 'col', 'colgroup', 'dd', 'details',
  'dialog', 'div', 'dl', 'dt', 'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3',
  'h4', 'h5', 'h6', 'head', 'header', 'hgroup', 'hr', 'html', 'legend', 'li', 'main', 'menu', 'nav',
  'noscript', 'ol', 'optgroup', 'option', 'p', 'pre', 'section', 'summary', 'table', 'tbody', 'td',
  'template', 'tfoot', 'th', 'thead', 'tr', 'ul', 'video', 'canvas', 'iframe', 'select', 'datalist',
  'br',
])

/** Elements whose direct children can't include text, so whitespace inside is meaningless. */
export const NO_TEXT_CHILDREN = new Set([
  'ul', 'ol', 'dl', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'colgroup', 'select', 'optgroup',
  'datalist', 'picture', 'audio', 'video', 'menu', 'head', 'html',
])
