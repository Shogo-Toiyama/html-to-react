// Checks the model's answer before it reaches a participant's folder. Problems
// are sent back to the model once so it can fix them.

import { Parser } from 'acorn'
import jsx from 'acorn-jsx'
import type { ProjectFile, SuggestRequest, Suggestion } from '../src/lib/aiApi'

const JsxParser = Parser.extend(jsx())

export function validateSuggestion(request: SuggestRequest, suggestion: Suggestion): string[] {
  const errors: string[] = []
  const editable = new Set(request.editable.map((file) => file.path))

  // ---- Paths ----
  for (const file of suggestion.files) {
    const isNewComponent = /^src\/components\/[A-Za-z0-9_/-]+\.jsx$/.test(file.path) && !file.path.includes('..')
    if (!editable.has(file.path) && !isNewComponent) {
      errors.push(`${file.path}: you may only change the editable files or create .jsx files in src/components/.`)
    }
  }
  const returned = new Set(suggestion.files.map((file) => file.path))
  for (const change of suggestion.changes) {
    if (!returned.has(change.path)) errors.push(`changes lists ${change.path}, but files doesn't include it.`)
  }
  for (const path of returned) {
    if (!suggestion.changes.some((change) => change.path === path)) errors.push(`${path} is in files but not in changes.`)
  }

  // ---- Syntax ----
  for (const file of suggestion.files) {
    try {
      JsxParser.parse(file.content, { ecmaVersion: 'latest', sourceType: 'module' })
    } catch (error) {
      errors.push(`${file.path}: JSX syntax error: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  // ---- Nothing the legacy script needs may disappear ----
  const final = finalProject(request, suggestion)
  const allCode = [...final.values()].join('\n')
  const originalCode = request.editable.map((file) => file.content).join('\n')
  for (const id of matches(originalCode, /\bid=["']([^"']+)["']/g)) {
    if (!allCode.includes(`"${id}"`) && !allCode.includes(`'${id}'`)) errors.push(`The id "${id}" is missing.`)
  }
  for (const className of matches(originalCode, /\bclassName=["']([^"']+)["']/g)) {
    if (!allCode.includes(className)) errors.push(`The className "${className}" is missing.`)
  }
  for (const name of matches(originalCode, /\bwindow\.(\w+)\s*\(/g)) {
    if (!allCode.includes(`window.${name}`)) errors.push(`The call window.${name}(...) is missing.`)
  }

  // ---- Imports point at files that exist ----
  for (const file of suggestion.files) {
    for (const specifier of matches(file.content, /\bfrom\s+["'](\.{1,2}\/[^"']+)["']/g)) {
      if (!/\.(jsx|js)$/.test(specifier)) continue
      const target = resolve(file.path, specifier)
      if (!final.has(target) && !request.context.some((f) => f.path === target)) {
        errors.push(`${file.path} imports ${specifier}, but ${target} doesn't exist.`)
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

function resolve(from: string, specifier: string): string {
  const parts = from.split('/').slice(0, -1)
  for (const part of specifier.split('/')) {
    if (part === '.' || part === '') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return parts.join('/')
}
