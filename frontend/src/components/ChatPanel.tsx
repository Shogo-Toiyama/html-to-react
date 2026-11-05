// Step 5: a chat with the AI about the participant's project. Replies stream
// in as they are written; when the AI wants to change code it attaches a
// proposal card, which the participant applies (and can undo) like the step
// suggestions. The conversation is saved in .launchpad/chat.json.

import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import { chatRequestSize, MAX_CHAT_MESSAGE, MAX_CHAT_TURNS, MAX_REQUEST_CHARS, type ChatRequest } from '../lib/aiApi'
import { applySuggestion, readHistory, undoSuggestion } from '../lib/aiChanges'
import { AiRequestError, collectChatFiles, requestChat, savedWorkshopCode, saveWorkshopCode } from '../lib/aiClient'
import { readChat, saveChat, toTurns, type ChatMessage } from '../lib/chatHistory'
import { currentPreviewPath } from '../lib/highlight'

const STARTERS = [
  'Add a dark mode toggle button',
  'Add a “like” button with a counter to each project card',
  'Make the header stick to the top when I scroll',
  'Explain what useState does, using my site as an example',
]

type Busy = { status: string; chars: number } | null

export function ChatPanel({ dir }: { dir: FileSystemDirectoryHandle }) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const messagesRef = useRef<ChatMessage[]>([])
  const [loaded, setLoaded] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState<Busy>(null)
  const [code, setCode] = useState(savedWorkshopCode)
  const [askCode, setAskCode] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    void readChat(dir).then((saved) => {
      if (cancelled) return
      messagesRef.current = saved
      setMessages(saved)
      setLoaded(true)
    })
    return () => {
      cancelled = true
    }
  }, [dir])

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' })
  }, [messages, busy])

  const commit = (next: ChatMessage[]) => {
    messagesRef.current = next
    setMessages(next)
  }
  const patch = (id: string, change: Partial<ChatMessage> | ((m: ChatMessage) => Partial<ChatMessage>)) =>
    commit(
      messagesRef.current.map((m) => (m.id === id ? { ...m, ...(typeof change === 'function' ? change(m) : change) } : m)),
    )
  const persist = () => saveChat(dir, messagesRef.current).catch(() => setNotice('Couldn’t save the chat to your folder.'))

  async function send(text: string, workshopCode = code) {
    const message = text.trim()
    if (!message || busy) return
    if (!workshopCode) {
      setAskCode(true)
      return
    }
    setNotice(null)
    let files
    try {
      files = await collectChatFiles(dir)
    } catch (error) {
      setNotice(`Couldn’t read your files: ${String(error)}`)
      return
    }

    const user: ChatMessage = { id: crypto.randomUUID(), role: 'user', text: message }
    const reply: ChatMessage = { id: crypto.randomUUID(), role: 'assistant', text: '' }
    const history = [...messagesRef.current, user]
    const request: ChatRequest = {
      turns: toTurns(history).slice(-MAX_CHAT_TURNS),
      files,
      page: currentPreviewPath() ?? undefined,
    }
    const size = chatRequestSize(request)
    if (size > MAX_REQUEST_CHARS) {
      const biggest = [...files].sort((a, b) => b.content.length - a.content.length).slice(0, 3)
      setNotice(
        `Your project is too large to send (${Math.round(size / 1000)} KB of code; the limit is ${MAX_REQUEST_CHARS / 1000} KB). ` +
          `Biggest files: ${biggest.map((f) => f.path).join(', ')}. Please ask an organizer for help.`,
      )
      return
    }

    setDraft('')
    commit([...history, reply])
    void persist()
    setBusy({ status: 'Thinking…', chars: 0 })
    try {
      const result = await requestChat(request, workshopCode, {
        onText: (delta) => patch(reply.id, (m) => ({ text: m.text + delta })),
        onStatus: (status) => setBusy((b) => (b ? { ...b, status } : b)),
        onProgress: (chars) => setBusy((b) => (b ? { ...b, chars } : b)),
      })
      if (result) patch(reply.id, { proposal: result.proposal, model: result.model, proposalState: 'pending' })
    } catch (error) {
      if (error instanceof AiRequestError && error.info.code === 'bad-code') {
        saveWorkshopCode('')
        setCode('')
        setAskCode(true)
        // Take the message back so it can be sent again with the right code.
        commit(messagesRef.current.filter((m) => m.id !== user.id && m.id !== reply.id))
        setDraft(message)
      } else {
        patch(reply.id, { error: error instanceof Error ? error.message : String(error) })
      }
    } finally {
      setBusy(null)
      void persist()
    }
  }

  async function apply(message: ChatMessage) {
    if (!message.proposal) return
    try {
      const entry = await applySuggestion(dir, 'chat', message.model ?? '', message.proposal)
      patch(message.id, { proposalState: 'applied', historyId: entry.id })
    } catch (error) {
      setNotice(`Couldn’t write the files: ${String(error)}`)
    }
    void persist()
  }

  async function undo(message: ChatMessage) {
    const entry = (await readHistory(dir)).find((e) => e.id === message.historyId)
    if (!entry) {
      setNotice('Couldn’t find this change in .launchpad/history.json.')
      return
    }
    try {
      await undoSuggestion(dir, entry)
      patch(message.id, { proposalState: 'undone' })
    } catch (error) {
      setNotice(`Couldn’t undo: ${String(error)}`)
    }
    void persist()
  }

  function discard(message: ChatMessage) {
    patch(message.id, { proposalState: 'discarded' })
    void persist()
  }

  function clear() {
    if (!window.confirm('Start a new chat? The AI forgets this conversation (applied changes stay).')) return
    commit([])
    setNotice(null)
    void persist()
  }

  if (!loaded) return <p className="ai-file">Loading the chat…</p>

  return (
    <section className="chat">
      {messages.length === 0 ? (
        <div className="chat-empty">
          <p>Ask for a feature, a change in style, a bug fix, or how something works. For example:</p>
          <div className="chat-starters">
            {STARTERS.map((starter) => (
              <button key={starter} type="button" className="chat-starter" onClick={() => setDraft(starter)}>
                {starter}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="chat-log">
          {messages.map((message, index) =>
            message.role === 'user' ? (
              <div key={message.id} className="chat-msg user">
                {message.text}
              </div>
            ) : (
              <div key={message.id} className="chat-msg assistant">
                {message.text && <RichText text={message.text} />}
                {busy && index === messages.length - 1 && (
                  <div className="ai-working">
                    <div className="spinner small" aria-hidden="true" />
                    <span>
                      {busy.status}
                      {busy.chars > 0 && ` (${busy.chars.toLocaleString()} characters)`}
                    </span>
                  </div>
                )}
                {message.error && <p className="notice">{message.error}</p>}
                {message.proposal && (
                  <ProposalCard
                    message={message}
                    onApply={() => void apply(message)}
                    onUndo={() => void undo(message)}
                    onDiscard={() => discard(message)}
                  />
                )}
              </div>
            ),
          )}
        </div>
      )}
      <div ref={endRef} />

      {notice && <p className="notice">{notice}</p>}

      {askCode ? (
        <form
          className="ai-code"
          onSubmit={(event) => {
            event.preventDefault()
            const trimmed = code.trim()
            saveWorkshopCode(trimmed)
            setAskCode(false)
            if (draft.trim()) void send(draft, trimmed)
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
      ) : (
        <form
          className="chat-input"
          onSubmit={(event) => {
            event.preventDefault()
            void send(draft)
          }}
        >
          <textarea
            value={draft}
            maxLength={MAX_CHAT_MESSAGE}
            rows={3}
            placeholder="Ask AI about your site…  (Enter to send, Shift+Enter for a new line)"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault()
                void send(draft)
              }
            }}
          />
          <div className="chat-input-bar">
            {messages.length > 0 && (
              <button type="button" className="link-button" onClick={clear} disabled={!!busy}>
                New chat
              </button>
            )}
            <button type="submit" className="button primary" disabled={!!busy || !draft.trim()}>
              {busy ? 'Working…' : 'Send'}
            </button>
          </div>
        </form>
      )}
    </section>
  )
}

function ProposalCard(props: { message: ChatMessage; onApply(): void; onUndo(): void; onDiscard(): void }) {
  const { message, onApply, onUndo, onDiscard } = props
  const proposal = message.proposal!
  const state = message.proposalState ?? 'pending'
  return (
    <div className={`chat-proposal ${state}`}>
      <h4>✨ Proposed change</h4>
      <p>{proposal.summary}</p>
      <ul className="ai-changes">
        {proposal.changes.map((change) => {
          const file = proposal.files.find((f) => f.path === change.path)
          return (
            <li key={change.path}>
              <span className={`ai-tag ${change.action}`}>{change.action === 'created' ? 'new' : 'changed'}</span>{' '}
              <code>{change.path}</code>
              <div>{change.description}</div>
              {file && (
                <details>
                  <summary>Show code</summary>
                  <pre className="guide-code">
                    <code>{file.content}</code>
                  </pre>
                </details>
              )}
            </li>
          )
        })}
      </ul>
      <div className="actions">
        {state === 'pending' && (
          <>
            <button type="button" className="button primary" onClick={onApply}>
              Apply
            </button>
            <button type="button" className="button" onClick={onDiscard}>
              Discard
            </button>
          </>
        )}
        {state === 'applied' && (
          <>
            <span className="chat-state ok">✓ Applied. Open the files in VS Code to see the code.</span>
            <button type="button" className="button" onClick={onUndo}>
              Undo
            </button>
          </>
        )}
        {state === 'undone' && (
          <>
            <span className="chat-state">Undone.</span>
            <button type="button" className="button" onClick={onApply}>
              Apply again
            </button>
          </>
        )}
        {state === 'discarded' && (
          <>
            <span className="chat-state">Discarded.</span>
            <button type="button" className="button" onClick={onApply}>
              Apply anyway
            </button>
          </>
        )}
      </div>
    </div>
  )
}

/** A small Markdown subset: paragraphs, lists, ``` code blocks, `code` and **bold**. */
function RichText({ text }: { text: string }) {
  const blocks: ReactNode[] = []
  const parts = text.split(/```[\w-]*\n?/)
  parts.forEach((part, i) => {
    if (i % 2 === 1) {
      blocks.push(
        <pre key={i} className="guide-code">
          <code>{part.replace(/\n$/, '')}</code>
        </pre>,
      )
      return
    }
    part
      .split(/\n{2,}/)
      .filter((para) => para.trim())
      .forEach((para, j) => {
        const lines = para.split('\n').filter((line) => line.trim())
        const bullet = /^\s*(?:[-*•]|\d+\.)\s+/
        if (lines.every((line) => bullet.test(line))) {
          const ordered = /^\s*\d+\./.test(lines[0])
          const items = lines.map((line, k) => <li key={k}>{inline(line.replace(bullet, ''))}</li>)
          blocks.push(ordered ? <ol key={`${i}-${j}`}>{items}</ol> : <ul key={`${i}-${j}`}>{items}</ul>)
        } else {
          blocks.push(
            <p key={`${i}-${j}`}>
              {lines.map((line, k) => (
                <Fragment key={k}>
                  {k > 0 && <br />}
                  {inline(line.replace(/^#+\s*/, ''))}
                </Fragment>
              ))}
            </p>,
          )
        }
      })
  })
  return <>{blocks}</>
}

function inline(text: string): ReactNode[] {
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*)/).map((piece, i) => {
    if (piece.startsWith('`') && piece.endsWith('`') && piece.length > 1) return <code key={i}>{piece.slice(1, -1)}</code>
    if (piece.startsWith('**') && piece.endsWith('**') && piece.length > 3) return <strong key={i}>{piece.slice(2, -2)}</strong>
    return piece
  })
}
