// Step 5: a chat with the AI about the participant's project. Replies stream
// in as they are written; when the AI wants to change code it attaches a
// proposal card, which the participant applies (and can undo) like the step
// suggestions. The conversation is saved in .launchpad/chat.json.

import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  chatRequestSize,
  MAX_CHAT_MESSAGE,
  MAX_CHAT_TURNS,
  MAX_REQUEST_CHARS,
  type ChatProposal,
  type ChatRequest,
} from '../lib/aiApi'
import { applySuggestion, readHistory, undoSuggestion } from '../lib/aiChanges'
import {
  AiRequestError,
  collectChatFiles,
  listComponentFiles,
  requestChat,
  savedWorkshopCode,
  saveWorkshopCode,
} from '../lib/aiClient'
import { readChat, saveChat, toTurns, type ChatAttachment, type ChatMessage } from '../lib/chatHistory'
import { onChatInbox, takeChatInbox, type ChatError } from '../lib/chatInbox'
import { writeDraft, type DraftResult } from '../lib/drafts'
import { currentPreviewBase, currentPreviewPath, highlightComponent, onPicked, requestPick } from '../lib/highlight'

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
  const [attachments, setAttachments] = useState<ChatAttachment[]>([])
  const [picking, setPicking] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // "Ask AI to fix" on a preview error: attach the error (it may have been sent before this panel opened).
  useEffect(() => {
    const receive = (error: ChatError | null) => {
      if (!error) return
      const attachment: ChatAttachment = {
        kind: 'error',
        errorKind: error.kind,
        message: error.message.slice(0, 3000),
        page: error.page,
      }
      setAttachments((current) => [...current.filter((a) => a.kind !== 'error'), attachment])
      inputRef.current?.focus()
    }
    receive(takeChatInbox())
    return onChatInbox(() => receive(takeChatInbox()))
  }, [])

  // A component picked in the preview.
  useEffect(() => {
    const off = onPicked((picked) => {
      setPicking(false)
      if (!picked) return
      void listComponentFiles(dir)
        .catch(() => [] as string[])
        .then((files) => {
          const file = files.find((path) => path.split('/').pop() === `${picked.name}.jsx`)
          const attachment: ChatAttachment = { kind: 'component', name: picked.name, label: picked.label, file }
          setAttachments((current) => [
            ...current.filter((a) => !(a.kind === 'component' && a.name === picked.name)),
            attachment,
          ])
          inputRef.current?.focus()
        })
    })
    return () => {
      off()
      requestPick(false)
    }
  }, [dir])

  function togglePick() {
    const next = !picking
    setPicking(next)
    requestPick(next)
  }

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
    const hasError = attachments.some((a) => a.kind === 'error')
    const message = text.trim() || (hasError ? 'Please fix this error.' : '')
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

    const sent = attachments
    const user: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      text: message,
      ...(sent.length > 0 ? { attachments: sent } : {}),
    }
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
    setAttachments([])
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
        setDraft(text)
        setAttachments(sent)
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
                {message.attachments && message.attachments.length > 0 && (
                  <div className="chat-chips">
                    {message.attachments.map((attachment, i) => (
                      <AttachmentChip key={i} attachment={attachment} />
                    ))}
                  </div>
                )}
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
                    dir={dir}
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
          {attachments.length > 0 && (
            <div className="chat-chips">
              {attachments.map((attachment, i) => (
                <AttachmentChip
                  key={i}
                  attachment={attachment}
                  onRemove={() => setAttachments((current) => current.filter((a) => a !== attachment))}
                />
              ))}
            </div>
          )}
          <textarea
            ref={inputRef}
            value={draft}
            maxLength={MAX_CHAT_MESSAGE}
            rows={3}
            placeholder={
              attachments.some((a) => a.kind === 'error')
                ? 'Press Send to ask AI to fix it, or add a note…'
                : 'Ask AI about your site…  (Enter to send, Shift+Enter for a new line)'
            }
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault()
                void send(draft)
              }
            }}
          />
          <div className="chat-input-bar">
            <button
              type="button"
              className={picking ? 'button pressed' : 'button'}
              aria-pressed={picking}
              title="Click a part of the preview to show AI what you mean"
              onClick={togglePick}
            >
              {picking ? 'Click the page… (Cancel)' : '🎯 Pick from page'}
            </button>
            <span className="chat-spacer" />
            {messages.length > 0 && (
              <button type="button" className="link-button" onClick={clear} disabled={!!busy}>
                New chat
              </button>
            )}
            <button
              type="submit"
              className="button primary"
              disabled={!!busy || (!draft.trim() && !attachments.some((a) => a.kind === 'error'))}
            >
              {busy ? 'Working…' : 'Send'}
            </button>
          </div>
        </form>
      )}
    </section>
  )
}

interface ProposalCardProps {
  dir: FileSystemDirectoryHandle
  message: ChatMessage
  onApply(): void
  onUndo(): void
  onDiscard(): void
}

function ProposalCard({ dir, message, onApply, onUndo, onDiscard }: ProposalCardProps) {
  const proposal = message.proposal!
  const state = message.proposalState ?? 'pending'
  const canPreview = Boolean(proposal.preview?.jsx)
  const [tab, setTab] = useState<'preview' | 'code'>(canPreview && state === 'pending' ? 'preview' : 'code')
  return (
    <div className={`chat-proposal ${state}`}>
      <h4>✨ Proposed change</h4>
      <p>{proposal.summary}</p>
      {canPreview && (
        <div className="chat-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'preview'} onClick={() => setTab('preview')}>
            👀 Preview
          </button>
          <button type="button" role="tab" aria-selected={tab === 'code'} onClick={() => setTab('code')}>
            📄 Code
          </button>
        </div>
      )}
      {canPreview && tab === 'preview' && <DraftPreview dir={dir} id={message.id} proposal={proposal} />}
      <ul className="ai-changes" hidden={canPreview && tab === 'preview'}>
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

/** The proposal's example, rendered on its own from draft files in the container (lib/drafts.ts). */
function DraftPreview({ dir, id, proposal }: { dir: FileSystemDirectoryHandle; id: string; proposal: ChatProposal }) {
  const [result, setResult] = useState<DraftResult | { ok: null } | null>(null)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    let cancelled = false
    const base = currentPreviewBase()
    const done = (next: DraftResult | { ok: null }) => !cancelled && setResult(next)
    if (!base) done({ ok: null })
    else
      writeDraft(dir, id, proposal).then(done, (error: unknown) =>
        done({ ok: false, reason: `Couldn’t prepare the preview: ${String(error)}` }),
      )
    return () => {
      cancelled = true
    }
  }, [dir, id, proposal, version])

  const base = currentPreviewBase()
  return (
    <div className="draft-preview">
      {result === null ? (
        <div className="ai-working">
          <div className="spinner small" aria-hidden="true" />
          <span>Preparing the preview…</span>
        </div>
      ) : result.ok === null || !base ? (
        <p className="ai-file">The preview appears once your project is running.</p>
      ) : result.ok ? (
        <div className="draft-frame">
          <iframe key={version} src={new URL(result.path, base).href} title="Preview of the proposed change" />
        </div>
      ) : (
        <p className="notice">{result.reason}</p>
      )}
      <div className="draft-caption">
        <code>{proposal.preview!.jsx.trim()}</code>
        <button type="button" className="link-button" onClick={() => setVersion((v) => v + 1)}>
          ↻ Reload
        </button>
      </div>
      <p className="ai-file">
        Shown on its own, before applying (your site’s JavaScript doesn’t run here). Apply to see it on your page.
      </p>
    </div>
  )
}

function AttachmentChip({ attachment, onRemove }: { attachment: ChatAttachment; onRemove?(): void }) {
  if (attachment.kind === 'component') {
    return (
      <span className="chat-chip">
        <button
          type="button"
          className="chat-chip-label"
          title={`${attachment.label}${attachment.file ? `\n${attachment.file}` : ''}\nClick to show it on the page`}
          onClick={() => highlightComponent(attachment.name)}
        >
          🧩 {attachment.name}
        </button>
        {onRemove && (
          <button type="button" className="chat-chip-remove" aria-label="Remove" onClick={onRemove}>
            ×
          </button>
        )}
      </span>
    )
  }
  return (
    <span className="chat-chip error" title={attachment.message}>
      <span className="chat-chip-label">
        ⚠️ {attachment.errorKind === 'build' ? 'Build error' : 'Page error'}: {attachment.message.split('\n')[0].slice(0, 60)}
      </span>
      {onRemove && (
        <button type="button" className="chat-chip-remove" aria-label="Remove" onClick={onRemove}>
          ×
        </button>
      )}
    </span>
  )
}
