// Side panel: which workshop step we're on, what to do, and what's next.

import { StepContent, type StepContext } from '../curriculum/StepContent'
import { findWorkshop, WORKSHOPS, type Step } from '../curriculum/workshops'
import { stepKey, type Progress } from '../lib/progress'

interface GuidePanelProps {
  progress: Progress
  ctx: StepContext
  /** True when a React project is running (or being set up). */
  hasProject: boolean
  onSelect(workshop: string, step: string): void
  /** Marks the current step finished and moves to the next one. */
  onNext(): void
  onOpenFolder(): void
  onUseSample(): void
}

export function GuidePanel(props: GuidePanelProps) {
  const { progress, ctx, hasProject, onSelect, onNext, onOpenFolder, onUseSample } = props
  const workshop = findWorkshop(progress.workshop) ?? WORKSHOPS[0]
  const index = Math.max(0, workshop.steps.findIndex((step) => step.id === progress.step))
  const step = workshop.steps[index]
  const next: Step | undefined = workshop.steps[index + 1]
  const previous: Step | undefined = workshop.steps[index - 1]
  const done = (s: Step) => progress.completed.includes(stepKey(workshop.id, s.id))
  const number = (i: number) => workshop.firstStepNumber + i

  return (
    <aside className="guide">
      <div className="guide-header">
        <select
          className="guide-workshop"
          value={workshop.id}
          aria-label="Workshop"
          onChange={(event) => {
            const chosen = findWorkshop(event.target.value)
            if (chosen) onSelect(chosen.id, chosen.steps[0].id)
          }}
        >
          {WORKSHOPS.map((w) => (
            <option key={w.id} value={w.id} disabled={w.status !== 'available'}>
              Workshop {w.number}: {w.title}
              {w.status === 'coming-soon' ? ' (coming soon)' : ''}
            </option>
          ))}
        </select>
        {workshop.slidesUrl && (
          <a className="guide-slides" href={workshop.slidesUrl} target="_blank" rel="noreferrer">
            Slides ↗
          </a>
        )}
        <ol className="guide-steps">
          {workshop.steps.map((s, i) => (
            <li key={s.id}>
              <button
                type="button"
                className={`guide-step${s.id === step.id ? ' current' : ''}${done(s) ? ' done' : ''}`}
                aria-current={s.id === step.id ? 'step' : undefined}
                onClick={() => onSelect(workshop.id, s.id)}
              >
                <span className="guide-step-mark" aria-hidden="true">
                  {done(s) ? '✓' : number(i)}
                </span>
                {s.title}
              </button>
            </li>
          ))}
        </ol>
      </div>

      <div className="guide-body">
        <p className="guide-kicker">Step {number(index)}</p>
        <h2>{step.title}</h2>
        <p className="guide-goal">{step.goal}</p>

        {!hasProject && step.needs !== 'nothing' && (
          <div className="guide-callout">
            {step.needs === 'site' ? (
              <p>
                Open the folder with your <strong>HTML website</strong> (the one with <code>index.html</code>). Launchpad
                turns it into a React project.
              </p>
            ) : (
              <p>
                Open your <strong>React project</strong> folder (for example “My Site - React”). Missed the last step?
                Start from the sample site.
              </p>
            )}
            <div className="actions">
              <button type="button" className="button primary" onClick={onOpenFolder}>
                Open folder
              </button>
              <button type="button" className="button" onClick={onUseSample}>
                Use the sample site
              </button>
            </div>
          </div>
        )}

        <StepContent workshop={workshop.id} step={step.id} ctx={ctx} />
      </div>

      <div className="guide-footer">
        <button
          type="button"
          className="button"
          disabled={!previous}
          onClick={() => previous && onSelect(workshop.id, previous.id)}
        >
          ← Back
        </button>
        <button type="button" className="button primary" onClick={onNext} disabled={!next && done(step)}>
          {next ? `Next: ${next.title} →` : done(step) ? 'Workshop finished 🎉' : 'Finish workshop ✓'}
        </button>
      </div>
    </aside>
  )
}
