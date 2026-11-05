// "Ask AI" box used in the Components, Props and Tailwind steps: Claude
// suggests a change, the participant reviews it, and Apply writes it to their
// folder (with Undo). Every applied change is logged in .launchpad/history.json.

import { useEffect, useState } from 'react'
import { MAX_REQUEST_CHARS, requestSize, type AiStep, type SuggestRequest, type Suggestion } from '../lib/aiApi'
import { applySuggestion, readHistory, undoSuggestion, type AiHistoryEntry } from '../lib/aiChanges'
import { AiRequestError, collectRequest, requestSuggestion, savedWorkshopCode, saveWorkshopCode } from '../lib/aiClient'

export interface AiCopy {
  title: string
  button: string
  intro: string
}

const COPY: Record<'components' | 'props', AiCopy> = {
  components: {
    title: 'Ask AI to split your page',
    button: 'Suggest components',
    intro: 'AI looks at your page and suggests how to split it into components, each big one in its own file.',
  },
  props: {
    title: 'Ask AI to use props',
    button: 'Suggest props',
    intro: 'AI finds parts that repeat and turns each into one component that takes props.',
  },
}

type State =
  | { kind: 'idle' }
  | { kind: 'code' }
  | { kind: 'too-large'; request: SuggestRequest; size: number }
  | { kind: 'working'; message: string; chars: number }
  | { kind: 'review'; suggestion: Suggestion; model: string }
  | { kind: 'applying' }
  | { kind: 'applied'; entry: AiHistoryEntry }
  | { kind: 'error'; message: string }

interface AiSuggestProps {
  dir: FileSystemDirectoryHandle
  step: AiStep
  /** For `tailwind`: the file to convert, or WHOLE_SITE. Runs and history are kept per target. */
  target?: string
  /** Text for steps without a default (the Tailwind step). */
  copy?: AiCopy
  /** Called after Apply or Undo, so a parent can refresh what it shows. */
  onChange?(): void
}

export function AiSuggest({ dir, step, target, copy: customCopy, onChange }: AiSuggestProps) {
  const [state, setState] = useState<State>({ kind: 'idle' })
  const [code, setCode] = useState(savedWorkshopCode)
  const [history, setHistory] = useState<AiHistoryEntry[]>([])
  const copy = customCopy ?? COPY[step as 'components' | 'props']

  useEffect(() => {
    let cancelled = false
    void readHistory(dir).then((entries) => !cancelled && setHistory(entries))
    return () => {
      cancelled = true
    }
  }, [dir])

  async function start(workshopCode = code) {
    if (!workshopCode) {
      setState({ kind: 'code' })
      return
    }
    setState({ kind: 'working', message: 'Reading your files…', chars: 0 })
    let request: SuggestRequest
    try {
      request = await collectRequest(dir, step, target)
    } catch (error) {
      setState({ kind: 'error', message: `Couldn’t read your files: ${String(error)}` })
      return
    }
    if (request.editable.length === 0) {
      setState({ kind: 'error', message: 'No files to work on were found.' })
      return
    }
    const size = requestSize(request)
    if (size > MAX_REQUEST_CHARS) {
      setState({ kind: 'too-large', request, size })
      return
    }
    try {
      const { suggestion, model } = await requestSuggestion(request, workshopCode, (progress) =>
        setState((current) =>
          current.kind !== 'working'
            ? current
            : progress.type === 'status'
              ? { ...current, message: progress.message }
              : { ...current, chars: progress.chars },
        ),
      )
      setState({ kind: 'review', suggestion, model })
    } catch (error) {
      if (error instanceof AiRequestError && error.info.code === 'bad-code') {
        saveWorkshopCode('')
        setCode('')
        setState({ kind: 'code' })
        return
      }
      setState({ kind: 'error', message: error instanceof Error ? error.message : String(error) })
    }
  }

  async function apply(suggestion: Suggestion, model: string) {
    setState({ kind: 'applying' })
    try {
      const entry = await applySuggestion(dir, step, model, suggestion, target)
      setHistory((h) => [...h, entry])
      setState({ kind: 'applied', entry })
      onChange?.()
    } catch (error) {
      setState({ kind: 'error', message: `Couldn’t write the files: ${String(error)}` })
    }
  }

  async function undo(entry: AiHistoryEntry) {
    try {
      const undone = await undoSuggestion(dir, entry)
      setHistory((h) => h.map((e) => (e.id === undone.id ? undone : e)))
      setState({ kind: 'idle' })
      onChange?.()
    } catch (error) {
      setState({ kind: 'error', message: `Couldn’t undo: ${String(error)}` })
    }
  }

  const pastForStep = history.filter((entry) => entry.step === step && (entry.target ?? undefined) === target)
  /** The latest suggestion applied in this step and not undone. */
  const lastApplied = pastForStep.findLast((entry) => !entry.undoneAt)

  return (
    <section className="ai-box">
      <h3>✨ {copy.title}</h3>

      {(state.kind === 'idle' || state.kind === 'error') &&
        (lastApplied ? (
          // Already done for this step (e.g. after reloading Launchpad): don't invite a second split.
          <>
            <p>
              ✓ You applied an AI suggestion here on {new Date(lastApplied.appliedAt).toLocaleString()}. It changed:
            </p>
            <ul className="ai-changes">
              {lastApplied.changes.map((change) => (
                <li key={change.path}>
                  <span className={`ai-tag ${change.action}`}>{change.action === 'created' ? 'new' : 'changed'}</span>{' '}
                  <code>{change.path}</code>
                </li>
              ))}
            </ul>
            {state.kind === 'error' && <p className="notice">{state.message}</p>}
            <div className="actions">
              <button type="button" className="button" onClick={() => void undo(lastApplied)}>
                Undo
              </button>
              <button type="button" className="button" onClick={() => void start()}>
                Suggest again
              </button>
            </div>
          </>
        ) : (
          <>
            <p>{copy.intro} You can review it before anything changes.</p>
            {state.kind === 'error' && <p className="notice">{state.message}</p>}
            <button type="button" className="button primary" onClick={() => void start()}>
              {copy.button}
            </button>
          </>
        ))}

      {state.kind === 'code' && (
        <form
          className="ai-code"
          onSubmit={(event) => {
            event.preventDefault()
            const trimmed = code.trim()
            saveWorkshopCode(trimmed)
            void start(trimmed)
          }}
        >
          <label>
            Workshop code
            <input value={code} onChange={(event) => setCode(event.target.value)} placeholder="From the slides" autoFocus />
          </label>
          <button type="submit" className="button primary" disabled={!code.trim()}>
            Continue
          </button>
        </form>
      )}

      {state.kind === 'too-large' && (
        <div className="notice-box">
          <p>
            <strong>Your project is too large to send</strong> ({Math.round(state.size / 1000)} KB of code; the limit is{' '}
            {MAX_REQUEST_CHARS / 1000} KB). Nothing was sent. The biggest files:
          </p>
          <ul>
            {[...state.request.editable, ...state.request.context]
              .sort((a, b) => b.content.length - a.content.length)
              .slice(0, 5)
              .map((file) => (
                <li key={file.path}>
                  <code>{file.path}</code> ({Math.round(file.content.length / 1000)} KB)
                </li>
              ))}
          </ul>
          <p>Please ask an organizer for help.</p>
          <button type="button" className="button" onClick={() => setState({ kind: 'idle' })}>
            OK
          </button>
        </div>
      )}

      {state.kind === 'working' && (
        <div className="ai-working">
          <div className="spinner small" aria-hidden="true" />
          <span>
            {state.message}
            {state.chars > 0 && ` (${state.chars.toLocaleString()} characters written)`}
          </span>
        </div>
      )}

      {state.kind === 'review' && (
        <div className="ai-review">
          <p>{state.suggestion.summary}</p>
          {state.suggestion.components.length > 0 && (
            <>
              <h4>Components</h4>
              <ul className="ai-components">
                {state.suggestion.components.map((component) => (
                  <li key={component.name}>
                    <code>&lt;{component.name} /&gt;</code>
                    {component.props.length > 0 && <span className="ai-props"> props: {component.props.join(', ')}</span>}
                    <div>{component.description}</div>
                    <div className="ai-file">{component.file}</div>
                  </li>
                ))}
              </ul>
            </>
          )}
          {state.suggestion.files.length === 0 ? (
            <p>
              <strong>No changes needed.</strong> Nothing in your files will change.
            </p>
          ) : (
            <h4>Files</h4>
          )}
          <ul className="ai-changes">
            {state.suggestion.changes.map((change) => (
              <li key={change.path}>
                <span className={`ai-tag ${change.action}`}>{change.action === 'created' ? 'new' : 'changed'}</span>{' '}
                <code>{change.path}</code>
                <div>{change.description}</div>
              </li>
            ))}
          </ul>
          <div className="actions">
            {state.suggestion.files.length > 0 && (
              <button
                type="button"
                className="button primary"
                onClick={() => void apply(state.suggestion, state.model)}
              >
                Apply
              </button>
            )}
            <button type="button" className="button" onClick={() => setState({ kind: 'idle' })}>
              Discard
            </button>
          </div>
        </div>
      )}

      {state.kind === 'applying' && <p>Writing files…</p>}

      {state.kind === 'applied' && (
        <div className="ai-review">
          <p>✓ Applied. The preview updated. Open these files in VS Code to see what changed:</p>
          <ul className="ai-changes">
            {state.entry.changes.map((change) => (
              <li key={change.path}>
                <span className={`ai-tag ${change.action}`}>{change.action === 'created' ? 'new' : 'changed'}</span>{' '}
                <code>{change.path}</code>
              </li>
            ))}
          </ul>
          <div className="actions">
            <button type="button" className="button" onClick={() => void undo(state.entry)}>
              Undo
            </button>
            <button type="button" className="button" onClick={() => setState({ kind: 'idle' })}>
              Done
            </button>
          </div>
        </div>
      )}

      {pastForStep.length > 0 && (
        <details className="ai-history">
          <summary>Change log ({pastForStep.length})</summary>
          <ol>
            {pastForStep.map((entry) => (
              <li key={entry.id}>
                <div className="ai-file">
                  {new Date(entry.appliedAt).toLocaleString()} {entry.undoneAt && '· undone'}
                </div>
                <div>{entry.summary}</div>
                <ul>
                  {entry.changes.map((change) => (
                    <li key={change.path}>
                      <code>{change.path}</code>: {change.description}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
          <p className="ai-file">Saved in .launchpad/history.json</p>
        </details>
      )}
    </section>
  )
}
