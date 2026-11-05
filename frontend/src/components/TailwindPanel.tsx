// Step 4 (Tailwind CSS): set Tailwind up, then let Claude move CSS into
// Tailwind classes, one component at a time or for the whole site. After the
// whole site is converted, offer to delete the CSS nothing uses anymore.

import { useCallback, useEffect, useState } from 'react'
import { WHOLE_SITE } from '../lib/aiApi'
import { readHistory, type AiHistoryEntry } from '../lib/aiChanges'
import { listComponentFiles } from '../lib/aiClient'
import { highlightComponent } from '../lib/highlight'
import { checkTailwind, isTailwindReady, setupTailwind, type SetupResult, type TailwindStatus } from '../lib/tailwindSetup'
import { AiSuggest } from './AiSuggest'

type Scope = 'component' | 'site'

async function load(dir: FileSystemDirectoryHandle) {
  const [status, files, history] = await Promise.all([checkTailwind(dir), listComponentFiles(dir), readHistory(dir)])
  return { status, files, history }
}

export function TailwindPanel({ dir }: { dir: FileSystemDirectoryHandle }) {
  const [status, setStatus] = useState<TailwindStatus | null>(null)
  const [setup, setSetup] = useState<{ running: boolean; result?: SetupResult; error?: string }>({ running: false })
  const [files, setFiles] = useState<string[]>([])
  const [history, setHistory] = useState<AiHistoryEntry[]>([])
  const [scope, setScope] = useState<Scope>('component')
  const [target, setTarget] = useState('')

  const show = useCallback((data: Awaited<ReturnType<typeof load>>) => {
    setStatus(data.status)
    setFiles(data.files)
    setHistory(data.history)
    setTarget((current) => (data.files.includes(current) ? current : (data.files[0] ?? '')))
  }, [])

  const refresh = useCallback(() => load(dir).then(show), [dir, show])

  useEffect(() => {
    let cancelled = false
    void load(dir).then((data) => !cancelled && show(data))
    return () => {
      cancelled = true
    }
  }, [dir, show])

  async function runSetup() {
    setSetup({ running: true })
    try {
      const result = await setupTailwind(dir)
      setSetup({ running: false, result })
      await refresh()
    } catch (error) {
      setSetup({ running: false, error: String(error) })
    }
  }

  if (!status) return <p className="ai-file">Checking your project…</p>

  const applied = (step: string, t: string) =>
    history.some((entry) => entry.step === step && entry.target === t && !entry.undoneAt)
  const siteConverted = applied('tailwind', WHOLE_SITE)
  const name = (path: string) => path.split('/').pop()!.replace(/\.jsx$/, '')

  if (!isTailwindReady(status)) {
    return (
      <section className="ai-box">
        <h3>1. Turn on Tailwind</h3>
        <p>
          Launchpad adds the Tailwind plugin to <code>vite.config.js</code> and loads Tailwind’s classes in your CSS.
          Your page won’t change yet.
        </p>
        {setup.error && <p className="notice">{setup.error}</p>}
        <button type="button" className="button primary" disabled={setup.running} onClick={() => void runSetup()}>
          {setup.running ? 'Setting up…' : 'Set up Tailwind'}
        </button>
      </section>
    )
  }

  return (
    <>
      <div className="guide-callout ok">
        <strong>Tailwind is on ✓</strong> It’s loaded in <code>{status.cssFile}</code>.
        {setup.result?.installing && <p>Installing Tailwind… the preview restarts in a few seconds.</p>}
        {setup.result && setup.result.manual.length > 0 && (
          <>
            <p>Please do these by hand:</p>
            <ul>
              {setup.result.manual.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ul>
          </>
        )}
      </div>

      <div className="tw-scope" role="radiogroup" aria-label="What to convert">
        <label>
          <input
            type="radio"
            checked={scope === 'component'}
            onChange={() => {
              setScope('component')
              if (target) highlightComponent(name(target))
            }}
          />
          One component
          <select
            value={target}
            disabled={scope !== 'component'}
            onChange={(event) => {
              setTarget(event.target.value)
              highlightComponent(name(event.target.value))
            }}
            aria-label="Component"
          >
            {files.map((file) => (
              <option key={file} value={file}>
                {name(file)}
                {applied('tailwind', file) ? ' ✓' : ''}
              </option>
            ))}
          </select>
          {scope === 'component' && target && (
            <button
              type="button"
              className="button tw-show"
              title="Show where this component is on the page"
              onClick={() => highlightComponent(name(target))}
            >
              Show
            </button>
          )}
        </label>
        <label>
          <input type="radio" checked={scope === 'site'} onChange={() => setScope('site')} />
          The whole site{siteConverted ? ' ✓' : ''}
        </label>
      </div>

      {scope === 'component' && target && (
        <AiSuggest
          key={`tailwind:${target}`}
          dir={dir}
          step="tailwind"
          target={target}
          onChange={() => void refresh()}
          copy={{
            title: `Ask AI to convert ${name(target)}`,
            button: `Convert ${name(target)}`,
            intro: `AI replaces the CSS that styles ${name(target)} with Tailwind classes in its JSX. Compare the className before and after!`,
          }}
        />
      )}
      {scope === 'site' && (
        <AiSuggest
          key="tailwind:*"
          dir={dir}
          step="tailwind"
          target={WHOLE_SITE}
          onChange={() => void refresh()}
          copy={{
            title: 'Ask AI to convert the whole site',
            button: 'Convert the whole site',
            intro:
              'AI replaces the CSS for every component and page with Tailwind classes. Your CSS files stay as they are; you can delete what’s unused afterwards.',
          }}
        />
      )}

      {siteConverted && (
        <AiSuggest
          key="tailwind-cleanup"
          dir={dir}
          step="tailwind-cleanup"
          onChange={() => void refresh()}
          copy={{
            title: 'Delete CSS that isn’t needed anymore?',
            button: 'Find unused CSS',
            intro:
              '🎉 Everything uses Tailwind classes now! AI can find the CSS rules nothing uses anymore and delete them.',
          }}
        />
      )}
    </>
  )
}
