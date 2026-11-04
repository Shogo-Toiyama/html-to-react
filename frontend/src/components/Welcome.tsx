// What the main area shows before a project is running: open a folder, or
// answer what to do with the folder that was opened.

export type Prompt =
  | { kind: 'empty-folder'; handle: FileSystemDirectoryHandle }
  | { kind: 'html-site'; handle: FileSystemDirectoryHandle; pages: string[] }
  | { kind: 'not-a-project'; handle: FileSystemDirectoryHandle }
  | { kind: 'sample'; siteName: string }

/** Where the converted project goes: a new folder next to the site, or a folder the participant picks. */
export type ConvertTarget = 'new-folder' | 'choose-folder'

export const browserSupported = typeof window.showDirectoryPicker === 'function'

interface WelcomeProps {
  prompt: Prompt | null
  notice: string | null
  rememberedFolder: FileSystemDirectoryHandle | null
  onPick(): void
  onReopen(handle: FileSystemDirectoryHandle): void
  onUseSample(): void
  /** Picks where to save the sample site, then converts it. */
  onSaveSample(): void
  onCreateStarter(handle: FileSystemDirectoryHandle): void
  onConvert(handle: FileSystemDirectoryHandle, where: ConvertTarget): void
  onDismissPrompt(): void
}

export function Welcome(props: WelcomeProps) {
  const {
    prompt,
    notice,
    rememberedFolder,
    onPick,
    onReopen,
    onUseSample,
    onSaveSample,
    onCreateStarter,
    onConvert,
    onDismissPrompt,
  } = props
  if (!browserSupported) {
    return (
      <div className="welcome">
        <h1>Please open this page in Chrome or Edge</h1>
        <p>This app needs access to a folder on your computer, which only Chrome and Edge support right now.</p>
      </div>
    )
  }

  if (!window.crossOriginIsolated) {
    return (
      <div className="welcome">
        <h1>This page can’t run Node.js</h1>
        <p>
          The server must send <code>Cross-Origin-Opener-Policy</code> and <code>Cross-Origin-Embedder-Policy</code>{' '}
          headers. Please tell the workshop organizers.
        </p>
      </div>
    )
  }

  if (prompt?.kind === 'empty-folder') {
    return (
      <div className="welcome">
        <h1>“{prompt.handle.name}” is empty</h1>
        <p>Create a starter React project in this folder? You’ll be able to edit every file in VS Code.</p>
        <div className="actions">
          <button type="button" className="button primary" onClick={() => onCreateStarter(prompt.handle)}>
            Create React project
          </button>
          <button type="button" className="button" onClick={onDismissPrompt}>
            Cancel
          </button>
        </div>
      </div>
    )
  }

  if (prompt?.kind === 'sample') {
    return (
      <div className="welcome">
        <h1>Start from the sample site</h1>
        <p>
          The sample is a small two-page portfolio website made with HTML, CSS and JavaScript. Launchpad saves it on
          your computer and turns it into React, so you can edit it in VS Code.
        </p>
        <ol className="steps">
          <li>
            Click <strong>Choose where to save</strong> and pick a folder, like your Desktop or Documents.
          </li>
          <li>
            Two folders are created there: <strong>“{prompt.siteName}”</strong> (the website) and{' '}
            <strong>“{prompt.siteName} - React”</strong> (the React version you’ll work in).
          </li>
        </ol>
        {notice && <p className="notice">{notice}</p>}
        <div className="actions">
          <button type="button" className="button primary" onClick={onSaveSample}>
            Choose where to save
          </button>
          <button type="button" className="button" onClick={onDismissPrompt}>
            Cancel
          </button>
        </div>
      </div>
    )
  }

  if (prompt?.kind === 'html-site') {
    return <ConvertPrompt prompt={prompt} notice={notice} onConvert={onConvert} onCancel={onDismissPrompt} />
  }

  if (prompt?.kind === 'not-a-project') {
    return (
      <div className="welcome">
        <h1>Nothing to run in “{prompt.handle.name}”</h1>
        <p>
          This folder has no <code>package.json</code> (React project) and no <code>.html</code> page at its top level.
          Choose an empty folder, an existing React project, or the folder that contains your site’s{' '}
          <code>index.html</code>.
        </p>
        <div className="actions">
          <button type="button" className="button primary" onClick={onPick}>
            Choose another folder
          </button>
          <button type="button" className="button" onClick={onUseSample}>
            Use the sample site
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="welcome">
      <h1>Run React right in your browser</h1>
      <p>No installs needed. Your files stay on your computer.</p>
      <ol className="steps">
        <li>
          Choose a folder: your <strong>HTML website</strong> to turn it into React, or your <strong>React project</strong>{' '}
          to keep working on it.
        </li>
        <li>
          Edit the files in <strong>VS Code</strong> and save.
        </li>
        <li>Your site updates here automatically.</li>
      </ol>
      {notice && <p className="notice">{notice}</p>}
      <div className="actions">
        <button type="button" className="button primary" onClick={onPick}>
          Open folder
        </button>
        {rememberedFolder && (
          <button type="button" className="button" onClick={() => onReopen(rememberedFolder)}>
            Reopen “{rememberedFolder.name}”
          </button>
        )}
        <button type="button" className="button" onClick={onUseSample}>
          Use the sample site
        </button>
      </div>
    </div>
  )
}

interface ConvertPromptProps {
  prompt: Extract<Prompt, { kind: 'html-site' }>
  notice: string | null
  onConvert(handle: FileSystemDirectoryHandle, where: ConvertTarget): void
  onCancel(): void
}

function ConvertPrompt({ prompt, notice, onConvert, onCancel }: ConvertPromptProps) {
  const name = prompt.handle.name
  return (
    <div className="welcome">
      <h1>“{name}” is an HTML website</h1>
      <p>
        Convert it to a React project? Your original files stay exactly as they are. The React version goes into a new
        folder.
      </p>
      {prompt.pages.length > 1 && (
        <p className="hint">
          Found {prompt.pages.length} pages ({prompt.pages.join(', ')}). Each one becomes a component, and React Router
          switches between them.
        </p>
      )}
      <ol className="steps">
        <li>
          Click <strong>Create “{name} - React”</strong>.
        </li>
        <li>
          The dialog opens inside “{name}”. Go <strong>up one folder</strong> and click <strong>Open</strong> (or{' '}
          <strong>Select</strong>). The new folder is created next to “{name}”.
        </li>
      </ol>
      {notice && <p className="notice">{notice}</p>}
      <div className="actions">
        <button type="button" className="button primary" onClick={() => onConvert(prompt.handle, 'new-folder')}>
          Create “{name} - React”
        </button>
        <button type="button" className="button" onClick={() => onConvert(prompt.handle, 'choose-folder')}>
          Choose another empty folder
        </button>
        <button type="button" className="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}
