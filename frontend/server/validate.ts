// Checks the model's answer before it reaches a participant's folder. Problems
// are sent back to the model once so it can fix them.

import { Parser } from 'acorn'
import jsx from 'acorn-jsx'
import type { ChatProposal, ChatRequest, ProjectFile, SuggestRequest, Suggestion } from '../src/lib/aiApi'

const JsxParser = Parser.extend(jsx())

export function validateSuggestion(request: SuggestRequest, suggestion: Suggestion): string[] {
  const errors: string[] = []
  const editable = new Set(request.editable.map((file) => file.path))
  const legacyCode = request.context
    .filter((file) => /legacy-script\.js$/.test(file.path))
    .map((file) => file.content)
    .join('\n')

  // ---- Paths: which files this step may write ----
  for (const file of suggestion.files) {
    const isNewComponent = /^src\/components\/[A-Za-z0-9_/-]+\.jsx$/.test(file.path) && !file.path.includes('..')
    const allowed =
      request.step === 'components' || request.step === 'props' ? editable.has(file.path) || isNewComponent : editable.has(file.path)
    if (!allowed) {
      errors.push(
        request.step === 'components' || request.step === 'props'
          ? `${file.path}: you may only change the editable files or create .jsx files in src/components/.`
          : `${file.path}: you may only change the editable files.`,
      )
    }
  }
  const returned = new Set(suggestion.files.map((file) => file.path))
  for (const change of suggestion.changes) {
    if (!returned.has(change.path)) errors.push(`changes lists ${change.path}, but files doesn't include it.`)
  }
  for (const path of returned) {
    if (!suggestion.changes.some((change) => change.path === path)) errors.push(`${path} is in files but not in changes.`)
  }

  if (request.step === 'tailwind-cleanup') {
    errors.push(...validateCssCleanup(request, suggestion))
    return errors
  }

  // ---- JSX steps ----
  const final = finalProject(request, suggestion)
  errors.push(
    // CSS files aren't sent in these steps, so CSS imports can't be checked.
    ...checkCode(
      suggestion.files,
      (path) => path.endsWith('.css') || final.has(path) || request.context.some((f) => f.path === path),
    ),
  )

  // Nothing the legacy script needs may disappear.
  const allCode = [...final.values()].join('\n')
  const originalCode = request.editable.map((file) => file.content).join('\n')
  for (const id of matches(originalCode, /\bid=["']([^"']+)["']/g)) {
    if (!allCode.includes(`"${id}"`) && !allCode.includes(`'${id}'`)) errors.push(`The id "${id}" is missing.`)
  }
  for (const name of matches(originalCode, /\bwindow\.(\w+)\s*\(/g)) {
    if (!allCode.includes(`window.${name}`)) errors.push(`The call window.${name}(...) is missing.`)
  }
  const originalClasses = new Set(
    [...matches(originalCode, /\bclassName=["']([^"']+)["']/g)].flatMap((value) => value.split(/\s+/).filter(Boolean)),
  )
  for (const className of originalClasses) {
    // Tailwind replaces classes on purpose, but must keep the ones the legacy script uses.
    const required = request.step !== 'tailwind' || usesWord(legacyCode, className)
    if (required && !usesWord(allCode, className)) {
      errors.push(
        request.step === 'tailwind'
          ? `The class "${className}" is used by the legacy script, so it must stay.`
          : `The className "${className}" is missing.`,
      )
    }
  }

  return errors
}

/**
 * Checks for JS/JSX files: they parse, every <Component> tag is imported or
 * defined (else "X is not defined" at runtime), and relative imports of
 * .js/.jsx/.css files point at files that exist.
 */
function checkCode(files: ProjectFile[], exists: (path: string) => boolean): string[] {
  const errors: string[] = []
  for (const file of files.filter((f) => /\.jsx?$/.test(f.path))) {
    try {
      JsxParser.parse(file.content, { ecmaVersion: 'latest', sourceType: 'module' })
    } catch (error) {
      errors.push(`${file.path}: JSX syntax error: ${error instanceof Error ? error.message : String(error)}`)
    }
    const known = new Set([
      ...matches(file.content, /\bimport\s+([A-Z]\w*)/g),
      ...[...file.content.matchAll(/\bimport\s*(?:\w+\s*,\s*)?\{([^}]*)\}/g)].flatMap((m) =>
        m[1].split(',').map((part) => part.trim().split(/\s+as\s+/).pop()!.trim()),
      ),
      ...matches(file.content, /\b(?:function|const|let|class)\s+([A-Z]\w*)/g),
    ])
    for (const tag of matches(file.content, /<([A-Z]\w*)[\s/>]/g)) {
      if (!known.has(tag)) errors.push(`${file.path} uses <${tag}> but doesn't import or define it.`)
    }
    for (const specifier of matches(file.content, /\b(?:from\s+|import\s+)["'](\.{1,2}\/[^"']+)["']/g)) {
      if (!/\.(jsx|js|css)$/.test(specifier)) continue
      const target = resolve(file.path, specifier)
      if (!exists(target)) errors.push(`${file.path} imports ${specifier}, but ${target} doesn't exist.`)
    }
  }
  return errors
}

/**
 * A change proposed in the chat (Step 5): files only in src/, code that parses,
 * imports that resolve, and no packages that aren't installed.
 */
export function validateChatProposal(request: ChatRequest, proposal: ChatProposal): string[] {
  const errors: string[] = []
  if (typeof proposal?.summary !== 'string' || !Array.isArray(proposal.changes) || !Array.isArray(proposal.files)) {
    return ['The proposal must have summary, changes and files.']
  }
  for (const file of proposal.files) {
    if (typeof file?.path !== 'string' || typeof file.content !== 'string') {
      errors.push('Every file needs a path and content.')
      continue
    }
    if (!/^src\/[A-Za-z0-9_./ -]+\.(jsx|js|css)$/.test(file.path) || file.path.split('/').includes('..')) {
      errors.push(`${file.path}: you may only change or create .jsx, .js or .css files in src/.`)
    }
  }
  if (errors.length > 0) return errors
  const returned = new Set(proposal.files.map((file) => file.path))
  for (const change of proposal.changes) {
    if (!returned.has(change.path)) errors.push(`changes lists ${change.path}, but files doesn't include it.`)
  }
  for (const path of returned) {
    if (!proposal.changes.some((change) => change.path === path)) errors.push(`${path} is in files but not in changes.`)
  }

  const final = new Map(request.files.map((file) => [file.path, file.content]))
  for (const file of proposal.files) final.set(file.path, file.content)
  errors.push(...checkCode(proposal.files, (path) => final.has(path)))

  // New packages would need an install; not supported in the workshop.
  const pkg = request.files.find((file) => file.path === 'package.json')
  let installed = new Set<string>()
  try {
    const json = JSON.parse(pkg?.content ?? '{}')
    installed = new Set(Object.keys({ ...json.dependencies, ...json.devDependencies }))
  } catch {
    // No package.json to check against.
  }
  for (const file of proposal.files.filter((f) => /\.jsx?$/.test(f.path))) {
    for (const specifier of matches(file.content, /\b(?:from\s+|import\s+)["']([^."'/][^"']*)["']/g)) {
      const name = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]
      if (pkg && !installed.has(name)) {
        errors.push(`${file.path} imports "${specifier}", which isn't installed. Don't add packages; write it with React and CSS.`)
      }
    }
  }
  return errors
}

/** The CSS cleanup may only remove rules nothing uses, and must keep Tailwind's own lines. */
function validateCssCleanup(request: SuggestRequest, suggestion: Suggestion): string[] {
  const errors: string[] = []
  const jsxCode = request.context.filter((file) => /\.jsx$/.test(file.path)).map((file) => file.content).join('\n')
  const legacyCode = request.context.filter((file) => /legacy-script\.js$/.test(file.path)).map((file) => file.content).join('\n')
  const usedClasses = new Set(
    [...matches(jsxCode, /\bclassName=["']([^"']+)["']/g)].flatMap((value) => value.split(/\s+/).filter(Boolean)),
  )
  for (const file of suggestion.files) {
    const before = request.editable.find((f) => f.path === file.path)?.content ?? ''
    if (/@import\s+["']tailwindcss/.test(before) && !/@import\s+["']tailwindcss/.test(file.content)) {
      errors.push(`${file.path}: keep the Tailwind @import lines.`)
    }
    let depth = 0
    for (const char of file.content) {
      if (char === '{') depth += 1
      if (char === '}') depth -= 1
      if (depth < 0) break
    }
    if (depth !== 0) errors.push(`${file.path}: the CSS braces { } don't match.`)
    for (const className of matches(before, /\.([A-Za-z_][\w-]*)/g)) {
      const stillUsed = usedClasses.has(className) || usesWord(legacyCode, className)
      if (stillUsed && !new RegExp(`\\.${escapeRegExp(className)}(?![\\w-])`).test(file.content)) {
        errors.push(`${file.path}: .${className} is still used, so its rules must stay.`)
      }
    }
  }
  return errors
}

/** Every file path → content after applying the suggestion. */
function finalProject(request: SuggestRequest, suggestion: Suggestion): Map<string, string> {
  const files = new Map<string, string>(request.editable.map((file: ProjectFile) => [file.path, file.content]))
  for (const file of suggestion.files) files.set(file.path, file.content)
  return files
}

function matches(text: string, pattern: RegExp): Set<string> {
  return new Set([...text.matchAll(pattern)].map((match) => match[1]))
}

/** `word` appears in `text` as a whole class-name-like token. */
function usesWord(text: string, word: string): boolean {
  return new RegExp(`(^|[^\\w-])${escapeRegExp(word)}(?![\\w-])`).test(text)
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function resolve(from: string, specifier: string): string {
  const parts = from.split('/').slice(0, -1)
  for (const part of specifier.split('/')) {
    if (part === '.' || part === '') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return parts.join('/')
}
